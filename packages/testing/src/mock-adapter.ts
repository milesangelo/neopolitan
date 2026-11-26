import { randomUUID } from 'node:crypto';
import {
  type AdapterDependencies,
  type AgentEvent,
  type AgentSession,
  type DispatchReceipt,
  EventHub,
  type ExecutionRuntime,
  type GateRequest,
  type GateResolution,
  type GateResponse,
  type ManagedProcess,
  type OpenSessionInput,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderDriver,
  type SendTurnInput,
  type SessionAnchor,
  type SpawnSpec,
  classifyProviderFailure,
  createPolicyGateMiddleware,
} from '@neopolitan-ai/core';
import { z } from 'zod';

export class MockExecutionRuntime implements ExecutionRuntime {
  readonly id = 'mock';
  readonly platform = 'linux' as const;
  readonly kind = 'local' as const;
  readonly defaultCwd = '/workspace';
  readonly files = new Map<string, string>();
  readonly spawnedSpecs: SpawnSpec[] = [];

  async spawn(_spec: SpawnSpec): Promise<ManagedProcess> {
    this.spawnedSpecs.push(_spec);
    throw new Error('MockExecutionRuntime.spawn not configured for subprocesses');
  }

  async which(command: string): Promise<string | null> {
    return `/usr/bin/${command}`;
  }

  async realpath(targetPath: string): Promise<string> {
    return targetPath;
  }

  async exists(targetPath: string): Promise<boolean> {
    return this.files.has(targetPath);
  }

  async mkdir(_targetPath: string): Promise<void> {}

  async readdir(
    targetPath: string,
  ): Promise<ReadonlyArray<{ readonly name: string; readonly isDirectory: boolean }>> {
    const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length).split('/')[0];
        if (rest) names.add(rest);
      }
    }
    return [...names].map((name) => ({ name, isDirectory: false }));
  }

  async readFile(targetPath: string): Promise<string> {
    const value = this.files.get(targetPath);
    if (value === undefined) throw new Error(`ENOENT: ${targetPath}`);
    return value;
  }

  async writeFile(targetPath: string, content: string): Promise<void> {
    this.files.set(targetPath, content);
  }

  async stat(
    targetPath: string,
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number } | null> {
    const value = this.files.get(targetPath);
    if (value === undefined) return null;
    return { isFile: true, isDirectory: false, size: value.length };
  }
}

export const MOCK_BASE_CAPABILITIES: ProviderCapabilities = {
  transport: 'native-sdk',
  sessions: {
    resume: true,
    fork: 'checkpoint',
    rollback: false,
    switchModelInSession: true,
    switchPermissionModeInSession: true,
    survivesProcessRestart: false,
  },
  turns: {
    interrupt: true,
    steering: 'inject',
    queuedMessages: true,
    terminalStatusQuality: 'strong',
  },
  streaming: {
    assistantDeltas: true,
    reasoningDeltas: false,
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
    compact: true,
    mcpServers: ['stdio', 'http'],
    imageAttachments: false,
  },
  subagents: {
    supported: true,
    lifecycleEvents: true,
    stoppable: true,
  },
};

export interface MockDriverBehavior {
  readonly requireGateOnPrompt?: RegExp;
  readonly failWithSecretOnPrompt?: RegExp;
  readonly unknownOutcomeOnPrompt?: RegExp;
}

export function createMockDriver(
  behavior?: MockDriverBehavior,
): ProviderDriver<{ readonly label?: string }> {
  return {
    id: 'mock',
    label: 'Mock Coding Agent',
    configSchema: z.object({ label: z.string().optional() }),
    baseCapabilities: MOCK_BASE_CAPABILITIES,
    async probe() {
      return { available: true, version: '1.0.0', authStatus: 'authenticated' };
    },
    async createAdapter(_config, deps): Promise<ProviderAdapter> {
      return {
        id: 'mock',
        capabilities: MOCK_BASE_CAPABILITIES,
        async openSession(input: OpenSessionInput): Promise<AgentSession> {
          return new MockAgentSession(input, deps, behavior);
        },
      };
    },
  };
}

class MockAgentSession implements AgentSession {
  readonly sessionId: string;
  readonly providerSessionId: string;
  readonly capabilities = MOCK_BASE_CAPABILITIES;
  private readonly hub: EventHub;
  private readonly pendingGates = new Map<
    string,
    { resolve: (r: GateResolution) => void; reject: (err: unknown) => void }
  >();
  private activeAbort?: AbortController;
  private closed = false;
  private anchor: SessionAnchor;
  private readonly gateMiddleware;

  constructor(
    private readonly openInput: OpenSessionInput,
    private readonly deps: AdapterDependencies,
    private readonly behavior?: MockDriverBehavior,
  ) {
    this.sessionId = openInput.sessionId ?? randomUUID();
    this.providerSessionId = `mock-prov-${this.sessionId}`;
    this.anchor = { providerId: 'mock', sessionId: this.providerSessionId };
    this.hub = new EventHub({ sessionId: this.sessionId });
    this.gateMiddleware = deps.gateMiddleware ?? createPolicyGateMiddleware();

    this.hub.emit({
      type: 'session.started',
      providerSessionId: this.providerSessionId,
      anchor: this.anchor,
      capabilities: this.capabilities,
      rawEvent: { protocol: 'mock', payload: { init: true } },
    });
  }

  events(options?: {
    readonly includeRaw?: boolean;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<AgentEvent> {
    return this.hub.subscribe(options);
  }

  async sendTurn(input: SendTurnInput, signal?: AbortSignal): Promise<DispatchReceipt> {
    if (this.closed) {
      return { outcome: 'rejected', reason: 'Session is closed', code: 'transport_error' };
    }
    const turnId = input.turnId ?? randomUUID();
    if (this.behavior?.unknownOutcomeOnPrompt?.test(input.prompt)) {
      return {
        outcome: 'unknown',
        turnId,
        reason: 'Transport dropped after write; outcome unknown',
      };
    }

    const ac = new AbortController();
    this.activeAbort = ac;
    signal?.addEventListener('abort', () => ac.abort(), { once: true });

    this.hub.emit({
      type: 'turn.started',
      turnId,
      userMessageId: input.userMessageId,
      rawEvent: { protocol: 'mock', payload: { prompt: input.prompt } },
    });

    queueMicrotask(() => {
      void this.executeTurn(turnId, input.prompt, ac.signal);
    });

    return { outcome: 'accepted', turnId, providerTurnId: `pt-${turnId}` };
  }

  private async executeTurn(turnId: string, prompt: string, signal: AbortSignal): Promise<void> {
    try {
      if (this.behavior?.failWithSecretOnPrompt?.test(prompt)) {
        const failure = classifyProviderFailure(
          'Request failed: Authorization: Bearer sk-ant-secret1234567890abcd',
          { statusCode: 401 },
        );
        this.hub.emit({
          type: 'turn.completed',
          turnId,
          status: 'failed',
          disposition: 'identified',
          threadDisposition: 'reusable',
          failure,
        });
        return;
      }

      if (this.behavior?.requireGateOnPrompt?.test(prompt)) {
        const requestId = `gate-${randomUUID()}`;
        const request: GateRequest = {
          kind: 'approval',
          requestId,
          category: 'command',
          title: 'Run shell check',
          command: 'echo ok',
        };
        this.hub.emit({ type: 'gate.requested', turnId, request });

        const resolution = await this.gateMiddleware.evaluate(
          request,
          {
            mode: this.openInput.permissionMode ?? 'supervised',
            cwd: this.openInput.cwd,
            sessionId: this.sessionId,
          },
          (req, gateSignal) =>
            this.deps.interactiveGateHandler
              ? this.deps.interactiveGateHandler(req, gateSignal)
              : new Promise<GateResolution>((resolve, reject) => {
                  this.pendingGates.set(req.requestId, { resolve, reject });
                  gateSignal?.addEventListener(
                    'abort',
                    () => {
                      this.pendingGates.delete(req.requestId);
                      resolve({ decision: 'cancelled', source: 'timeout' });
                    },
                    { once: true },
                  );
                }),
          signal,
        );

        this.hub.emit({ type: 'gate.resolved', turnId, requestId, resolution });
        if (resolution.decision === 'deny' || resolution.decision === 'cancelled') {
          this.hub.emit({
            type: 'assistant.completed',
            turnId,
            blockId: `msg-${turnId}`,
            text: `Denied: ${resolution.feedback ?? 'no reason'}`,
          });
          this.hub.emit({
            type: 'turn.completed',
            turnId,
            status: 'completed',
            disposition: 'identified',
            threadDisposition: 'reusable',
          });
          return;
        }
      }

      if (signal.aborted) {
        this.hub.emit({
          type: 'turn.completed',
          turnId,
          status: 'interrupted',
          disposition: 'identified',
          threadDisposition: 'reusable',
        });
        return;
      }

      const blockId = `msg-${turnId}`;
      this.hub.emit({ type: 'assistant.delta', turnId, blockId, text: 'Mock reply: ' });
      this.hub.emit({ type: 'assistant.delta', turnId, blockId, text: prompt });
      this.hub.emit({
        type: 'assistant.completed',
        turnId,
        blockId,
        text: `Mock reply: ${prompt}`,
      });
      this.hub.emit({
        type: 'turn.completed',
        turnId,
        status: 'completed',
        disposition: 'identified',
        threadDisposition: 'reusable',
      });
    } catch {
      if (!this.closed) {
        this.hub.emit({
          type: 'turn.completed',
          turnId,
          status: 'interrupted',
          disposition: 'identified',
          threadDisposition: 'reusable',
        });
      }
    }
  }

  async interruptTurn(): Promise<void> {
    this.activeAbort?.abort();
  }

  async respondToGate(response: GateResponse): Promise<void> {
    const pending = this.pendingGates.get(response.requestId);
    if (pending) {
      this.pendingGates.delete(response.requestId);
      pending.resolve(response.resolution);
    }
  }

  getAnchor(): SessionAnchor {
    return this.anchor;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.activeAbort?.abort();
    for (const [, pending] of this.pendingGates) {
      pending.resolve({ decision: 'cancelled', source: 'timeout' });
    }
    this.pendingGates.clear();
    this.hub.emit({ type: 'session.ended', cause: 'requested' });
    this.hub.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
