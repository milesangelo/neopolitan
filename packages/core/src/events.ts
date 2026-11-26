import { z } from 'zod';
import type { SanitizedProviderFailure } from './errors.js';
import type { GateRequest, GateResolution } from './gate.js';
import {
  type PlanTodoItem,
  type ProviderCapabilities,
  type ProviderId,
  type SessionAnchor,
  type TokenUsage,
  type ToolKind,
  providerCapabilitiesSchema,
} from './types.js';

export interface AgentEventBase {
  readonly eventId: string;
  readonly seq: number;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly parentBlockId?: string;
  readonly timestamp: number;
  /** Opt-in escape hatch populated only when `includeRaw: true`. */
  readonly rawEvent?: { readonly protocol: string; readonly payload: unknown };
}

export type AgentEvent = AgentEventBase &
  (
    | {
        readonly type: 'session.started';
        readonly providerSessionId?: string;
        readonly anchor: SessionAnchor;
        readonly capabilities: ProviderCapabilities;
      }
    | {
        readonly type: 'session.status';
        readonly state: 'working' | 'waiting' | 'blocked' | 'done';
        readonly sessionBoundary?: boolean;
        readonly reason?: string;
      }
    | {
        readonly type: 'session.ended';
        readonly cause: 'requested' | 'unexpected_exit' | 'idle_timeout';
        readonly exitCode?: number;
      }
    | {
        readonly type: 'turn.started';
        readonly providerTurnId?: string;
        readonly userMessageId?: string;
      }
    | {
        readonly type: 'turn.completed';
        readonly status: 'completed' | 'interrupted' | 'cancelled' | 'failed';
        readonly disposition: 'identified' | 'ambiguous';
        readonly threadDisposition: 'reusable' | 'broken';
        readonly failure?: SanitizedProviderFailure;
        readonly usage?: TokenUsage;
      }
    | {
        readonly type: 'assistant.delta';
        readonly blockId: string;
        readonly text: string;
        readonly phase?: 'commentary' | 'partial_answer' | 'final_answer';
      }
    | {
        readonly type: 'assistant.completed';
        readonly blockId: string;
        readonly text: string;
      }
    | {
        readonly type: 'reasoning.delta';
        readonly blockId: string;
        readonly text: string;
      }
    | {
        readonly type: 'reasoning.completed';
        readonly blockId: string;
        readonly text: string;
      }
    | {
        readonly type: 'tool.started';
        readonly blockId: string;
        readonly callId: string;
        readonly name: string;
        readonly kind: ToolKind;
        readonly input: unknown;
      }
    | {
        readonly type: 'tool.output';
        readonly blockId: string;
        readonly callId: string;
        readonly stream: 'stdout' | 'stderr' | 'combined';
        readonly chunk: string;
        readonly ephemeral?: boolean;
      }
    | {
        readonly type: 'tool.completed';
        readonly blockId: string;
        readonly callId: string;
        readonly status: 'succeeded' | 'failed' | 'cancelled';
        readonly output?: unknown;
        readonly backgrounded?: boolean;
      }
    | {
        readonly type: 'file.diff';
        readonly blockId: string;
        readonly paths: ReadonlyArray<string>;
        readonly patch: string;
      }
    | {
        readonly type: 'plan.updated';
        readonly blockId: string;
        readonly todos: ReadonlyArray<PlanTodoItem>;
        readonly markdown?: string;
      }
    | {
        readonly type: 'gate.requested';
        readonly request: GateRequest;
      }
    | {
        readonly type: 'gate.resolved';
        readonly requestId: string;
        readonly resolution: GateResolution;
      }
    | {
        readonly type: 'subagent.updated';
        readonly subagentId: string;
        readonly parentTurnId: string;
        readonly status: 'running' | 'waiting' | 'completed' | 'failed';
        readonly label?: string;
      }
    | {
        readonly type: 'compaction.updated';
        readonly status: 'started' | 'completed' | 'failed';
        readonly summaryTokens?: number;
      }
    | {
        readonly type: 'usage.updated';
        readonly usage: TokenUsage;
      }
    | {
        readonly type: 'auth.required';
        readonly providerId: ProviderId;
        readonly method?: string;
        readonly signInUrl?: string;
        readonly instructions?: string;
      }
    | {
        readonly type: 'history.reset';
        readonly reason: 'full_thread_replay' | 'rewind';
        readonly retainUpToSeq?: number;
      }
    | {
        readonly type: 'notice';
        readonly level: 'info' | 'warning' | 'error';
        readonly code: string;
        readonly message: string;
      }
  );

export type AgentEventInput = AgentEvent extends infer E
  ? E extends AgentEvent
    ? Omit<E, 'eventId' | 'seq' | 'sessionId' | 'timestamp'> & {
        readonly eventId?: string;
        readonly timestamp?: number;
      }
    : never
  : never;

const baseEventSchema = z.object({
  eventId: z.string(),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  turnId: z.string().optional(),
  parentBlockId: z.string().optional(),
  timestamp: z.number(),
  rawEvent: z
    .object({
      protocol: z.string(),
      payload: z.unknown(),
    })
    .optional(),
});

const tokenUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  contextWindow: z.number().optional(),
  costUsd: z.number().optional(),
});

export const agentEventSchema = z.discriminatedUnion('type', [
  baseEventSchema.extend({
    type: z.literal('session.started'),
    providerSessionId: z.string().optional(),
    anchor: z.object({ providerId: z.string(), sessionId: z.string().optional() }).passthrough(),
    capabilities: providerCapabilitiesSchema,
  }),
  baseEventSchema.extend({
    type: z.literal('session.status'),
    state: z.enum(['working', 'waiting', 'blocked', 'done']),
    sessionBoundary: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('session.ended'),
    cause: z.enum(['requested', 'unexpected_exit', 'idle_timeout']),
    exitCode: z.number().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('turn.started'),
    providerTurnId: z.string().optional(),
    userMessageId: z.string().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('turn.completed'),
    status: z.enum(['completed', 'interrupted', 'cancelled', 'failed']),
    disposition: z.enum(['identified', 'ambiguous']),
    threadDisposition: z.enum(['reusable', 'broken']),
    failure: z
      .object({
        failureClass: z.string(),
        retryable: z.boolean(),
        safeMessage: z.string(),
        guidance: z.string().optional(),
        retryAfterMs: z.number().optional(),
      })
      .optional(),
    usage: tokenUsageSchema.optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('assistant.delta'),
    blockId: z.string(),
    text: z.string(),
    phase: z.enum(['commentary', 'partial_answer', 'final_answer']).optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('assistant.completed'),
    blockId: z.string(),
    text: z.string(),
  }),
  baseEventSchema.extend({
    type: z.literal('reasoning.delta'),
    blockId: z.string(),
    text: z.string(),
  }),
  baseEventSchema.extend({
    type: z.literal('reasoning.completed'),
    blockId: z.string(),
    text: z.string(),
  }),
  baseEventSchema.extend({
    type: z.literal('tool.started'),
    blockId: z.string(),
    callId: z.string(),
    name: z.string(),
    kind: z.enum([
      'command',
      'file_read',
      'file_write',
      'file_search',
      'web_search',
      'mcp',
      'subagent',
      'plan',
      'other',
    ]),
    input: z.unknown(),
  }),
  baseEventSchema.extend({
    type: z.literal('tool.output'),
    blockId: z.string(),
    callId: z.string(),
    stream: z.enum(['stdout', 'stderr', 'combined']),
    chunk: z.string(),
    ephemeral: z.boolean().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('tool.completed'),
    blockId: z.string(),
    callId: z.string(),
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    output: z.unknown().optional(),
    backgrounded: z.boolean().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('file.diff'),
    blockId: z.string(),
    paths: z.array(z.string()),
    patch: z.string(),
  }),
  baseEventSchema.extend({
    type: z.literal('plan.updated'),
    blockId: z.string(),
    todos: z.array(
      z.object({
        id: z.string().optional(),
        title: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
      }),
    ),
    markdown: z.string().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('gate.requested'),
    request: z
      .object({ kind: z.enum(['approval', 'elicitation']), requestId: z.string() })
      .passthrough(),
  }),
  baseEventSchema.extend({
    type: z.literal('gate.resolved'),
    requestId: z.string(),
    resolution: z.object({ decision: z.string(), source: z.string() }).passthrough(),
  }),
  baseEventSchema.extend({
    type: z.literal('subagent.updated'),
    subagentId: z.string(),
    parentTurnId: z.string(),
    status: z.enum(['running', 'waiting', 'completed', 'failed']),
    label: z.string().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('compaction.updated'),
    status: z.enum(['started', 'completed', 'failed']),
    summaryTokens: z.number().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('usage.updated'),
    usage: tokenUsageSchema,
  }),
  baseEventSchema.extend({
    type: z.literal('auth.required'),
    providerId: z.string(),
    method: z.string().optional(),
    signInUrl: z.string().optional(),
    instructions: z.string().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('history.reset'),
    reason: z.enum(['full_thread_replay', 'rewind']),
    retainUpToSeq: z.number().optional(),
  }),
  baseEventSchema.extend({
    type: z.literal('notice'),
    level: z.enum(['info', 'warning', 'error']),
    code: z.string(),
    message: z.string(),
  }),
]);
