import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, GateRequest } from '@neopolitan-ai/core';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexDriver } from './index.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures',
);

const tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Codex app-server golden wire fixture', () => {
  it('replays codex-app-server.jsonl including file approval, elicitation, fork, steer, review, and interrupt', async () => {
    const rawFixture = await fs.readFile(path.join(fixturesDir, 'codex-app-server.jsonl'), 'utf8');
    const frames = rawFixture
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neopolitan-codex-fix-'));
    tempDirs.push(dir);
    const scriptPath = path.join(dir, 'replay-codex.mjs');

    const serverScript = `
const frames = ${JSON.stringify(frames)};
let buf = '';
const answered = new Set();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx = buf.indexOf('\\n');
  while (idx !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line) onMsg(JSON.parse(line));
    idx = buf.indexOf('\\n');
  }
});
function send(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
function findRes(method) { return frames.find((f) => f.kind === 'server_response' && f.method === method)?.result ?? {}; }
function onMsg(msg) {
  if (msg.method === 'initialize' || msg.method === 'thread/start' || msg.method === 'thread/fork' || msg.method === 'turn/steer' || msg.method === 'turn/interrupt' || msg.method === 'reviewStart') {
    if (msg.method === 'reviewStart') {
      send({ id: msg.id, result: { turn: { id: 'review-turn-1' } } });
      send({ method: 'turn/completed', params: { turn: { id: 'review-turn-1', status: 'completed' } } });
      return;
    }
    return send({ id: msg.id, result: findRes(msg.method) });
  }
  if (msg.method === 'turn/start') {
    send({ id: msg.id, result: findRes('turn/start') });
    for (const f of frames) {
      if (f.kind === 'server_request') send({ id: f.id, method: f.method, params: f.params });
    }
    return;
  }
  if (typeof msg.id === 'number' && (msg.id === 501 || msg.id === 502)) {
    answered.add(msg.id);
    if (answered.size === 2) {
      for (const f of frames) {
        if (f.kind === 'notification') send({ method: f.method, params: f.params });
      }
    }
  }
}
`;
    await fs.writeFile(scriptPath, serverScript, 'utf8');

    const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
    const gateSeen: GateRequest[] = [];
    const driver = createCodexDriver({
      executablePath: process.execPath,
      args: [scriptPath],
    });
    const adapter = await driver.createAdapter(
      {},
      {
        runtime,
        interactiveGateHandler: async (req) => {
          gateSeen.push(req);
          if (req.kind === 'elicitation') {
            return { decision: 'answered', answers: { region: 'us-west-2' }, source: 'user' };
          }
          return { decision: 'allow_once', source: 'user' };
        },
      },
    );

    await using session = await adapter.openSession({ cwd: dir, permissionMode: 'supervised' });
    const events: AgentEvent[] = [];
    const ac = new AbortController();
    const consumer = (async () => {
      for await (const ev of session.events({ signal: ac.signal })) {
        events.push(ev);
        if (ev.type === 'turn.completed') ac.abort();
      }
    })();

    const receipt = await session.sendTurn({ prompt: 'Deploy with \ud800 surrogate' });
    expect(receipt.outcome).toBe('accepted');
    await consumer;

    expect(gateSeen.some((g) => g.kind === 'approval' && g.category === 'file_write')).toBe(true);
    expect(gateSeen.some((g) => g.kind === 'elicitation')).toBe(true);
    expect(
      events.some((e) => e.type === 'assistant.delta' && e.text.includes('Applied patch')),
    ).toBe(true);

    const forked = await session.fork?.();
    expect(forked).toEqual({ providerId: 'codex', threadId: 'codex-golden-thread-fork-02' });

    const steered = await session.steerTurn?.({ prompt: 'Focus on tests' });
    expect(steered?.outcome).toBe('accepted');

    await session.interruptTurn();
    const rev = await session.runReview?.({
      repos: [{ repoId: 'main', cwd: dir, baseRef: 'main', headRef: 'HEAD' }],
    });
    expect(rev?.outcome).toBe('accepted');
  });
});
