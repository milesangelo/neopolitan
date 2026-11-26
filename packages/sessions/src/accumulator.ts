import type {
  AgentEvent,
  GateRequest,
  GateResolution,
  PlanTodoItem,
  ToolKind,
} from '@neopolitan/core';

export type ContentBlock =
  | {
      readonly kind: 'text';
      readonly blockId: string;
      readonly text: string;
      readonly completed: boolean;
    }
  | {
      readonly kind: 'reasoning';
      readonly blockId: string;
      readonly text: string;
      readonly completed: boolean;
    }
  | {
      readonly kind: 'tool_call';
      readonly blockId: string;
      readonly callId: string;
      readonly name: string;
      readonly toolKind: ToolKind;
      readonly input: unknown;
      readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
      readonly output?: unknown;
      readonly stdoutTail?: string;
    }
  | {
      readonly kind: 'file_diff';
      readonly blockId: string;
      readonly paths: ReadonlyArray<string>;
      readonly patch: string;
    }
  | {
      readonly kind: 'plan';
      readonly blockId: string;
      readonly todos: ReadonlyArray<PlanTodoItem>;
      readonly markdown?: string;
    }
  | {
      readonly kind: 'gate';
      readonly blockId: string;
      readonly request: GateRequest;
      readonly resolution?: GateResolution;
    };

/**
 * Pure deterministic event-to-block accumulator (synthesizing Traycer's `agent-runtime-accumulator`
 * and Vibe-Kanban's `normalize_logs` + `AmpResume` history reset).
 */
export class TurnItemAccumulator {
  private blocks: ContentBlock[] = [];
  private readonly indexById = new Map<string, number>();

  apply(event: AgentEvent): ReadonlyArray<ContentBlock> {
    if (event.type === 'history.reset') {
      this.blocks = [];
      this.indexById.clear();
      return this.getBlocks();
    }

    switch (event.type) {
      case 'assistant.delta': {
        const existing = this.getBlock(event.blockId);
        if (existing?.kind === 'text') {
          this.upsert(event.blockId, { ...existing, text: existing.text + event.text });
        } else {
          this.upsert(event.blockId, {
            kind: 'text',
            blockId: event.blockId,
            text: event.text,
            completed: false,
          });
        }
        break;
      }
      case 'assistant.completed': {
        this.upsert(event.blockId, {
          kind: 'text',
          blockId: event.blockId,
          text: event.text,
          completed: true,
        });
        break;
      }
      case 'reasoning.delta': {
        const existing = this.getBlock(event.blockId);
        if (existing?.kind === 'reasoning') {
          this.upsert(event.blockId, { ...existing, text: existing.text + event.text });
        } else {
          this.upsert(event.blockId, {
            kind: 'reasoning',
            blockId: event.blockId,
            text: event.text,
            completed: false,
          });
        }
        break;
      }
      case 'reasoning.completed': {
        this.upsert(event.blockId, {
          kind: 'reasoning',
          blockId: event.blockId,
          text: event.text,
          completed: true,
        });
        break;
      }
      case 'tool.started': {
        this.upsert(event.blockId, {
          kind: 'tool_call',
          blockId: event.blockId,
          callId: event.callId,
          name: event.name,
          toolKind: event.kind,
          input: event.input,
          status: 'running',
        });
        break;
      }
      case 'tool.output': {
        const existing = this.getBlock(event.blockId);
        if (existing?.kind === 'tool_call') {
          const prevOut = existing.stdoutTail ?? '';
          this.upsert(event.blockId, {
            ...existing,
            stdoutTail: (prevOut + event.chunk).slice(-16_384),
          });
        }
        break;
      }
      case 'tool.completed': {
        const existing = this.getBlock(event.blockId);
        if (existing?.kind === 'tool_call') {
          this.upsert(event.blockId, {
            ...existing,
            status: event.status,
            output: event.output,
          });
        }
        break;
      }
      case 'file.diff': {
        this.upsert(event.blockId, {
          kind: 'file_diff',
          blockId: event.blockId,
          paths: event.paths,
          patch: event.patch,
        });
        break;
      }
      case 'plan.updated': {
        this.upsert(event.blockId, {
          kind: 'plan',
          blockId: event.blockId,
          todos: event.todos,
          markdown: event.markdown,
        });
        break;
      }
      case 'gate.requested': {
        this.upsert(event.request.requestId, {
          kind: 'gate',
          blockId: event.request.requestId,
          request: event.request,
        });
        break;
      }
      case 'gate.resolved': {
        const existing = this.getBlock(event.requestId);
        if (existing?.kind === 'gate') {
          this.upsert(event.requestId, { ...existing, resolution: event.resolution });
        }
        break;
      }
      default:
        break;
    }

    return this.getBlocks();
  }

  getBlocks(): ReadonlyArray<ContentBlock> {
    return [...this.blocks];
  }

  private getBlock(blockId: string): ContentBlock | undefined {
    const idx = this.indexById.get(blockId);
    return idx !== undefined ? this.blocks[idx] : undefined;
  }

  private upsert(blockId: string, block: ContentBlock): void {
    const idx = this.indexById.get(blockId);
    if (idx !== undefined) {
      this.blocks[idx] = block;
    } else {
      this.indexById.set(blockId, this.blocks.length);
      this.blocks.push(block);
    }
  }
}

export interface InterviewSettlementState {
  readonly status: 'pending' | 'answered' | 'skipped' | 'failed';
  readonly source?: 'gui' | 'runtime';
  readonly answers?: Readonly<Record<string, unknown>>;
  readonly delivery: 'pending' | 'delivering' | 'delivered' | 'failed';
}

/**
 * Pure monotonic, idempotent interview settlement reducer (ported from Traycer's `interview-settlement.ts`):
 * - GUI authority (`source: 'gui'`) beats `'runtime'`.
 * - `'failed'` never overwrites an established `'answered'` / `'skipped'` outcome.
 * - `'delivered'` delivery state is absorbing.
 */
export function applyInterviewSettlement(
  prev: InterviewSettlementState,
  update: {
    readonly status: 'answered' | 'skipped' | 'failed';
    readonly source: 'gui' | 'runtime';
    readonly answers?: Readonly<Record<string, unknown>>;
    readonly delivery?: 'pending' | 'delivering' | 'delivered' | 'failed';
  },
): InterviewSettlementState {
  const nextDelivery =
    prev.delivery === 'delivered' ? 'delivered' : (update.delivery ?? prev.delivery);

  if (update.status === 'failed' && (prev.status === 'answered' || prev.status === 'skipped')) {
    return { ...prev, delivery: nextDelivery };
  }

  if (prev.source === 'gui' && update.source === 'runtime' && prev.status !== 'pending') {
    return { ...prev, delivery: nextDelivery };
  }

  return {
    status: update.status,
    source: update.source,
    answers: update.answers ?? prev.answers,
    delivery: nextDelivery,
  };
}
