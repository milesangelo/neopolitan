import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk/unstable';
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
  type ModelSelection,
  type OpenSessionInput,
  type PermissionMode,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderDriver,
  type SendTurnInput,
  type SessionAnchor,
  type SteerTurnInput,
  type ToolKind,
  classifyProviderFailure,
  createPolicyGateMiddleware,
} from '@neopolitan-ai/core';
import { z } from 'zod';
import { assertPathWithinWorkspace } from './client-policy.js';
import { type AcpFlavor, resolveAcpFlavor } from './flavors.js';
import { createHardenedAcpStream } from './stream-wrapper.js';

export interface AcpDriverConfig {
  readonly id?: string;
  readonly label?: string;
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly flavor?: AcpFlavor | string;
  /** Optional direct in-process AgentApp (great for tests via `@agentclientprotocol/sdk`). */
  readonly inProcessAgent?: acp.AgentApp;
}

const acpConfigSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const ACP_BASE_CAPABILITIES: ProviderCapabilities = {
  transport: 'acp',
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
    steering: 'cancel-and-resend',
    queuedMessages: true,
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
    urlElicitation: true,
    enforcement: 'provider',
  },
  context: {
    systemPrompt: true,
    contextPrelude: true,
    compact: false,
    mcpServers: ['stdio', 'http', 'acp-bridge'],
    imageAttachments: true,
  },
  subagents: {
    supported: true,
    lifecycleEvents: true,
    stoppable: false,
  },
};

export function createAcpDriver(config: AcpDriverConfig = {}): ProviderDriver<AcpDriverConfig> {
  const id = config.id ?? 'acp';
  const flavor =
    typeof config.flavor === 'object'
      ? config.flavor
      : resolveAcpFlavor(config.flavor ?? config.command ?? id);

  return {
    id,
    label: config.label ?? `ACP (${flavor.id})`,
    configSchema: acpConfigSchema as z.ZodType<AcpDriverConfig>,
    baseCapabilities: ACP_BASE_CAPABILITIES,
    async probe(ctx, runtime) {
      if (config.inProcessAgent) {
        return { available: true, version: 'in-process', authStatus: 'authenticated' };
      }
      const cmd = config.command;
      if (!cmd) {
        return { available: false, reason: 'No ACP command configured', authStatus: 'unknown' };
      }
      const resolved = await runtime.which(cmd, ctx.env);
      if (!resolved) {
        return {
          available: false,
          reason: `Executable "${cmd}" not found on PATH`,
          authStatus: 'unavailable',
        };
      }
      return { available: true, executablePath: resolved, authStatus: 'unknown' };
    },
    async createAdapter(resolvedConfig, deps): Promise<ProviderAdapter> {
      const merged: AcpDriverConfig = { ...config, ...resolvedConfig };
      return new AcpAdapter(id, merged, flavor, deps);
    },
  };
}

export class AcpAdapter implements ProviderAdapter {
  readonly id: string;
  readonly capabilities = ACP_BASE_CAPABILITIES;

  constructor(
    id: string,
    private readonly config: AcpDriverConfig,
    private readonly flavor: AcpFlavor,
    private readonly deps: AdapterDependencies,
  ) {
    this.id = id;
  }

  async openSession(input: OpenSessionInput, signal?: AbortSignal): Promise<AgentSession> {
    const sessionId = input.sessionId ?? randomUUID();
    const hub = new EventHub({ sessionId });

    let proc: ManagedProcess | undefined;
    let streamOrApp: acp.Stream | acp.AgentApp;

    if (this.config.inProcessAgent) {
      streamOrApp = this.config.inProcessAgent;
    } else {
      if (!this.config.command) {
        throw new Error(`ACP driver "${this.id}" requires either command or inProcessAgent`);
      }
      proc = await this.deps.runtime.spawn(
        {
          command: this.config.command,
          args: this.config.args,
          cwd: input.cwd,
          env: { ...this.config.env, ...input.env },
        },
        signal,
      );
      streamOrApp = createHardenedAcpStream(proc.stdin, proc.stdout, {
        onSignInUrlDetected(url) {
          hub.emit({ type: 'auth.required', providerId: 'acp', signInUrl: url });
        },
      });
    }

    const session = new AcpSession(
      sessionId,
      this.id,
      this.flavor,
      input,
      this.deps,
      hub,
      streamOrApp,
      proc,
    );
    await session.initialize(signal);
    return session;
  }
}

class AcpSession implements AgentSession {
  readonly capabilities = ACP_BASE_CAPABILITIES;
  providerSessionId?: string;

  private connection?: acp.ClientConnection;
  private activeTurnId?: string;
  private activeBlockId?: string;
  private readonly activeTextByBlock = new Map<string, string>();
  private readonly activeToolCalls = new Set<string>();
  private readonly pendingGates = new Map<
    string,
    { resolve: (res: GateResolution) => void; reject: (err: unknown) => void }
  >();
  private readonly gateMiddleware;
  private closed = false;
  private steerQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly sessionId: string,
    private readonly driverId: string,
    private readonly flavor: AcpFlavor,
    private readonly openInput: OpenSessionInput,
    private readonly deps: AdapterDependencies,
    private readonly hub: EventHub,
    private readonly target: acp.Stream | acp.AgentApp,
    private readonly proc?: ManagedProcess,
  ) {
    this.gateMiddleware = deps.gateMiddleware ?? createPolicyGateMiddleware();
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    const clientApp = acp
      .client({ name: '@neopolitan-ai/adapter-acp' })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
        this.handlePermissionRequest(ctx.params),
      )
      .onRequest(acp.methods.client.elicitation.create, (ctx) =>
        this.handleElicitationRequest(ctx.params),
      )
      .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
        const safePath = await assertPathWithinWorkspace(
          this.deps.runtime,
          this.openInput.cwd,
          ctx.params.path,
        );
        const content = await this.deps.runtime.readFile(safePath);
        return { content };
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
        const safePath = await assertPathWithinWorkspace(
          this.deps.runtime,
          this.openInput.cwd,
          ctx.params.path,
        );
        await this.deps.runtime.writeFile(safePath, ctx.params.content);
        return {};
      })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        this.handleSessionUpdate(ctx.params);
      });

    this.connection =
      'writable' in this.target ? clientApp.connect(this.target) : clientApp.connect(this.target);

    if (this.proc) {
      void this.proc.exited.then((res) => {
        if (!this.closed) {
          this.hub.emit({
            type: 'session.ended',
            cause: 'unexpected_exit',
            exitCode: res.code ?? undefined,
          });
          this.hub.close();
        }
      });
    }

    await this.connection.agent.request(
      acp.methods.agent.initialize,
      {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: { name: '@neopolitan-ai/adapter-acp', version: '0.1.0' },
      },
      { cancellationSignal: signal },
    );

    const acpMcpServers: acp.McpServer[] = (this.openInput.mcpServers ?? [])
      .filter((m): m is Extract<typeof m, { transport: 'stdio' }> => m.transport === 'stdio')
      .map((m) => ({
        name: m.name,
        command: m.command,
        args: [...(m.args ?? [])],
        env: Object.entries(m.env ?? {}).map(([name, value]) => ({ name, value })),
      }));

    if (
      this.openInput.resumeAnchor?.providerId === 'acp' &&
      'sessionId' in this.openInput.resumeAnchor
    ) {
      const targetId = this.openInput.resumeAnchor.sessionId;
      await this.runWithOptionalIdleReadiness(
        this.connection.agent.request(
          acp.methods.agent.session.load,
          { sessionId: targetId, cwd: this.openInput.cwd, mcpServers: acpMcpServers },
          { cancellationSignal: signal },
        ),
      );
      this.providerSessionId = targetId;
    } else {
      const created = await this.connection.agent.request(
        acp.methods.agent.session.new,
        {
          cwd: this.openInput.cwd,
          mcpServers: acpMcpServers,
          ...(this.openInput.systemPrompt
            ? { _meta: { systemPrompt: this.openInput.systemPrompt } }
            : {}),
        },
        { cancellationSignal: signal },
      );
      this.providerSessionId = created.sessionId;
    }

    if (this.openInput.model && this.flavor.alwaysSetModelOnNewSession && this.providerSessionId) {
      await this.setModel(this.openInput.model, signal).catch(() => {});
    }

    this.hub.emit({
      type: 'session.started',
      providerSessionId: this.providerSessionId,
      anchor: this.getAnchor(),
      capabilities: this.capabilities,
      rawEvent: { protocol: 'acp', payload: { sessionId: this.providerSessionId } },
    });
  }

  private async runWithOptionalIdleReadiness<T>(promise: Promise<T>): Promise<T | undefined> {
    const idleMs = this.flavor.sessionLoadIdleMs;
    if (!idleMs) return promise;
    return Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), idleMs);
        timer.unref?.();
      }),
    ]);
  }

  events(options?: {
    readonly includeRaw?: boolean;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<AgentEvent> {
    return this.hub.subscribe(options);
  }

  async sendTurn(input: SendTurnInput, signal?: AbortSignal): Promise<DispatchReceipt> {
    if (this.closed || !this.connection || !this.providerSessionId) {
      return { outcome: 'rejected', reason: 'ACP session is not open', code: 'transport_error' };
    }
    const turnId = input.turnId ?? randomUUID();
    this.activeTurnId = turnId;
    this.activeBlockId = `msg-${turnId}`;

    this.hub.emit({
      type: 'turn.started',
      turnId,
      userMessageId: input.userMessageId,
      rawEvent: { protocol: 'acp', payload: { prompt: input.prompt } },
    });

    const promptText =
      this.openInput.contextPrelude && !this.activeTextByBlock.size
        ? `${this.openInput.contextPrelude}\n\n${input.prompt}`
        : input.prompt;

    const meta = this.flavor.promptMeta?.({ cwd: this.openInput.cwd });
    const promptPromise = this.connection.agent.request(
      acp.methods.agent.session.prompt,
      {
        sessionId: this.providerSessionId,
        prompt: [{ type: 'text', text: promptText }],
        ...(meta ? { _meta: meta } : {}),
      },
      { cancellationSignal: signal },
    );

    void promptPromise.then(
      (res) => {
        const completedText = this.activeBlockId
          ? this.activeTextByBlock.get(this.activeBlockId)
          : undefined;
        if (this.activeBlockId && completedText !== undefined) {
          this.hub.emit({
            type: 'assistant.completed',
            turnId,
            blockId: this.activeBlockId,
            text: completedText,
          });
        }
        // Inferred backgrounding: open tools when turn ends become backgrounded
        for (const callId of this.activeToolCalls) {
          this.hub.emit({
            type: 'tool.completed',
            turnId,
            blockId: callId,
            callId,
            status: 'succeeded',
            backgrounded: true,
          });
        }
        this.activeToolCalls.clear();
        const stopReason = res.stopReason;
        const status = stopReason === 'cancelled' ? 'cancelled' : 'completed';
        if (!this.closed) {
          this.hub.emit({
            type: 'turn.completed',
            turnId,
            status,
            disposition: 'identified',
            threadDisposition: 'reusable',
            rawEvent: { protocol: 'acp', payload: res },
          });
        }
      },
      (err: unknown) => {
        if (this.closed) return;
        const rawErrMsg =
          err instanceof acp.RequestError
            ? err.data !== undefined
              ? `${err.message}: ${JSON.stringify(err.data)}`
              : err.message
            : err instanceof Error
              ? err.message
              : String(err);
        const code = err instanceof acp.RequestError ? err.code : undefined;
        const flavorClass =
          typeof code === 'number' ? this.flavor.classifyError?.(code, rawErrMsg) : undefined;
        const failure = classifyProviderFailure(rawErrMsg, { code });
        this.hub.emit({
          type: 'turn.completed',
          turnId,
          status: code === -32800 ? 'cancelled' : 'failed',
          disposition: 'identified',
          threadDisposition: 'reusable',
          failure: flavorClass ? { ...failure, failureClass: flavorClass } : failure,
          rawEvent: { protocol: 'acp', payload: err },
        });
      },
    );

    return { outcome: 'accepted', turnId };
  }

  async steerTurn(input: SteerTurnInput, signal?: AbortSignal): Promise<DispatchReceipt> {
    this.steerQueue = this.steerQueue.then(async () => {
      await this.interruptTurn(this.activeTurnId, signal);
    });
    await this.steerQueue;
    return this.sendTurn({ prompt: input.prompt, attachments: input.attachments }, signal);
  }

  async interruptTurn(_turnId?: string, _signal?: AbortSignal): Promise<void> {
    if (!this.connection || !this.providerSessionId) return;
    const meta = this.flavor.cancelMeta?.();
    await this.connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.providerSessionId,
      ...(meta ? { _meta: meta } : {}),
    });
  }

  async setModel(model: ModelSelection, signal?: AbortSignal): Promise<void> {
    if (!this.connection || !this.providerSessionId) return;
    await this.connection.agent.request(
      acp.methods.agent.session.setConfigOption,
      { sessionId: this.providerSessionId, configId: 'model', value: model.model },
      { cancellationSignal: signal },
    );
  }

  async setPermissionMode(mode: PermissionMode, signal?: AbortSignal): Promise<void> {
    if (!this.connection || !this.providerSessionId) return;
    const modeMap: Record<PermissionMode, string> = {
      supervised: 'default',
      auto_accept_edits: 'acceptEdits',
      auto: 'auto',
      full_access: 'bypassPermissions',
    };
    await this.connection.agent.request(
      acp.methods.agent.session.setMode,
      { sessionId: this.providerSessionId, modeId: modeMap[mode] },
      { cancellationSignal: signal },
    );
  }

  async respondToGate(response: GateResponse): Promise<void> {
    const pending = this.pendingGates.get(response.requestId);
    if (pending) {
      this.pendingGates.delete(response.requestId);
      pending.resolve(response.resolution);
    }
  }

  private async handlePermissionRequest(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const requestId = `perm-${randomUUID()}`;
    const disguised =
      this.flavor.isDisguisedElicitation?.({
        toolCallId: params.toolCall.toolCallId,
        title: params.toolCall.title ?? undefined,
      }) ?? false;

    const req: GateRequest = {
      kind: 'approval',
      requestId,
      category: params.toolCall.kind === 'edit' ? 'file_write' : 'command',
      title: params.toolCall.title ?? 'Permission request',
      paths: params.toolCall.locations?.map((l) => l.path),
      rawInput: params.toolCall.rawInput,
      isDisguisedElicitation: disguised,
    };

    this.hub.emit({ type: 'gate.requested', turnId: this.activeTurnId, request: req });

    const resolution = await this.gateMiddleware.evaluate(
      req,
      {
        mode: this.openInput.permissionMode ?? 'supervised',
        cwd: this.openInput.cwd,
        sessionId: this.sessionId,
      },
      (gateReq, signal) =>
        this.deps.interactiveGateHandler
          ? this.deps.interactiveGateHandler(gateReq, signal)
          : new Promise<GateResolution>((resolve, reject) => {
              this.pendingGates.set(gateReq.requestId, { resolve, reject });
            }),
    );

    this.hub.emit({
      type: 'gate.resolved',
      turnId: this.activeTurnId,
      requestId,
      resolution,
    });

    if (resolution.decision === 'allow_once' || resolution.decision === 'allow_session') {
      const targetKind = resolution.decision === 'allow_session' ? 'allow_always' : 'allow_once';
      const chosen =
        params.options.find((o) => o.kind === targetKind) ??
        params.options.find((o) => o.kind === 'allow_once') ??
        params.options[0];
      return chosen
        ? { outcome: { outcome: 'selected', optionId: chosen.optionId } }
        : { outcome: { outcome: 'cancelled' } };
    }

    const rejectOpt = params.options.find((o) => o.kind === 'reject_once');
    if (resolution.decision === 'deny' && rejectOpt) {
      return { outcome: { outcome: 'selected', optionId: rejectOpt.optionId } };
    }
    return { outcome: { outcome: 'cancelled' } };
  }

  private async handleElicitationRequest(
    params: acp.CreateElicitationRequest,
  ): Promise<acp.CreateElicitationResponse> {
    const requestId = `elicit-${randomUUID()}`;
    const req: GateRequest = {
      kind: 'elicitation',
      requestId,
      mode: params.mode === 'url' ? 'url' : 'form',
      prompt: params.message,
      url: params.mode === 'url' && typeof params.url === 'string' ? params.url : undefined,
      personOnly: params.mode === 'url',
    };
    this.hub.emit({ type: 'gate.requested', turnId: this.activeTurnId, request: req });

    const resolution = await this.gateMiddleware.evaluate(
      req,
      {
        mode: this.openInput.permissionMode ?? 'supervised',
        cwd: this.openInput.cwd,
        sessionId: this.sessionId,
      },
      (gateReq, signal) =>
        this.deps.interactiveGateHandler
          ? this.deps.interactiveGateHandler(gateReq, signal)
          : new Promise<GateResolution>((resolve, reject) => {
              this.pendingGates.set(gateReq.requestId, { resolve, reject });
            }),
    );

    this.hub.emit({
      type: 'gate.resolved',
      turnId: this.activeTurnId,
      requestId,
      resolution,
    });

    if (resolution.decision === 'answered') {
      return {
        action: 'accept',
        content: resolution.answers as Record<string, string | number | boolean | string[]>,
      };
    }
    return { action: resolution.decision === 'skipped' ? 'decline' : 'cancel' };
  }

  private handleSessionUpdate(notification: acp.SessionNotification): void {
    const update = notification.update;
    const turnId = this.activeTurnId;
    const blockId = this.activeBlockId ?? `msg-${turnId ?? 'init'}`;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type === 'text') {
          const prev = this.activeTextByBlock.get(blockId) ?? '';
          this.activeTextByBlock.set(blockId, prev + update.content.text);
          this.hub.emit({
            type: 'assistant.delta',
            turnId,
            blockId,
            text: update.content.text,
            rawEvent: { protocol: 'acp', payload: notification },
          });
        }
        break;
      }
      case 'agent_thought_chunk': {
        if (update.content.type === 'text') {
          this.hub.emit({
            type: 'reasoning.delta',
            turnId,
            blockId: `reason-${blockId}`,
            text: update.content.text,
            rawEvent: { protocol: 'acp', payload: notification },
          });
        }
        break;
      }
      case 'tool_call': {
        this.activeToolCalls.add(update.toolCallId);
        const kind: ToolKind =
          update.kind === 'execute'
            ? 'command'
            : update.kind === 'edit'
              ? 'file_write'
              : update.kind === 'read'
                ? 'file_read'
                : 'other';
        this.hub.emit({
          type: 'tool.started',
          turnId,
          blockId: update.toolCallId,
          callId: update.toolCallId,
          name: update.title ?? update.toolCallId,
          kind,
          input: update.rawInput ?? {},
          rawEvent: { protocol: 'acp', payload: notification },
        });
        break;
      }
      case 'tool_call_update': {
        if (update.status === 'completed' || update.status === 'failed') {
          this.activeToolCalls.delete(update.toolCallId);
          this.hub.emit({
            type: 'tool.completed',
            turnId,
            blockId: update.toolCallId,
            callId: update.toolCallId,
            status: update.status === 'completed' ? 'succeeded' : 'failed',
            output: update.rawOutput,
            rawEvent: { protocol: 'acp', payload: notification },
          });
        }
        break;
      }
      case 'plan': {
        this.hub.emit({
          type: 'plan.updated',
          turnId,
          blockId: `plan-${turnId ?? 'current'}`,
          todos: update.entries.map((e) => ({
            title: e.content,
            status: e.status,
          })),
          rawEvent: { protocol: 'acp', payload: notification },
        });
        break;
      }
      default:
        break;
    }
  }

  getAnchor(): SessionAnchor {
    return {
      providerId: 'acp',
      agentId: this.driverId,
      sessionId: this.providerSessionId ?? this.sessionId,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pendingGates) {
      pending.resolve({ decision: 'cancelled', source: 'timeout' });
    }
    this.pendingGates.clear();
    this.connection?.close();
    await this.proc?.killTree();
    this.hub.emit({ type: 'session.ended', cause: 'requested' });
    this.hub.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
