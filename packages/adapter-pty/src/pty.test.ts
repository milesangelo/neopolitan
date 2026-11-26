import type { ManagedPty, ProcessExitResult } from '@neopolitan-ai/core';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';
import { runProviderConformanceSuite } from '@neopolitan-ai/testing/conformance';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentHookServer,
  HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS,
  type PtyBackend,
  createPtyDriver,
  parseOsc7501Sequences,
  reduceHookAndOscStatus,
  reduceHostTurnEnd,
} from './index.js';

function createFakePtyBackend(): PtyBackend {
  return {
    async spawnPty() {
      const listeners = new Set<(d: string) => void>();
      let resolveExit!: (r: ProcessExitResult) => void;
      const exited = new Promise<ProcessExitResult>((r) => {
        resolveExit = r;
      });
      return {
        pid: 12345,
        write(data) {
          const text = data.trim();
          if (text === '\x03') return;
          queueMicrotask(() => {
            for (const cb of listeners) {
              cb('\x1b]7501;working\x07');
              cb(`echo: ${text}\r\n`);
              cb('\x1b]7501;done\x07');
            }
          });
        },
        resize() {},
        onData(cb) {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        exited,
        async killTree() {
          resolveExit({ code: 0, signal: null });
        },
      } satisfies ManagedPty;
    },
  };
}

const servers: AgentHookServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    await s.stop();
  }
});

runProviderConformanceSuite('PtyAdapter (fake PtyBackend)', async () => {
  const runtime = new LocalExecutionRuntime();
  const driver = createPtyDriver({
    command: 'fake-cli',
    ptyBackend: createFakePtyBackend(),
  });
  const adapter = await driver.createAdapter(
    { command: 'fake-cli', ptyBackend: createFakePtyBackend() },
    { runtime },
  );
  return {
    openSession: (input) => adapter.openSession({ cwd: runtime.defaultCwd, ...input }),
  };
});

describe('@neopolitan-ai/adapter-pty hooks & OSC 7501', () => {
  it('enforces hook-vs-OSC precedence, boundary suppression, and turn-end disposition', () => {
    const parsed = parseOsc7501Sequences(
      'abc\x1b]7501;working\x07def\x1b]7501;state=done\x1b\\',
      1_000,
    );
    expect(parsed).toEqual([
      { state: 'working', timestamp: 1_000 },
      { state: 'done', timestamp: 1_000 },
    ]);

    const t0 = 10_000;
    expect(
      reduceHookAndOscStatus({
        lastHook: { state: 'working', timestamp: t0 },
        lastOsc: { state: 'done', timestamp: t0 + 1_000 },
        now: t0 + 1_000,
      }).state,
    ).toBe('working');

    // After 2-minute hook silence, OSC 7501 takes over
    expect(
      reduceHookAndOscStatus({
        lastHook: { state: 'working', timestamp: t0 },
        lastOsc: {
          state: 'done',
          timestamp: t0 + HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS + 1,
        },
        now: t0 + HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS + 1,
      }).state,
    ).toBe('done');

    // hook-agent-* subagents are ignored
    expect(
      reduceHookAndOscStatus({
        lastHook: { state: 'working', subagentId: 'hook-agent-1', timestamp: t0 },
      }).state,
    ).toBe('done');

    const s1 = reduceHostTurnEnd(
      { currentTurnKey: 'seed' },
      { kind: 'prompt_submit', turnKey: 't1', at: 1 },
    );
    const s2 = reduceHostTurnEnd(s1.next, { kind: 'stop', at: 2 });
    expect(s2.disposition).toBe('identified');
    const s3 = reduceHostTurnEnd(s2.next, { kind: 'stop', at: 3 });
    expect(s3.disposition).toBe('ambiguous');
  });

  it('holds PermissionRequest HTTP hook open and filters hook-agent-* requests', async () => {
    const server = new AgentHookServer({
      permissionHoldBudgetMs: 2_000,
      onPermissionRequest: async (ev) => ({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow', tool: ev.toolName },
        },
      }),
    });
    servers.push(server);
    const { url } = await server.start();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hook-decision': 'claude-permission-request-v1',
      },
      body: JSON.stringify({
        sessionId: 's1',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
      }),
    });
    const json = (await res.json()) as {
      hookSpecificOutput?: { decision?: { behavior?: string } };
    };
    expect(json.hookSpecificOutput?.decision?.behavior).toBe('allow');
  });
});
