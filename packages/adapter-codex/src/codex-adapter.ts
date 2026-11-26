import { randomUUID } from 'node:crypto';
import {
  type AdapterDependencies,
  type AgentEvent,
  type AgentSession,
  type DispatchReceipt,
  EventHub,
  type ForkSessionInput,
  type GateRequest,
  type GateResolution,
  type GateResponse,
  type OpenSessionInput,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderDriver,
  type ReviewTarget,
  type SendTurnInput,
  type SessionAnchor,
  type SteerTurnInput,
  classifyProviderFailure,
  createPolicyGateMiddleware,
  formatReviewTargetPrompt,
} from '@neopolitan-ai/core';
import { z } from 'zod';
import { CodexAppServerClient } from './codex-client.js';
import { sanitizeLoneSurrogates } from './sanitize.js';

export interface CodexDriverConfig {
  readonly executablePath?: string;
  readonly args?: ReadonlyArray<string>;
  readonly codexHome?: string;
  readonly requestTimeoutMs?: number;
  readonly hangTimeoutMs?: number;
}

const codexConfigSchema = z.object({
  executablePath: z.string().optional(),
  args: z.array(z.string()).optional(),
  codexHome: z.string().optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
  hangTimeoutMs: z.number().int().positive().optional(),
});

export const CODEX_BASE_CAPABILITIES: ProviderCapabilities = {
  transport: 'json-rpc',
  sessions: {
    resume: true,
    fork: 'tip',
    rollback: false,
    switchModelInSession: true,
    switchPermissionModeInSession: true,
    survivesProcessRestart: false,
  },
  turns: {
    interrupt: true,
    steering: 'inject',
    queuedMessages: false,
    terminalStatusQuality: 'strong',
  },
  streaming: {
    assistantDeltas: true,
    reasoningDeltas: true,
    toolLifecycle: true,
    toolOutputDeltas: true,
    planUpdates: true,
    fileDiffs: true,
  },
  gating: {
    commandApproval: true,
    fileChangeApproval: true,
    structuredElicitation: true,
    urlElicitation: false,
    enforcement: 'provider',
  },
  context: {
    systemPrompt: true,
    contextPrelude: true,
    compact: false,
    mcpServers: ['stdio'],
    imageAttachments: true,
  },
  subagents: {
    supported: true,
    lifecycleEvents: true,
    stoppable: false,
  },
};

export function createCodexDriver(
  defaultConfig: CodexDriverConfig = {},
): ProviderDriver<CodexDriverConfig> {
  return {
    id: 'codex',
    label: 'OpenAI Codex',
    configSchema: codexConfigSchema as z.ZodType<CodexDriverConfig>,
    baseCapabilities: CODEX_BASE_CAPABILITIES,
    async probe(ctx, runtime) {
      const cmd = defaultConfig.executablePath ?? 'codex';
      const resolved = await runtime.which(cmd, ctx.env);
      if (!resolved) {
        return {
          available: false,
          reason: `Codex executable "${cmd}" not found`,
          authStatus: 'unavailable',
        };
      }
      return { available: true, executablePath: resolved, authStatus: 'unknown' };
    },
    async createAdapter(config, deps): Promise<ProviderAdapter> {
      return new CodexAdapter({ ...defaultConfig, ...config }, deps);
    },
  };
}

export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex' as const;
  readonly capabilities = CODEX_BASE_CAPABILITIES;

  constructor(
    private readonly config: CodexDriverConfig,
    private readonly deps: AdapterDependencies,
  ) {}

  async openSession(input: OpenSessionInput, signal?: AbortSignal): Promise<AgentSession> {
    const sessionId = input.sessionId ?? randomUUID();
    const session = new CodexSession(sessionId, this.config, input, this.deps);
    await session.initialize(signal);
    return session;
  }
}

class CodexSession implements AgentSession {
  readonly capabilities = CODEX_BASE_CAPABILITIES;
  providerSessionId?: string;

  private readonly hub: EventHub;
  private client?: CodexAppServerClient;
  private threadId?: string;
  private activeTurnId?: string;
  private activeProviderTurnId?: string;
  private readonly pendingGates = new Map<string, { resolve: (res: GateResolution) => void }>();
  private readonly gateMiddleware;
  private closed = false;

  constructor(
    readonly sessionId: string,
    private readonly config: CodexDriverConfig,
    private readonly openInput: OpenSessionInput,
    private readonly deps: AdapterDependencies,
  ) {
    this.hub = new EventHub({ sessionId });
    this.gateMiddleware = deps.gateMiddleware ?? createPolicyGateMiddleware();
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    const env: Record<string, string> = {
      ...(this.openInput.env ?? {}),
      ...(this.config.codexHome ? { CODEX_HOME: this.config.codexHome } : {}),
    };

    this.client = new CodexAppServerClient({
      command: this.config.executablePath ?? 'codex',
      args: this.config.args,
      cwd: this.openInput.cwd,
      env,
      runtime: this.deps.runtime,
      requestTimeoutMs: this.config.requestTimeoutMs,
      hangTimeoutMs: this.config.hangTimeoutMs,
      onNotification: (method, params) => this.handleNotification(method, params),
      onServerRequest: (_id, method, params) => this.handleServerRequest(method, params),
      onHangRetired: () => {
        if (!this.closed) {
          this.hub.emit({
            type: 'notice',
            level: 'error',
            code: 'CODEX_SERVER_HUNG',
            message: 'Codex app-server stalled and was retired',
          });
        }
      },
    });

    await this.client.start(signal);

    if (
      this.openInput.resumeAnchor?.providerId === 'codex' &&
      'threadId' in this.openInput.resumeAnchor
    ) {
      const res = await this.client.request<{ thread: { id: string } }>('thread/resume', {
        threadId: this.openInput.resumeAnchor.threadId,
        cwd: this.openInput.cwd,
      });
      this.threadId = res.thread.id;
    } else {
      const res = await this.client.request<{ thread: { id: string } }>('thread/start', {
        cwd: this.openInput.cwd,
        model: this.openInput.model?.model,
      });
      this.threadId = res.thread.id;
    }

    this.providerSessionId = this.threadId;
    this.hub.emit({
      type: 'session.started',
      providerSessionId: this.providerSessionId,
      anchor: this.getAnchor(),
      capabilities: this.capabilities,
    });
  }

  events(options?: {
    readonly includeRaw?: boolean;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<AgentEvent> {
    return this.hub.subscribe(options);
  }

  async sendTurn(input: SendTurnInput): Promise<DispatchReceipt> {
    if (this.closed || !this.client || !this.threadId) {
      return { outcome: 'rejected', reason: 'Codex session is closed', code: 'transport_error' };
    }
    const turnId = input.turnId ?? randomUUID();
    this.activeTurnId = turnId;
    const rawText = this.openInput.contextPrelude
      ? `${this.openInput.contextPrelude}\n\n${input.prompt}`
      : input.prompt;
    const text = sanitizeLoneSurrogates(rawText);

    this.hub.emit({
      type: 'turn.started',
      turnId,
      userMessageId: input.userMessageId,
    });

    try {
      const res = await this.client.request<{ turn?: { id?: string } }>('turn/start', {
        threadId: this.threadId,
        input: [{ type: 'text', text }],
      });
      this.activeProviderTurnId = res.turn?.id;
      return { outcome: 'accepted', turnId, providerTurnId: this.activeProviderTurnId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failure = classifyProviderFailure(msg);
      this.hub.emit({
        type: 'turn.completed',
        turnId,
        status: 'failed',
        disposition: 'identified',
        threadDisposition: 'reusable',
        failure,
      });
      return { outcome: 'rejected', reason: failure.safeMessage, code: failure.failureClass };
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<DispatchReceipt> {
    if (this.closed || !this.client || !this.threadId) {
      return { outcome: 'rejected', reason: 'Codex session is closed', code: 'transport_error' };
    }
    const turnId = input.turnId ?? this.activeTurnId ?? randomUUID();
    const text = sanitizeLoneSurrogates(input.prompt);
    await this.client.request('turn/steer', {
      threadId: this.threadId,
      turnId: this.activeProviderTurnId,
      input: [{ type: 'text', text }],
    });
    return { outcome: 'accepted', turnId, providerTurnId: this.activeProviderTurnId };
  }

  async runReview(target: ReviewTarget): Promise<DispatchReceipt> {
    if (this.closed || !this.client || !this.threadId) {
      return { outcome: 'rejected', reason: 'Codex session is closed', code: 'transport_error' };
    }
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    const instructions = sanitizeLoneSurrogates(formatReviewTargetPrompt(target));

    this.hub.emit({ type: 'turn.started', turnId });
    const res = await this.client.request<{ turn?: { id?: string } }>('reviewStart', {
      threadId: this.threadId,
      target: { type: 'custom', instructions },
    });
    this.activeProviderTurnId = res.turn?.id;
    return { outcome: 'accepted', turnId, providerTurnId: this.activeProviderTurnId };
  }

  async fork(_input?: ForkSessionInput): Promise<SessionAnchor> {
    if (!this.client || !this.threadId) throw new Error('Codex session is not open');
    const res = await this.client.request<{ thread: { id: string } }>('thread/fork', {
      threadId: this.threadId,
    });
    return { providerId: 'codex', threadId: res.thread.id };
  }

  async interruptTurn(): Promise<void> {
    if (!this.client || !this.threadId) return;
    await this.client.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.activeProviderTurnId,
    });
  }

  async respondToGate(response: GateResponse): Promise<void> {
    const pending = this.pendingGates.get(response.requestId);
    if (pending) {
      this.pendingGates.delete(response.requestId);
      pending.resolve(response.resolution);
    }
  }

  private async handleServerRequest(method: string, params: unknown): Promise<unknown> {
    const requestId = `codex-gate-${randomUUID()}`;
    const p = (params ?? {}) as Record<string, unknown>;
    const req: GateRequest =
      method === 'item/tool/requestUserInput'
        ? {
            kind: 'elicitation',
            requestId,
            mode: 'form',
            prompt: String(p.prompt ?? 'Input requested'),
          }
        : {
            kind: 'approval',
            requestId,
            category: method.includes('fileChange') ? 'file_write' : 'command',
            title: String(p.reason ?? p.command ?? method),
            command: typeof p.command === 'string' ? p.command : undefined,
            rawInput: params,
          };

    this.hub.emit({ type: 'gate.requested', turnId: this.activeTurnId, request: req });

    const resolution = await this.gateMiddleware.evaluate(
      req,
      {
        mode: this.openInput.permissionMode ?? 'supervised',
        cwd: this.openInput.cwd,
        sessionId: this.sessionId,
      },
      (gateReq) =>
        this.deps.interactiveGateHandler
          ? this.deps.interactiveGateHandler(gateReq)
          : new Promise<GateResolution>((resolve) => {
              this.pendingGates.set(gateReq.requestId, { resolve });
            }),
    );

    this.hub.emit({ type: 'gate.resolved', turnId: this.activeTurnId, requestId, resolution });
    if (resolution.decision === 'answered') {
      return { answers: resolution.answers };
    }
    return {
      decision:
        resolution.decision === 'allow_once' || resolution.decision === 'allow_session'
          ? 'accept'
          : 'decline',
      feedback: resolution.decision === 'deny' ? resolution.feedback : undefined,
    };
  }

  private handleNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    const turnId = this.activeTurnId;

    if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      this.hub.emit({
        type: 'assistant.delta',
        turnId,
        blockId: String(p.itemId ?? `msg-${turnId ?? 'cur'}`),
        text: p.delta,
        rawEvent: { protocol: 'codex-app-server', payload: { method, params } },
      });
    } else if (method === 'turn/completed') {
      const turn = (p.turn ?? {}) as Record<string, unknown>;
      const statusRaw = String(turn.status ?? 'completed');
      const status =
        statusRaw === 'interrupted'
          ? 'interrupted'
          : statusRaw === 'failed'
            ? 'failed'
            : 'completed';
      this.hub.emit({
        type: 'turn.completed',
        turnId,
        status,
        disposition: 'identified',
        threadDisposition: 'reusable',
        failure:
          status === 'failed'
            ? classifyProviderFailure(
                String(
                  (turn.error as { message?: string } | undefined)?.message ?? 'Codex turn failed',
                ),
              )
            : undefined,
        rawEvent: { protocol: 'codex-app-server', payload: { method, params } },
      });
    }
  }

  getAnchor(): SessionAnchor {
    return {
      providerId: 'codex',
      threadId: this.threadId ?? this.sessionId,
      turnId: this.activeProviderTurnId,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pendingGates) {
      pending.resolve({ decision: 'cancelled', source: 'timeout' });
    }
    this.pendingGates.clear();
    await this.client?.close();
    this.hub.emit({ type: 'session.ended', cause: 'requested' });
    this.hub.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
