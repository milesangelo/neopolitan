import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  EventHub,
  type AdapterDependencies,
  type AgentEvent,
  type AgentSession,
  type DispatchReceipt,
  type ManagedPty,
  type OpenSessionInput,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderDriver,
  type PtySpawnSpec,
  type SendTurnInput,
  type SessionAnchor,
} from '@neopolitan/core';
import { parseOsc7501Sequences, type Osc7501Status } from './osc7501.js';
import {
  reduceHookAndOscStatus,
  reduceHostTurnEnd,
  type HookStatusUpdate,
  type HostTurnRecord,
} from './hook-server.js';

export interface PtyBackend {
  spawnPty(spec: PtySpawnSpec): Promise<ManagedPty>;
}

export interface PtyDriverConfig {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly ptyBackend?: PtyBackend;
  readonly hookServerUrl?: string;
}

const ptyConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  hookServerUrl: z.string().optional(),
});

export const PTY_BASE_CAPABILITIES: ProviderCapabilities = {
  transport: 'pty-hooks',
  sessions: {
    resume: false,
    fork: 'none',
    rollback: false,
    switchModelInSession: false,
    switchPermissionModeInSession: false,
    survivesProcessRestart: false,
  },
  turns: {
    interrupt: true,
    steering: 'inject',
    queuedMessages: false,
    terminalStatusQuality: 'weak',
  },
  streaming: {
    assistantDeltas: false,
    reasoningDeltas: false,
    toolLifecycle: false,
    toolOutputDeltas: true,
    planUpdates: false,
    fileDiffs: false,
  },
  gating: {
    commandApproval: false,
    fileChangeApproval: false,
    structuredElicitation: false,
    urlElicitation: false,
    enforcement: 'coarse-flags',
  },
  context: {
    systemPrompt: false,
    contextPrelude: false,
    compact: false,
    mcpServers: [],
    imageAttachments: false,
  },
  subagents: {
    supported: false,
    lifecycleEvents: false,
    stoppable: false,
  },
};

/**
 * Lazily imports optional peerDependency `node-pty` so core & server installs require
 * zero C++ compilation unless PTY mode is explicitly activated.
 */
export async function loadNodePtyBackend(): Promise<PtyBackend> {
  const modName = 'node-pty';
  const nodePty = (await import(modName)) as {
    spawn(
      file: string,
      args: string[],
      options: { name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string> },
    ): {
      pid: number;
      write(data: string): void;
      resize(cols: number, rows: number): void;
      onData(cb: (data: string) => void): { dispose(): void };
      onExit(cb: (e: { exitCode: number }) => void): { dispose(): void };
      kill(signal?: string): void;
    };
  };

  return {
    async spawnPty(spec) {
      const pty = nodePty.spawn(spec.command, [...(spec.args ?? [])], {
        name: spec.term ?? 'xterm-256color',
        cols: spec.cols ?? 120,
        rows: spec.rows ?? 40,
        cwd: spec.cwd,
        env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) },
      });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        pty.onExit(({ exitCode }) => resolve({ code: exitCode, signal: null }));
      });
      return {
        pid: pty.pid,
        write: (d) => pty.write(d),
        resize: (c, r) => pty.resize(c, r),
        onData: (cb) => {
          const disp = pty.onData(cb);
          return () => disp.dispose();
        },
        exited,
        async killTree() {
          pty.kill();
        },
      };
    },
  };
}

export function createPtyDriver(defaultConfig: PtyDriverConfig): ProviderDriver<PtyDriverConfig> {
  return {
    id: 'pty',
    label: `PTY (${defaultConfig.command})`,
    configSchema: ptyConfigSchema as z.ZodType<PtyDriverConfig>,
    baseCapabilities: PTY_BASE_CAPABILITIES,
    async probe(ctx, runtime) {
      const resolved = await runtime.which(defaultConfig.command, ctx.env);
      if (!resolved) {
        return {
          available: false,
          reason: `CLI "${defaultConfig.command}" not found`,
          authStatus: 'unavailable',
        };
      }
      return { available: true, executablePath: resolved, authStatus: 'unknown' };
    },
    async createAdapter(config, deps): Promise<ProviderAdapter> {
      return new PtyAdapter({ ...defaultConfig, ...config }, deps);
    },
  };
}

export class PtyAdapter implements ProviderAdapter {
  readonly id = 'pty' as const;
  readonly capabilities = PTY_BASE_CAPABILITIES;

  constructor(
    private readonly config: PtyDriverConfig,
    private readonly deps: AdapterDependencies,
  ) {}

  async openSession(input: OpenSessionInput): Promise<AgentSession> {
    const backend =
      this.config.ptyBackend ??
      (this.deps.runtime.spawnPty ? { spawnPty: this.deps.runtime.spawnPty.bind(this.deps.runtime) } : await loadNodePtyBackend());
    const session = new PtySession(this.config, input, backend);
    await session.start();
    return session;
  }
}

class PtySession implements AgentSession {
  readonly sessionId: string;
  readonly capabilities = PTY_BASE_CAPABILITIES;

  private readonly hub: EventHub;
  private pty?: ManagedPty;
  private unsubData?: () => void;
  private lastHook?: HookStatusUpdate;
  private lastOsc?: Osc7501Status;
  private turnRecord: HostTurnRecord = { currentTurnKey: 'seed' };
  private activeTurnId?: string;
  private closed = false;

  constructor(
    private readonly config: PtyDriverConfig,
    private readonly openInput: OpenSessionInput,
    private readonly backend: PtyBackend,
  ) {
    this.sessionId = openInput.sessionId ?? randomUUID();
    this.hub = new EventHub({ sessionId: this.sessionId });
  }

  async start(): Promise<void> {
    this.pty = await this.backend.spawnPty({
      command: this.config.command,
      args: this.config.args,
      cwd: this.openInput.cwd,
      env: {
        ...(this.openInput.env ?? {}),
        ...(this.config.hookServerUrl ? { AGENT_HOOK_URL: this.config.hookServerUrl } : {}),
      },
    });

    this.unsubData = this.pty.onData((chunk) => {
      const oscList = parseOsc7501Sequences(chunk);
      for (const osc of oscList) {
        this.lastOsc = osc;
        const reduced = reduceHookAndOscStatus({
          lastHook: this.lastHook,
          lastOsc: this.lastOsc,
        });
        this.hub.emit({
          type: 'session.status',
          turnId: this.activeTurnId,
          state: reduced.state,
          sessionBoundary: reduced.sessionBoundary,
        });
        if (osc.state === 'done' && this.activeTurnId) {
          const { next, disposition } = reduceHostTurnEnd(this.turnRecord, {
            kind: 'stop',
            at: osc.timestamp,
          });
          this.turnRecord = next;
          const completedTurnId = this.activeTurnId;
          this.activeTurnId = undefined;
          this.hub.emit({
            type: 'turn.completed',
            turnId: completedTurnId,
            status: 'completed',
            disposition: disposition ?? 'ambiguous',
            threadDisposition: 'reusable',
          });
        }
      }

      this.hub.emit({
        type: 'tool.output',
        turnId: this.activeTurnId,
        blockId: `pty-${this.sessionId}`,
        callId: `pty-${this.sessionId}`,
        stream: 'stdout',
        chunk,
        ephemeral: true,
      });
    });

    void this.pty.exited.then((res) => {
      if (!this.closed) {
        this.hub.emit({
          type: 'session.ended',
          cause: 'unexpected_exit',
          exitCode: res.code ?? undefined,
        });
        this.hub.close();
      }
    });

    this.hub.emit({
      type: 'session.started',
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
    if (this.closed || !this.pty) {
      return { outcome: 'rejected', reason: 'PTY session closed', code: 'transport_error' };
    }
    const turnId = input.turnId ?? randomUUID();
    this.activeTurnId = turnId;
    const { next } = reduceHostTurnEnd(this.turnRecord, {
      kind: 'prompt_submit',
      turnKey: turnId,
      at: Date.now(),
    });
    this.turnRecord = next;

    this.hub.emit({ type: 'turn.started', turnId, userMessageId: input.userMessageId });
    this.pty.write(`${input.prompt}\n`);
    return { outcome: 'admitted', turnId };
  }

  async interruptTurn(): Promise<void> {
    this.pty?.write('\x03'); // Ctrl+C
  }

  async respondToGate(): Promise<void> {}

  getAnchor(): SessionAnchor {
    return { providerId: 'pty', sessionId: this.sessionId };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubData?.();
    await this.pty?.killTree();
    this.hub.emit({ type: 'session.ended', cause: 'requested' });
    this.hub.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
