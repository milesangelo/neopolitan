import { z } from 'zod';
import type { ProviderFailureClass } from './errors.js';

export type ProviderId =
  | 'claude-code'
  | 'codex'
  | 'acp'
  | 'opencode'
  | 'cursor'
  | 'grok'
  | 'kiro'
  | 'antigravity'
  | 'copilot'
  | 'gemini'
  | 'qwen'
  | 'amp'
  | 'droid'
  | 'omp'
  | 'pi'
  | 'pty'
  | (string & {});

export type PermissionMode = 'supervised' | 'auto_accept_edits' | 'auto' | 'full_access';

export type ToolKind =
  | 'command'
  | 'file_read'
  | 'file_write'
  | 'file_search'
  | 'web_search'
  | 'mcp'
  | 'subagent'
  | 'plan'
  | 'other';

export interface PlanTodoItem {
  readonly id?: string;
  readonly title: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly totalTokens?: number;
  readonly contextWindow?: number;
  readonly costUsd?: number;
}

export interface ModelSelection {
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly serviceTier?: string;
}

export type McpServerConfig =
  | {
      readonly name: string;
      readonly transport: 'stdio';
      readonly command: string;
      readonly args?: ReadonlyArray<string>;
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly name: string;
      readonly transport: 'http' | 'sse';
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    };

export const providerCapabilitiesSchema = z.object({
  transport: z.enum(['acp', 'native-sdk', 'json-rpc', 'http-sse', 'pty-hooks']),
  sessions: z.object({
    resume: z.boolean(),
    fork: z.enum(['none', 'tip', 'checkpoint']),
    rollback: z.boolean(),
    switchModelInSession: z.boolean(),
    switchPermissionModeInSession: z.boolean(),
    survivesProcessRestart: z.boolean(),
  }),
  turns: z.object({
    interrupt: z.boolean(),
    steering: z.enum(['none', 'inject', 'queue', 'cancel-and-resend']),
    queuedMessages: z.boolean(),
    terminalStatusQuality: z.enum(['strong', 'weak', 'none']),
  }),
  streaming: z.object({
    assistantDeltas: z.boolean(),
    reasoningDeltas: z.boolean(),
    toolLifecycle: z.boolean(),
    toolOutputDeltas: z.boolean(),
    planUpdates: z.boolean(),
    fileDiffs: z.boolean(),
  }),
  gating: z.object({
    commandApproval: z.boolean(),
    fileChangeApproval: z.boolean(),
    structuredElicitation: z.boolean(),
    urlElicitation: z.boolean(),
    enforcement: z.enum(['provider', 'client-boundary', 'coarse-flags']),
  }),
  context: z.object({
    systemPrompt: z.boolean(),
    contextPrelude: z.boolean(),
    compact: z.boolean(),
    mcpServers: z.array(z.enum(['stdio', 'http', 'acp-bridge'])).readonly(),
    imageAttachments: z.boolean(),
  }),
  subagents: z.object({
    supported: z.boolean(),
    lifecycleEvents: z.boolean(),
    stoppable: z.boolean(),
  }),
});

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

export type SessionAnchor =
  | {
      readonly providerId: 'claude-code';
      readonly sessionId: string;
      readonly messageUuid?: string;
      readonly turnTailUuid?: string;
    }
  | {
      readonly providerId: 'codex';
      readonly threadId: string;
      readonly turnId?: string;
      readonly userMessageId?: string;
    }
  | {
      readonly providerId: 'acp';
      readonly agentId: string;
      readonly sessionId: string;
      readonly replayCursor?: string;
    }
  | {
      readonly providerId: ProviderId;
      readonly sessionId: string;
      readonly opaqueCursor?: Readonly<Record<string, unknown>>;
    };

export interface DiscoveredModelOption {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly reasoningEfforts?: ReadonlyArray<string>;
  readonly contextWindow?: number;
}

export interface OptionsDiscoveryPatch {
  readonly models?: ReadonlyArray<DiscoveredModelOption>;
  readonly modes?: ReadonlyArray<string>;
  readonly complete: boolean;
  readonly fromCache: boolean;
}

export interface ReviewComment {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly side: 'left' | 'right';
  readonly text: string;
  readonly codeLine?: string;
}

export interface ReviewTarget {
  readonly repos: ReadonlyArray<{
    readonly repoId: string;
    readonly name: string;
    readonly baseCommit: string;
  }>;
  readonly comments?: ReadonlyArray<ReviewComment>;
  readonly instructions?: string;
}

export type DispatchReceipt =
  | { readonly outcome: 'accepted'; readonly turnId: string; readonly providerTurnId?: string }
  | { readonly outcome: 'admitted'; readonly turnId: string }
  | { readonly outcome: 'rejected'; readonly reason: string; readonly code?: ProviderFailureClass }
  | { readonly outcome: 'unknown'; readonly turnId: string; readonly reason: string };

export interface ImageAttachment {
  readonly mimeType: string;
  readonly path?: string;
  readonly base64?: string;
  readonly name?: string;
}

export interface OpenSessionInput<TProviderOptions = Record<string, unknown>> {
  readonly sessionId?: string;
  readonly cwd: string;
  readonly model?: ModelSelection;
  readonly permissionMode?: PermissionMode;
  readonly systemPrompt?: string;
  readonly mcpServers?: ReadonlyArray<McpServerConfig>;
  readonly resumeAnchor?: SessionAnchor;
  readonly contextPrelude?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly providerOptions?: TProviderOptions;
}

export interface SendTurnInput<TProviderOptions = Record<string, unknown>> {
  readonly turnId?: string;
  readonly userMessageId?: string;
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<ImageAttachment>;
  readonly model?: ModelSelection;
  readonly providerOptions?: TProviderOptions;
}

export interface SteerTurnInput<TProviderOptions = Record<string, unknown>> {
  readonly turnId?: string;
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<ImageAttachment>;
  readonly providerOptions?: TProviderOptions;
}

export interface ForkSessionInput {
  readonly fromTurnId?: string;
  readonly fromMessageId?: string;
}

export interface RollbackTarget {
  readonly turnId?: string;
  readonly messageId?: string;
  readonly steps?: number;
}

export interface ProbeContext {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ProviderProbeResult {
  readonly available: boolean;
  readonly version?: string;
  readonly executablePath?: string;
  readonly authStatus?: 'authenticated' | 'configured' | 'unauthenticated' | 'unknown' | 'unavailable';
  readonly reason?: string;
}

/**
 * Formats structured ReviewTarget comments into a deterministic prompt payload
 * for providers without a native review RPC (e.g. non-Codex adapters).
 */
export function formatReviewTargetPrompt(target: ReviewTarget): string {
  const sections: string[] = [];
  if (target.repos.length > 0) {
    sections.push(
      'Review targets:\n' +
        target.repos.map((r) => `- ${r.name} (base: ${r.baseCommit})`).join('\n'),
    );
  }
  if (target.comments && target.comments.length > 0) {
    sections.push(
      'Inline review comments:\n' +
        target.comments
          .map((c) => {
            const snippet = c.codeLine ? `\n  > ${c.codeLine}` : '';
            return `- ${c.filePath}:${c.lineNumber} (${c.side}): ${c.text}${snippet}`;
          })
          .join('\n'),
    );
  }
  if (target.instructions) {
    sections.push(`Instructions:\n${target.instructions}`);
  }
  return sections.join('\n\n');
}
