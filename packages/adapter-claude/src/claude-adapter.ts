import { randomUUID } from 'node:crypto';
import {
  type AdapterDependencies,
  type AgentEvent,
  type AgentSession,
  type DispatchReceipt,
  EventHub,
  type OpenSessionInput,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderDriver,
  type SendTurnInput,
  type SessionAnchor,
  type TokenUsage,
  classifyProviderFailure,
  createLfNdjsonFramer,
} from '@neopolitan/core';
import { z } from 'zod';
import {
  type ClaudeJsonConfig,
  scrubClaudeAuthEnv,
  splicePrefixArgsForScript,
  withoutRejectedClaudeApiKey,
} from './env-sanitizer.js';

export interface ClaudeDriverConfig {
  readonly executablePath?: string;
  readonly prefixArgs?: ReadonlyArray<string>;
  readonly configDir?: string;
  readonly claudeJson?: ClaudeJsonConfig;
  readonly mcpRegistrationTimeoutMs?: number;
}

const claudeConfigSchema = z.object({
  executablePath: z.string().optional(),
  prefixArgs: z.array(z.string()).optional(),
  configDir: z.string().optional(),
  mcpRegistrationTimeoutMs: z.number().int().positive().optional(),
});

export const CLAUDE_BASE_CAPABILITIES: ProviderCapabilities = {
  transport: 'native-sdk',
  sessions: {
    resume: true,
    fork: 'checkpoint',
    rollback: true,
    switchModelInSession: true,
    switchPermissionModeInSession: true,
    survivesProcessRestart: false,
  },
  turns: {
    interrupt: true,
    steering: 'cancel-and-resend',
    queuedMessages: false,
    terminalStatusQuality: 'strong',
  },
  streaming: {
    assistantDeltas: true,
    reasoningDeltas: true,
    toolLifecycle: true,
    toolOutputDeltas: false,
    planUpdates: false,
    fileDiffs: false,
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
    imageAttachments: true,
  },
  subagents: {
    supported: true,
    lifecycleEvents: true,
    stoppable: true,
  },
};

/**
 * Merges `message_start` usage with cumulative `message_delta` usage while preserving
 * non-zero input/cache fields (Claude stream-json quirk).
 */
export function mergeClaudeTokenUsage(
  prev: TokenUsage | undefined,
  delta: Partial<TokenUsage>,
): TokenUsage {
  return {
    inputTokens: delta.inputTokens && delta.inputTokens > 0 ? delta.inputTokens : prev?.inputTokens,
    outputTokens:
      delta.outputTokens && delta.outputTokens > 0 ? delta.outputTokens : prev?.outputTokens,
    cachedInputTokens:
      delta.cachedInputTokens && delta.cachedInputTokens > 0
        ? delta.cachedInputTokens
        : prev?.cachedInputTokens,
    cacheCreationTokens:
      delta.cacheCreationTokens && delta.cacheCreationTokens > 0
        ? delta.cacheCreationTokens
        : prev?.cacheCreationTokens,
    costUsd: delta.costUsd ?? prev?.costUsd,
    contextWindow: delta.contextWindow ?? prev?.contextWindow,
  };
}

export function createClaudeDriver(
  defaultConfig: ClaudeDriverConfig = {},
): ProviderDriver<ClaudeDriverConfig> {
  return {
    id: 'claude-code',
    label: 'Claude Code',
    configSchema: claudeConfigSchema as z.ZodType<ClaudeDriverConfig>,
    baseCapabilities: CLAUDE_BASE_CAPABILITIES,
    async probe(ctx, runtime) {
      const cmd = defaultConfig.executablePath ?? 'claude';
      const resolved = await runtime.which(cmd, ctx.env);
      if (!resolved) {
        return {
          available: false,
          reason: `Claude Code executable "${cmd}" not found`,
          authStatus: 'unavailable',
        };
      }
      return { available: true, executablePath: resolved, authStatus: 'unknown' };
    },
    async createAdapter(config, deps): Promise<ProviderAdapter> {
      const merged = { ...defaultConfig, ...config };
      return new ClaudeAdapter(merged, deps);
    },
  };
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude-code' as const;
  readonly capabilities = CLAUDE_BASE_CAPABILITIES;

  constructor(
    private readonly config: ClaudeDriverConfig,
    private readonly deps: AdapterDependencies,
  ) {}

  async openSession(input: OpenSessionInput): Promise<AgentSession> {
    return new ClaudeSession(this.config, input, this.deps);
  }
}

class ClaudeSession implements AgentSession {
  readonly sessionId: string;
  providerSessionId?: string;
  readonly capabilities = CLAUDE_BASE_CAPABILITIES;

  private readonly hub: EventHub;
  private activeAbort?: AbortController;
  private activeProcess?: import('@neopolitan/core').ManagedProcess;
  private closed = false;
  private expectedResumeId?: string;
  private lastMessageUuid?: string;
  private currentUsage?: TokenUsage;

  constructor(
    private readonly config: ClaudeDriverConfig,
    private readonly openInput: OpenSessionInput,
    private readonly deps: AdapterDependencies,
  ) {
    this.sessionId = openInput.sessionId ?? randomUUID();
    this.hub = new EventHub({ sessionId: this.sessionId });
    if (
      openInput.resumeAnchor?.providerId === 'claude-code' &&
      'sessionId' in openInput.resumeAnchor
    ) {
      this.expectedResumeId = openInput.resumeAnchor.sessionId;
      this.providerSessionId = openInput.resumeAnchor.sessionId;
    }

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

  async sendTurn(input: SendTurnInput, signal?: AbortSignal): Promise<DispatchReceipt> {
    if (this.closed) {
      return { outcome: 'rejected', reason: 'Claude session is closed', code: 'transport_error' };
    }
    const turnId = input.turnId ?? randomUUID();
    const ac = new AbortController();
    this.activeAbort = ac;
    signal?.addEventListener('abort', () => ac.abort(), { once: true });

    const executable = this.config.executablePath ?? 'claude';
    const rawArgs: string[] = ['-p', input.prompt, '--output-format', 'stream-json', '--verbose'];
    if (this.providerSessionId) {
      rawArgs.push('--resume', this.providerSessionId);
    }
    if (this.openInput.model?.model) {
      rawArgs.push('--model', this.openInput.model.model);
    }
    if (this.openInput.systemPrompt) {
      rawArgs.push('--system-prompt', this.openInput.systemPrompt);
    }
    if (this.openInput.permissionMode === 'full_access') {
      rawArgs.push('--dangerously-skip-permissions');
    } else if (this.openInput.permissionMode === 'auto_accept_edits') {
      rawArgs.push('--permission-mode', 'acceptEdits');
    }

    const args = splicePrefixArgsForScript(executable, rawArgs, this.config.prefixArgs);
    let env = scrubClaudeAuthEnv(
      { ...process.env, ...this.openInput.env },
      { configDir: this.config.configDir, platform: this.deps.runtime.platform },
    );
    env = withoutRejectedClaudeApiKey(env, this.config.claudeJson);

    this.hub.emit({
      type: 'turn.started',
      turnId,
      userMessageId: input.userMessageId,
    });

    try {
      const proc = await this.deps.runtime.spawn(
        { command: executable, args, cwd: this.openInput.cwd, env },
        ac.signal,
      );
      this.activeProcess = proc;

      void this.consumeStreamJson(turnId, proc, ac.signal);
      return { outcome: 'accepted', turnId };
    } catch (err) {
      return {
        outcome: 'rejected',
        reason: err instanceof Error ? err.message : String(err),
        code: 'transport_error',
      };
    }
  }

  private async consumeStreamJson(
    turnId: string,
    proc: import('@neopolitan/core').ManagedProcess,
    signal: AbortSignal,
  ): Promise<void> {
    const blockId = `msg-${turnId}`;
    let sawTerminalResult = false;
    let accumulatedText = '';

    const framer = createLfNdjsonFramer({
      onJson: (value) => {
        if (!value || typeof value !== 'object') return;
        const msg = value as Record<string, unknown>;

        // Ignore foreign boot session_id frames emitted before system/init on older CLIs
        if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
          this.providerSessionId = msg.session_id;
          this.expectedResumeId = undefined;
          return;
        }
        if (
          this.expectedResumeId &&
          typeof msg.session_id === 'string' &&
          msg.session_id !== this.expectedResumeId &&
          msg.type !== 'result'
        ) {
          return;
        }

        if (msg.type === 'assistant' && msg.message && typeof msg.message === 'object') {
          const message = msg.message as Record<string, unknown>;
          if (typeof msg.uuid === 'string') {
            this.lastMessageUuid = msg.uuid;
          }
          if (message.usage && typeof message.usage === 'object') {
            const u = message.usage as Record<string, number>;
            this.currentUsage = mergeClaudeTokenUsage(this.currentUsage, {
              inputTokens: u.input_tokens,
              outputTokens: u.output_tokens,
              cachedInputTokens: u.cache_read_input_tokens,
              cacheCreationTokens: u.cache_creation_input_tokens,
            });
            this.hub.emit({ type: 'usage.updated', turnId, usage: this.currentUsage });
          }
          const content = Array.isArray(message.content) ? message.content : [];
          for (const part of content) {
            if (!part || typeof part !== 'object') continue;
            const block = part as Record<string, unknown>;
            if (block.type === 'text' && typeof block.text === 'string') {
              accumulatedText += block.text;
              this.hub.emit({
                type: 'assistant.delta',
                turnId,
                blockId,
                text: block.text,
                rawEvent: { protocol: 'claude-stream-json', payload: msg },
              });
            } else if (block.type === 'tool_use' && typeof block.id === 'string') {
              this.hub.emit({
                type: 'tool.started',
                turnId,
                blockId: block.id,
                callId: block.id,
                name: String(block.name ?? 'tool'),
                kind: 'other',
                input: block.input ?? {},
                rawEvent: { protocol: 'claude-stream-json', payload: msg },
              });
            }
          }
        } else if (msg.type === 'result') {
          sawTerminalResult = true;
          if (typeof msg.session_id === 'string') {
            this.providerSessionId = msg.session_id;
          }
          const isError = Boolean(msg.is_error);
          if (accumulatedText && !isError) {
            this.hub.emit({ type: 'assistant.completed', turnId, blockId, text: accumulatedText });
          }
          this.hub.emit({
            type: 'turn.completed',
            turnId,
            status: isError ? 'failed' : 'completed',
            disposition: 'identified',
            threadDisposition: 'reusable',
            usage: this.currentUsage,
            failure: isError
              ? classifyProviderFailure(String(msg.result ?? proc.getStderrTail()))
              : undefined,
            rawEvent: { protocol: 'claude-stream-json', payload: msg },
          });
        }
      },
    });

    const reader = proc.stdout.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) framer.push(value);
      }
      framer.flush();
    } finally {
      const exit = await proc.exited;
      if (!sawTerminalResult && !this.closed) {
        const stderr = proc.getStderrTail();
        this.hub.emit({
          type: 'turn.completed',
          turnId,
          status: signal.aborted ? 'interrupted' : exit.code === 0 ? 'completed' : 'failed',
          disposition: 'identified',
          threadDisposition: 'reusable',
          failure:
            exit.code && exit.code !== 0 && !signal.aborted
              ? classifyProviderFailure(stderr || `Claude exited with code ${exit.code}`)
              : undefined,
        });
      }
    }
  }

  async interruptTurn(): Promise<void> {
    this.activeAbort?.abort();
    await this.activeProcess?.killTree();
  }

  async respondToGate(): Promise<void> {
    // Handled via MCP/Hook bridge when using interactive hooks
  }

  getAnchor(): SessionAnchor {
    return {
      providerId: 'claude-code',
      sessionId: this.providerSessionId ?? this.sessionId,
      messageUuid: this.lastMessageUuid,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.activeAbort?.abort();
    await this.activeProcess?.killTree();
    this.hub.emit({ type: 'session.ended', cause: 'requested' });
    this.hub.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
