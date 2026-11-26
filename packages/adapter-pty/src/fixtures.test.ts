import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, ManagedPty, ProcessExitResult } from '@neopolitan/core';
import { MockExecutionRuntime } from '@neopolitan/testing';
import { describe, expect, it } from 'vitest';
import { type PtyBackend, createPtyDriver } from './index.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures',
);

interface PtyFixtureFrame {
  readonly agent: 'amp' | 'droid';
  readonly chunk?: string;
  readonly exit?: { readonly code: number | null; readonly signal: string | null };
}

describe('PTY + OSC 7501 Amp/Droid golden wire fixture', () => {
  it('replays pty-amp-droid.jsonl across turn completion, Ctrl+C interrupt, and unexpected exit', async () => {
    const raw = await fs.readFile(path.join(fixturesDir, 'pty-amp-droid.jsonl'), 'utf8');
    const frames = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as PtyFixtureFrame);

    const writtenInputs: string[] = [];
    let emitChunk!: (chunk: string) => void;
    let triggerExit!: (res: ProcessExitResult) => void;

    const backend: PtyBackend = {
      async spawnPty() {
        const listeners = new Set<(d: string) => void>();
        emitChunk = (chunk) => {
          for (const cb of listeners) cb(chunk);
        };
        const exited = new Promise<ProcessExitResult>((r) => {
          triggerExit = r;
        });
        return {
          pid: 9876,
          write(data) {
            writtenInputs.push(data);
            if (data === '\x03') return;
            queueMicrotask(() => {
              for (const f of frames.filter((x) => x.agent === 'amp' && x.chunk)) {
                emitChunk(f.chunk!);
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
            triggerExit({ code: 0, signal: null });
          },
        } satisfies ManagedPty;
      },
    };

    const driver = createPtyDriver({ command: 'amp', ptyBackend: backend });
    const adapter = await driver.createAdapter(
      { command: 'amp', ptyBackend: backend },
      { runtime: new MockExecutionRuntime() },
    );
    const session = await adapter.openSession({ cwd: '/workspace' });

    const events: AgentEvent[] = [];
    const consume = (async () => {
      for await (const ev of session.events()) {
        events.push(ev);
      }
    })();

    const receipt = await session.sendTurn({ prompt: 'Inspect repo' });
    expect(receipt.outcome).toBe('admitted');

    await new Promise((r) => setTimeout(r, 30));
    await session.interruptTurn();
    expect(writtenInputs).toContain('\x03');

    // Replay Droid status frames and non-zero process exit
    for (const f of frames.filter((x) => x.agent === 'droid')) {
      if (f.chunk) emitChunk(f.chunk);
      if (f.exit) triggerExit({ code: f.exit.code, signal: f.exit.signal });
    }
    await consume;

    expect(events.some((e) => e.type === 'session.status' && e.state === 'blocked')).toBe(true);
    expect(events.some((e) => e.type === 'turn.completed' && e.status === 'completed')).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'session.ended' && e.cause === 'unexpected_exit' && e.exitCode === 17,
      ),
    ).toBe(true);
  });
});
