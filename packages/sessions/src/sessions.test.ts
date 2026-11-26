import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type AgentEvent, ProviderRegistry } from '@neopolitan/core';
import { MockExecutionRuntime, createMockDriver } from '@neopolitan/testing';
import { afterEach, describe, expect, it } from 'vitest';
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
      {
        eventId: 'e1',
        seq: 1,
        sessionId: 's1',
        timestamp: 1,
        type: 'assistant.delta',
        blockId: 'b1',
        text: 'Hel',
      },
      {
        eventId: 'e2',
        seq: 2,
        sessionId: 's1',
        timestamp: 2,
        type: 'assistant.delta',
        blockId: 'b1',
        text: 'lo',
      },
      {
        eventId: 'e2-dup',
        seq: 2,
        sessionId: 's1',
        timestamp: 2,
        type: 'assistant.delta',
        blockId: 'b1',
        text: 'dup',
      },
    ];
    await store.append('s1', events);
    const readBack = await store.read('s1');
    expect(readBack).toHaveLength(2);

    const acc = new TurnItemAccumulator();
    for (const ev of readBack) acc.apply(ev);
    expect(acc.getBlocks()).toEqual([
      { kind: 'text', blockId: 'b1', text: 'Hello', completed: false },
    ]);

    acc.apply({
      eventId: 'e3',
      seq: 3,
      sessionId: 's1',
      timestamp: 3,
      type: 'history.reset',
      reason: 'full_thread_replay',
    });
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
    const nativeHandoff = await manager.handoff(s1.sessionId, {
      providerId: 'mock',
      cwd: '/workspace/a',
    });
    expect(nativeHandoff.bundle.strategy).toBe('native-resume');
    await nativeHandoff.session.close();

    // Cross-provider -> compiled-prelude
    const crossHandoff = await manager.handoff(
      s1.sessionId,
      { providerId: 'codex', cwd: '/workspace/a' },
      { gitDiff: 'diff --git a/a.ts b/a.ts\n+console.log(1);' },
    );
    expect(crossHandoff.bundle.strategy).toBe('compiled-prelude');
    expect(crossHandoff.bundle.compiledPrelude?.recentTurnsMarkdown).toContain(
      'Mock reply: Implement auth',
    );
    expect(crossHandoff.bundle.compiledPrelude?.gitStatusSummary).toContain('diff --git');

    await crossHandoff.session.close();
    await s1.close();
  });

  it('recovers from truncated trailing JSONL lines, accumulates rich block types, and redacts handoff secrets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-sess-rec-'));
    tempDirs.push(dir);
    const store = new JsonlEventStore(dir);

    await store.append('s-crash', [
      {
        eventId: 'e1',
        seq: 1,
        sessionId: 's-crash',
        timestamp: 10,
        type: 'reasoning.delta',
        blockId: 'r1',
        text: 'Thinking...',
      },
      {
        eventId: 'e2',
        seq: 2,
        sessionId: 's-crash',
        timestamp: 11,
        type: 'tool.started',
        blockId: 't1',
        callId: 'c1',
        name: 'Bash',
        kind: 'command',
        input: { command: 'ls' },
      },
      {
        eventId: 'e3',
        seq: 3,
        sessionId: 's-crash',
        timestamp: 12,
        type: 'tool.output',
        blockId: 't1',
        callId: 'c1',
        stream: 'stdout',
        chunk: 'ok\n',
      },
      {
        eventId: 'e4',
        seq: 4,
        sessionId: 's-crash',
        timestamp: 13,
        type: 'tool.completed',
        blockId: 't1',
        callId: 'c1',
        status: 'succeeded',
        output: { code: 0 },
      },
      {
        eventId: 'e5',
        seq: 5,
        sessionId: 's-crash',
        timestamp: 14,
        type: 'file.diff',
        blockId: 'd1',
        paths: ['a.ts'],
        patch: '+line',
      },
      {
        eventId: 'e6',
        seq: 6,
        sessionId: 's-crash',
        timestamp: 15,
        type: 'plan.updated',
        blockId: 'p1',
        todos: [{ title: 'Step 1', status: 'completed' }],
      },
      {
        eventId: 'e7',
        seq: 7,
        sessionId: 's-crash',
        timestamp: 16,
        type: 'assistant.completed',
        blockId: 'a1',
        text: 'Leaked Bearer sk-ant-secretkey123456789',
      },
    ]);

    // Append truncated/corrupt JSON line simulating a sudden process kill mid-write
    await fs.appendFile(path.join(dir, 's-crash.events.jsonl'), '{"seq":8,"broken":', 'utf8');
    const recovered = await store.read('s-crash');
    expect(recovered).toHaveLength(7);

    const acc = new TurnItemAccumulator();
    for (const ev of recovered) acc.apply(ev);
    const blocks = acc.getBlocks();
    expect(blocks.some((b) => b.kind === 'tool_call' && b.status === 'succeeded')).toBe(true);
    expect(blocks.some((b) => b.kind === 'file_diff')).toBe(true);
    expect(blocks.some((b) => b.kind === 'plan')).toBe(true);

    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry()
      .register(createMockDriver())
      .register({ ...createMockDriver(), id: 'codex', label: 'Codex' });
    await store.saveSnapshot({
      sessionId: 's-crash',
      providerId: 'mock',
      cwd: '/workspace/a',
      anchor: { providerId: 'mock', sessionId: 'm-1' },
      lastSeq: 7,
      updatedAt: 20,
    });
    const manager = new SessionManager(registry, store, { runtime });
    const handoff = await manager.handoff('s-crash', { providerId: 'codex', cwd: '/workspace/b' });
    expect(handoff.bundle.compiledPrelude?.recentTurnsMarkdown).not.toContain(
      'sk-ant-secretkey123456789',
    );
    expect(handoff.bundle.compiledPrelude?.recentTurnsMarkdown).toContain('[REDACTED');
    await manager.closeAll();
  });
});
