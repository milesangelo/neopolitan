import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentEventInput } from './events.js';

export interface EventHubOptions {
  readonly sessionId: string;
  readonly maxBufferSize?: number;
}

interface Subscriber<T> {
  readonly queue: T[];
  readonly includeRaw: boolean;
  resolveNext?: (result: IteratorResult<T>) => void;
  closed: boolean;
}

/**
 * Replay-buffered multi-subscriber event hub so events emitted during `openSession`
 * are never dropped before the caller starts iterating `session.events()`.
 */
export class EventHub {
  private readonly sessionId: string;
  private readonly maxBufferSize: number;
  private readonly buffer: AgentEvent[] = [];
  private readonly subscribers = new Set<Subscriber<AgentEvent>>();
  private nextSeq = 1;
  private closed = false;

  constructor(options: EventHubOptions) {
    this.sessionId = options.sessionId;
    this.maxBufferSize = options.maxBufferSize ?? 2_048;
  }

  emit(event: AgentEventInput): AgentEvent {
    if (this.closed) {
      throw new Error(`Cannot emit event to closed EventHub (${this.sessionId})`);
    }
    const fullEvent = {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      seq: this.nextSeq++,
      sessionId: this.sessionId,
      timestamp: event.timestamp ?? Date.now(),
    } as AgentEvent;

    if (!('ephemeral' in fullEvent && fullEvent.ephemeral)) {
      this.buffer.push(fullEvent);
      if (this.buffer.length > this.maxBufferSize) {
        this.buffer.shift();
      }
    }

    for (const sub of this.subscribers) {
      const delivered = sub.includeRaw ? fullEvent : stripRaw(fullEvent);
      if (sub.resolveNext) {
        const resolve = sub.resolveNext;
        sub.resolveNext = undefined;
        resolve({ value: delivered, done: false });
      } else {
        sub.queue.push(delivered);
      }
    }

    return fullEvent;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sub of this.subscribers) {
      sub.closed = true;
      if (sub.resolveNext) {
        const resolve = sub.resolveNext;
        sub.resolveNext = undefined;
        resolve({ value: undefined, done: true });
      }
    }
    this.subscribers.clear();
  }

  subscribe(options?: {
    readonly includeRaw?: boolean;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<AgentEvent> {
    const includeRaw = options?.includeRaw ?? false;
    const afterSeq = options?.afterSeq ?? 0;
    const initialItems = this.buffer
      .filter((item) => item.seq > afterSeq)
      .map((item) => (includeRaw ? item : stripRaw(item)));

    const sub: Subscriber<AgentEvent> = {
      queue: initialItems,
      includeRaw,
      closed: this.closed && initialItems.length === 0,
    };

    if (!this.closed) {
      this.subscribers.add(sub);
    }

    const abortHandler = () => {
      sub.closed = true;
      this.subscribers.delete(sub);
      if (sub.resolveNext) {
        const resolve = sub.resolveNext;
        sub.resolveNext = undefined;
        resolve({ value: undefined, done: true });
      }
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        abortHandler();
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    const hub = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        return {
          next(): Promise<IteratorResult<AgentEvent>> {
            if (sub.queue.length > 0) {
              const nextItem = sub.queue.shift()!;
              return Promise.resolve({ value: nextItem, done: false });
            }
            if (sub.closed || hub.closed) {
              hub.subscribers.delete(sub);
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise<IteratorResult<AgentEvent>>((resolve) => {
              sub.resolveNext = resolve;
            });
          },
          return(): Promise<IteratorResult<AgentEvent>> {
            sub.closed = true;
            hub.subscribers.delete(sub);
            options?.signal?.removeEventListener('abort', abortHandler);
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }
}

function stripRaw(event: AgentEvent): AgentEvent {
  if (!event.rawEvent) return event;
  const copy = { ...event };
  delete (copy as { rawEvent?: unknown }).rawEvent;
  return copy;
}

export interface LfNdjsonFramerOptions {
  readonly maxLineBytes?: number;
  readonly onJson: (value: unknown, rawLine: string) => void;
  readonly onNonJsonLine?: (line: string) => void;
  readonly onOversizedLine?: (byteLength: number) => void;
}

/**
 * Strict `\n`-only NDJSON framer avoiding Node `readline`'s `U+2028`/`U+2029` line splitting
 * bug (discovered in `t3code`'s Pi RPC client). Buffers partial UTF-8 bytes safely across chunks.
 */
export function createLfNdjsonFramer(options: LfNdjsonFramerOptions): {
  push: (chunk: Uint8Array | string) => void;
  flush: () => void;
} {
  const maxLineBytes = options.maxLineBytes ?? 32 * 1024 * 1024;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return;
    const byteLen = Buffer.byteLength(line, 'utf8');
    if (byteLen > maxLineBytes) {
      options.onOversizedLine?.(byteLen);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      options.onJson(parsed, line);
    } catch {
      options.onNonJsonLine?.(line);
    }
  };

  return {
    push(chunk) {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      buffer += text;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        processLine(line);
        idx = buffer.indexOf('\n');
      }
      if (Buffer.byteLength(buffer, 'utf8') > maxLineBytes) {
        const len = Buffer.byteLength(buffer, 'utf8');
        buffer = '';
        options.onOversizedLine?.(len);
      }
    },
    flush() {
      const trailing = decoder.decode();
      if (trailing) buffer += trailing;
      if (buffer.length > 0) {
        const rest = buffer;
        buffer = '';
        processLine(rest);
      }
    },
  };
}
