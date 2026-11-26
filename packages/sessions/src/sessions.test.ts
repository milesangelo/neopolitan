import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistry, type AgentEvent } from '@neopolitan/core';
import { createMockDriver, MockExecutionRuntime } from '@neopolitan/testing';
import {
  InMemoryEventStore,
  JsonlEventStore,
  SessionManager,
  TurnItemAccumulator,
  applyInterviewSettlement,
} from './index.js';

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('@neopolitan/sessions', () => {
  it('persists JSONL events with seq deduplication and folds TurnItemAccumulator + history.reset', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-sess-'));
    tempDirs.push(dir);
    const store = new JsonlEventStore(dir);

    const events: AgentEvent[] = [
      { eventId: 'e1', seq: 1, sessionId: 's1', timestamp: 1, type: 'assistant.delta', blockId: 'b1', text: 'Hel' },
      { eventId: 'e2', seq: 2, sessionId: 's1', timestamp: 2, type: 'assistant.delta', blockId: 'b1', text: 'lo' },
      { eventId: 'e2-dup', seq: 2, sessionId: 's1', timestamp: 2, type: 'assistant.delta', blockId: 'b1', text: 'dup' },
    ];
    await store.append('s1', events);
    const readBack = await store.read('s1');
    expect(readBack).toHaveLength(2);

    const acc = new TurnItemAccumulator();
    for (const ev of readBack) acc.apply(ev);
    expect(acc.getBlocks()).toEqual([
      { kind: 'text', blockId: 'b1', text: 'Hello', completed: false },
    ]);

    acc.apply({ eventId: 'e3', seq: 3, sessionId: 's1', timestamp: 3, type: 'history.reset', reason: 'full_thread_replay' });
    expect(acc.getBlocks()).toHaveLength(0);
  });

  it('enforces monotonic interview settlement rules (GUI > runtime, failed cannot overwrite answered)', () => {
    let state = applyInterviewSettlement(
      { status: 'pending', delivery: 'pending' },
      { status: 'answered', source: 'gui', answers: { db: 'postgres' }, delivery: 'delivered' },
    );
    state = applyInterviewSettlement(state, {
      status: 'failed',
      source: 'runtime',
      delivery: 'failed',
    });
    expect(state.status).toBe('answered');
    expect(state.delivery).toBe('delivered');
    expect(state.answers).toEqual({ db: 'postgres' });
  });

  it('compiles native resume vs cross-provider contextPrelude handoff bundles via SessionManager', async () => {
    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry()
      .register(createMockDriver())
      .register({ ...createMockDriver(), id: 'codex', label: 'Alt Provider' });

    const store = new InMemoryEventStore();
    const manager = new SessionManager(registry, store, { runtime });

    const s1 = await manager.open('mock', { cwd: '/workspace/a' });
    const ac = new AbortController();
    const waitTurn = (async () => {
      for await (const ev of s1.events({ signal: ac.signal })) {
        if (ev.type === 'turn.completed') ac.abort();
      }
    })();
    await s1.sendTurn({ prompt: 'Implement auth' });
    await waitTurn;
    await new Promise((r) => setTimeout(r, 20));

    // Same provider + same cwd -> native-resume
    const nativeHandoff = await manager.handoff(s1.sessionId, { providerId: 'mock', cwd: '/workspace/a' });
    expect(nativeHandoff.bundle.strategy).toBe('native-resume');
    await nativeHandoff.session.close();

    // Cross-provider -> compiled-prelude
    const crossHandoff = await manager.handoff(
      s1.sessionId,
      { providerId: 'codex', cwd: '/workspace/a' },
      { gitDiff: 'diff --git a/a.ts b/a.ts\n+console.log(1);' },
    );
    expect(crossHandoff.bundle.strategy).toBe('compiled-prelude');
    expect(crossHandoff.bundle.compiledPrelude?.recentTurnsMarkdown).toContain('Mock reply: Implement auth');
    expect(crossHandoff.bundle.compiledPrelude?.gitStatusSummary).toContain('diff --git');

    await crossHandoff.session.close();
    await s1.close();
  });
});
