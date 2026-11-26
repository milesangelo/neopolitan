import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type AgentEvent,
  type ProviderId,
  type SessionAnchor,
  agentEventSchema,
} from '@neopolitan/core';

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly providerId: ProviderId;
  readonly cwd: string;
  readonly anchor: SessionAnchor;
  readonly profileId?: string;
  readonly lastSeq: number;
  readonly updatedAt: number;
}

export interface EventStore {
  append(sessionId: string, events: ReadonlyArray<AgentEvent>): Promise<void>;
  read(
    sessionId: string,
    options?: { readonly afterSeq?: number; readonly limit?: number },
  ): Promise<ReadonlyArray<AgentEvent>>;
  subscribe(sessionId: string, afterSeq?: number): AsyncIterable<AgentEvent>;
  saveSnapshot(snapshot: SessionSnapshot): Promise<void>;
  loadSnapshot(sessionId: string): Promise<SessionSnapshot | null>;
}

export class InMemoryEventStore implements EventStore {
  private readonly logs = new Map<string, AgentEvent[]>();
  private readonly snapshots = new Map<string, SessionSnapshot>();
  private readonly listeners = new Map<string, Set<(ev: AgentEvent) => void>>();

  async append(sessionId: string, events: ReadonlyArray<AgentEvent>): Promise<void> {
    if (events.length === 0) return;
    let list = this.logs.get(sessionId);
    if (!list) {
      list = [];
      this.logs.set(sessionId, list);
    }
    const existingSeqs = new Set(list.map((e) => e.seq));
    for (const ev of events) {
      if (existingSeqs.has(ev.seq)) continue;
      list.push(ev);
      existingSeqs.add(ev.seq);
      for (const cb of this.listeners.get(sessionId) ?? []) {
        cb(ev);
      }
    }
  }

  async read(
    sessionId: string,
    options?: { readonly afterSeq?: number; readonly limit?: number },
  ): Promise<ReadonlyArray<AgentEvent>> {
    const afterSeq = options?.afterSeq ?? 0;
    const filtered = (this.logs.get(sessionId) ?? []).filter((e) => e.seq > afterSeq);
    return options?.limit ? filtered.slice(0, options.limit) : filtered;
  }

  async *subscribe(sessionId: string, afterSeq = 0): AsyncIterable<AgentEvent> {
    const backlog = await this.read(sessionId, { afterSeq });
    let lastDelivered = afterSeq;
    for (const ev of backlog) {
      lastDelivered = Math.max(lastDelivered, ev.seq);
      yield ev;
    }

    const queue: AgentEvent[] = [];
    let notify: (() => void) | undefined;
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    const listener = (ev: AgentEvent) => {
      if (ev.seq <= lastDelivered) return;
      queue.push(ev);
      notify?.();
      notify = undefined;
    };
    set.add(listener);

    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          lastDelivered = Math.max(lastDelivered, item.seq);
          yield item;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      set.delete(listener);
    }
  }

  async saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
    this.snapshots.set(snapshot.sessionId, snapshot);
  }

  async loadSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    return this.snapshots.get(sessionId) ?? null;
  }
}

/**
 * Durable JSONL EventStore with per-session serialized write queues and seq deduplication.
 */
export class JsonlEventStore implements EventStore {
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly listeners = new Map<string, Set<(ev: AgentEvent) => void>>();

  constructor(private readonly baseDir: string) {}

  private eventsPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.events.jsonl`);
  }

  private snapshotPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.snapshot.json`);
  }

  private enqueueWrite(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.writeQueues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.writeQueues.set(sessionId, next);
    return next;
  }

  async append(sessionId: string, events: ReadonlyArray<AgentEvent>): Promise<void> {
    if (events.length === 0) return;
    await this.enqueueWrite(sessionId, async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      const existing = await this.read(sessionId);
      const seenSeq = new Set(existing.map((e) => e.seq));
      const lines: string[] = [];
      const accepted: AgentEvent[] = [];
      for (const ev of events) {
        if (seenSeq.has(ev.seq)) continue;
        seenSeq.add(ev.seq);
        lines.push(`${JSON.stringify(ev)}\n`);
        accepted.push(ev);
      }
      if (lines.length > 0) {
        await fs.appendFile(this.eventsPath(sessionId), lines.join(''), 'utf8');
        for (const ev of accepted) {
          for (const cb of this.listeners.get(sessionId) ?? []) {
            cb(ev);
          }
        }
      }
    });
  }

  async read(
    sessionId: string,
    options?: { readonly afterSeq?: number; readonly limit?: number },
  ): Promise<ReadonlyArray<AgentEvent>> {
    let raw = '';
    try {
      raw = await fs.readFile(this.eventsPath(sessionId), 'utf8');
    } catch {
      return [];
    }
    const afterSeq = options?.afterSeq ?? 0;
    const result: AgentEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rawObj: unknown;
      try {
        rawObj = JSON.parse(line);
      } catch {
        // Recover cleanly if the final JSONL record was truncated mid-crash.
        continue;
      }
      const parsed = agentEventSchema.safeParse(rawObj);
      if (parsed.success && parsed.data.seq > afterSeq) {
        result.push(parsed.data as AgentEvent);
      }
    }
    return options?.limit ? result.slice(0, options.limit) : result;
  }

  async *subscribe(sessionId: string, afterSeq = 0): AsyncIterable<AgentEvent> {
    const backlog = await this.read(sessionId, { afterSeq });
    let lastDelivered = afterSeq;
    for (const ev of backlog) {
      lastDelivered = Math.max(lastDelivered, ev.seq);
      yield ev;
    }

    const queue: AgentEvent[] = [];
    let notify: (() => void) | undefined;
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    const listener = (ev: AgentEvent) => {
      if (ev.seq <= lastDelivered) return;
      queue.push(ev);
      notify?.();
      notify = undefined;
    };
    set.add(listener);

    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          lastDelivered = Math.max(lastDelivered, item.seq);
          yield item;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      set.delete(listener);
    }
  }

  async saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
    await this.enqueueWrite(snapshot.sessionId, async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.writeFile(this.snapshotPath(snapshot.sessionId), JSON.stringify(snapshot, null, 2));
    });
  }

  async loadSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    try {
      const raw = await fs.readFile(this.snapshotPath(sessionId), 'utf8');
      return JSON.parse(raw) as SessionSnapshot;
    } catch {
      return null;
    }
  }
}
