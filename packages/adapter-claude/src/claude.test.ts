import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalExecutionRuntime } from '@neopolitan/runtime-local';
import { runProviderConformanceSuite } from '@neopolitan/testing/conformance';
import {
  createClaudeDriver,
  mergeClaudeTokenUsage,
  scrubClaudeAuthEnv,
  splicePrefixArgsForScript,
  withoutRejectedClaudeApiKey,
} from './index.js';

const FAKE_CLAUDE_SCRIPT = `
const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : '';
// Emit foreign SessionStart:resume boot ID first before system/init
console.log(JSON.stringify({ type: 'system', subtype: 'SessionStart:resume', session_id: 'foreign-boot-id' }));
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-sess-real' }));
if (/secret/i.test(prompt)) {
  console.log(JSON.stringify({ type: 'result', is_error: true, session_id: 'claude-sess-real', result: 'Auth failed Bearer sk-ant-claudesecret123456' }));
  process.exit(0);
}
console.log(JSON.stringify({
  type: 'assistant',
  uuid: 'msg-uuid-1',
  session_id: 'claude-sess-real',
  message: {
    usage: { input_tokens: 100, output_tokens: 10 },
    content: [{ type: 'text', text: 'Claude says: ' + prompt }]
  }
}));
console.log(JSON.stringify({ type: 'result', is_error: false, session_id: 'claude-sess-real' }));
`;

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

runProviderConformanceSuite('ClaudeAdapter (fake stream-json subprocess)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-claude-'));
  tempDirs.push(dir);
  const scriptPath = path.join(dir, 'fake-claude.mjs');
  await fs.writeFile(scriptPath, FAKE_CLAUDE_SCRIPT, 'utf8');

  const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
  const driver = createClaudeDriver({
    executablePath: process.execPath,
    prefixArgs: [scriptPath],
  });
  const adapter = await driver.createAdapter({}, { runtime });
  return {
    openSession: (input) => adapter.openSession({ cwd: dir, ...input }),
    triggerSecretFailurePrompt: 'Trigger secret error',
  };
});

describe('@neopolitan/adapter-claude helpers', () => {
  it('scrubs rejected ~/.claude.json API keys, leaks, and splices script prefixArgs at index 1', () => {
    const spliced = splicePrefixArgsForScript('/tmp/cli.mjs', ['script.mjs', '-p', 'hi'], ['--flag']);
    expect(spliced).toEqual(['script.mjs', '--flag', '-p', 'hi']);

    const scrubbed = scrubClaudeAuthEnv(
      {
        ANTHROPIC_API_KEY: 'sk-ant-12345678901234567890',
        ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer xyz',
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        CLAUDE_CONFIG_DIR: '/ambient/leaked',
      },
      { stripAuthEnv: true, configDir: '/isolated/dir' },
    );
    expect(scrubbed.ANTHROPIC_API_KEY).toBeUndefined();
    expect(scrubbed.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    expect(scrubbed.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
    expect(scrubbed.CLAUDE_CONFIG_DIR).toBe('/isolated/dir');

    const key = 'sk-ant-rejected-00001111222233334444';
    const filtered = withoutRejectedClaudeApiKey(
      { ANTHROPIC_API_KEY: key },
      { customApiKeyResponses: { rejected: [key.slice(-20)] } },
    );
    expect(filtered.ANTHROPIC_API_KEY).toBeUndefined();

    const merged = mergeClaudeTokenUsage(
      { inputTokens: 120, outputTokens: 10 },
      { inputTokens: 0, outputTokens: 25 },
    );
    expect(merged).toEqual({ inputTokens: 120, outputTokens: 25 });
  });
});
