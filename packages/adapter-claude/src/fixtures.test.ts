import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent } from '@neopolitan/core';
import { LocalExecutionRuntime } from '@neopolitan/runtime-local';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeDriver, mergeClaudeTokenUsage } from './index.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures',
);

const tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

describe('Claude stream-json golden wire fixture', () => {
  it('replays claude-stream-json.jsonl into canonical AgentEvents despite noise & foreign init ID', async () => {
    const rawFixture = await fs.readFile(
      path.join(fixturesDir, 'claude-stream-json.jsonl'),
      'utf8',
    );
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neopolitan-claude-fix-'));
    tempDirs.push(dir);

    const fixturePath = path.join(dir, 'fixture.jsonl');
    await fs.writeFile(fixturePath, rawFixture, 'utf8');

    const scriptPath = path.join(dir, 'replay-claude.mjs');
    await fs.writeFile(
      scriptPath,
      `import fs from 'node:fs';\nprocess.stdout.write(fs.readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));\n`,
      'utf8',
    );

    const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
    const driver = createClaudeDriver({
      executablePath: process.execPath,
      prefixArgs: [scriptPath],
    });
    const adapter = await driver.createAdapter({}, { runtime });
    await using session = await adapter.openSession({ cwd: dir });

    const events: AgentEvent[] = [];
    const ac = new AbortController();
    const consumer = (async () => {
      for await (const ev of session.events({ signal: ac.signal })) {
        events.push(ev);
        if (ev.type === 'turn.completed') ac.abort();
      }
    })();

    const receipt = await session.sendTurn({ prompt: 'Run replay' });
    expect(receipt.outcome).toBe('accepted');
    await consumer;

    expect(session.getAnchor()).toEqual({
      providerId: 'claude-code',
      sessionId: 'claude-golden-sess-01',
      messageUuid: 'msg-02',
    });
    expect(events.some((e) => e.type === 'tool.started' && e.name === 'Bash')).toBe(true);
    const completedMsgs = events.filter(
      (e): e is Extract<AgentEvent, { type: 'assistant.completed' }> =>
        e.type === 'assistant.completed',
    );
    expect(completedMsgs).toHaveLength(1);
    expect(completedMsgs[0]?.text).toContain('Running tests and inspecting output.');
    expect(completedMsgs[0]?.text).toContain('All 64 tests passed cleanly.');
    const done = events.find(
      (e): e is Extract<AgentEvent, { type: 'turn.completed' }> => e.type === 'turn.completed',
    );
    expect(done?.status).toBe('completed');
    expect(
      mergeClaudeTokenUsage(
        { inputTokens: 140, outputTokens: 18 },
        { inputTokens: 0, outputTokens: 32 },
      ),
    ).toEqual({
      inputTokens: 140,
      outputTokens: 32,
    });
  });
});
