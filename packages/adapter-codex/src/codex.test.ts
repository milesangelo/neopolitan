import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ThreadInUseError } from '@neopolitan/core';
import { LocalExecutionRuntime } from '@neopolitan/runtime-local';
import { runProviderConformanceSuite } from '@neopolitan/testing/conformance';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexAppServerClient,
  createCodexDriver,
  createRateLimitDeduplicator,
  sanitizeLoneSurrogates,
} from './index.js';

const FAKE_CODEX_SCRIPT = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx = buf.indexOf('\\n');
  while (idx !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line) handle(JSON.parse(line));
    idx = buf.indexOf('\\n');
  }
});
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}
function handle(msg) {
  if (msg.method === 'initialize') {
    return send({ id: msg.id, result: { ok: true } });
  }
  if (msg.method === 'thread/start' || msg.method === 'thread/resume') {
    return send({ id: msg.id, result: { thread: { id: 'codex-thread-1' } } });
  }
  if (msg.method === 'thread/fork') {
    return send({ id: msg.id, result: { thread: { id: 'codex-thread-fork-2' } } });
  }
  if (msg.method === 'turn/start' || msg.method === 'reviewStart') {
    const text = msg.method === 'turn/start' ? (msg.params?.input?.[0]?.text ?? '') : 'review';
    send({ id: msg.id, result: { turn: { id: 'codex-turn-1' } } });
    if (/secret/i.test(text)) {
      return send({
        method: 'turn/completed',
        params: { turn: { id: 'codex-turn-1', status: 'failed', error: { message: 'Unauthorized Bearer sk-ant-codexsecret9999' } } }
      });
    }
    if (/gate/i.test(text)) {
      send({ id: 999, method: 'item/commandExecution/requestApproval', params: { command: 'rm -rf /tmp/x' } });
      return;
    }
    if (/thread_in_use/i.test(text)) {
      return;
    }
    send({ method: 'item/agentMessage/delta', params: { itemId: 'item-1', delta: 'Codex: ' + text } });
    return send({ method: 'turn/completed', params: { turn: { id: 'codex-turn-1', status: 'completed' } } });
  }
  if (msg.id === 999) {
    send({ method: 'item/agentMessage/delta', params: { itemId: 'item-1', delta: 'Gate resolved: ' + msg.result?.decision } });
    return send({ method: 'turn/completed', params: { turn: { id: 'codex-turn-1', status: 'completed' } } });
  }
  if (msg.method === 'turn/interrupt') {
    return send({ id: msg.id, result: {} });
  }
  if (msg.method === 'hang_forever') {
    return; // intentionally stall
  }
  if (msg.method === 'busy_writer') {
    return send({ id: msg.id, error: { code: -32600, message: 'Thread already has an active writer' } });
  }
}
`;

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

runProviderConformanceSuite('CodexAdapter (fake app-server subprocess)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-codex-'));
  tempDirs.push(dir);
  const scriptPath = path.join(dir, 'fake-codex.mjs');
  await fs.writeFile(scriptPath, FAKE_CODEX_SCRIPT, 'utf8');

  const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
  const driver = createCodexDriver({
    executablePath: process.execPath,
    args: [scriptPath],
  });
  const adapter = await driver.createAdapter({}, { runtime });
  return {
    openSession: (input) => adapter.openSession({ cwd: dir, ...input }),
    triggerGatePrompt: 'Run gate check',
    triggerSecretFailurePrompt: 'Trigger secret failure',
  };
});

describe('@neopolitan/adapter-codex hardening', () => {
  it('sanitizes lone UTF-16 surrogates, deduplicates rate limits, and detects hung/busy servers', async () => {
    const validEmoji = 'hi 😀';
    expect(sanitizeLoneSurrogates(validEmoji)).toBe(validEmoji);
    const broken = 'hi \ud800 there \udfff';
    expect(sanitizeLoneSurrogates(broken)).toBe('hi \ufffd there \ufffd');

    const dedupe = createRateLimitDeduplicator();
    expect(dedupe([{ windowId: '5h', remainingPercent: 90 }])).not.toBeNull();
    expect(dedupe([{ windowId: '5h', remainingPercent: 90 }])).toBeNull();

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-codex-hang-'));
    tempDirs.push(dir);
    const scriptPath = path.join(dir, 'fake-codex.mjs');
    await fs.writeFile(scriptPath, FAKE_CODEX_SCRIPT, 'utf8');

    const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
    let hangRetired = false;
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: [scriptPath],
      cwd: dir,
      runtime,
      hangTimeoutMs: 120,
      requestTimeoutMs: 5_000,
      onHangRetired: () => {
        hangRetired = true;
      },
    });
    await client.start();
    await expect(client.request('busy_writer', {})).rejects.toBeInstanceOf(ThreadInUseError);
    await expect(client.request('hang_forever', {})).rejects.toThrow(/hung/);
    expect(hangRetired).toBe(true);
    await client.close();
  });
});
