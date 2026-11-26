import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';
import { runProviderConformanceSuite } from '@neopolitan-ai/testing/conformance';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACP_INT32_ID_FLOOR,
  antigravityFlavor,
  assertPathWithinWorkspace,
  createAcpDriver,
  createHardenedAcpStream,
  grokFlavor,
} from './index.js';

function createFakeAcpAgentApp(): acp.AgentApp {
  return acp
    .agent({ name: 'fake-acp-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }))
    .onRequest(acp.methods.agent.session.new, () => ({
      sessionId: 'acp-sess-1',
    }))
    .onRequest(acp.methods.agent.session.load, () => ({}))
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      const promptText = ctx.params.prompt.map((p) => (p.type === 'text' ? p.text : '')).join('');

      if (/secret/i.test(promptText)) {
        throw acp.RequestError.authRequired({
          details: 'Bearer sk-ant-acpsecret1234567890',
        });
      }

      if (/gate/i.test(promptText)) {
        const perm = await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId: ctx.params.sessionId,
          toolCall: {
            toolCallId: 'tc-1',
            title: 'Run echo',
            kind: 'execute',
            status: 'pending',
          },
          options: [
            { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
            { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
          ],
        });
        if (perm.outcome.outcome === 'cancelled') {
          return { stopReason: 'cancelled' };
        }
      }

      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `ACP ok: ${promptText}` },
        },
      });
      return { stopReason: 'end_turn' };
    })
    .onNotification(acp.methods.agent.session.cancel, () => {});
}

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

runProviderConformanceSuite('AcpAdapter (in-process @agentclientprotocol/sdk)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-acp-'));
  tempDirs.push(dir);
  const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
  const driver = createAcpDriver({ inProcessAgent: createFakeAcpAgentApp() });
  const adapter = await driver.createAdapter({}, { runtime });
  return {
    openSession: (input) => adapter.openSession({ cwd: dir, ...input }),
    triggerGatePrompt: 'Trigger gate',
    triggerSecretFailurePrompt: 'Trigger secret error',
  };
});

describe('@neopolitan-ai/adapter-acp hardening', () => {
  it('remaps id: 0 to Int32 floor, filters stdout noise, and detects sign-in URLs', async () => {
    const writtenToAgent: string[] = [];
    const signInUrls: string[] = [];

    const stdin = new WritableStream<Uint8Array>({
      write(chunk) {
        writtenToAgent.push(Buffer.from(chunk).toString('utf8'));
      },
    });

    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('Please login at https://auth.example.com/login?code=123\n'));
        controller.enqueue(
          enc.encode(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: ACP_INT32_ID_FLOOR,
              result: { protocolVersion: '1' },
            })}\n`,
          ),
        );
        controller.close();
      },
    });

    const stream = createHardenedAcpStream(stdin, stdout, {
      onSignInUrlDetected: (u) => signInUrls.push(u),
    });

    const writer = stream.writable.getWriter();
    await writer.write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    writer.releaseLock();

    const outbound = JSON.parse(writtenToAgent[0]!) as { id: number };
    expect(outbound.id).toBe(ACP_INT32_ID_FLOOR);

    const reader = stream.readable.getReader();
    const first = await reader.read();
    expect((first.value as { id: number; result: { protocolVersion: number } }).id).toBe(0);
    expect((first.value as { result: { protocolVersion: number } }).result.protocolVersion).toBe(1);
    expect(signInUrls).toEqual(['https://auth.example.com/login?code=123']);
  });

  it('enforces fail-closed workspace path policy and flavor rules', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-acp-pol-'));
    tempDirs.push(dir);
    const runtime = new LocalExecutionRuntime({ defaultCwd: dir });

    await expect(assertPathWithinWorkspace(runtime, dir, '/etc/passwd')).rejects.toThrow(/escapes/);
    await expect(assertPathWithinWorkspace(runtime, dir, '~/.ssh/id_rsa')).rejects.toThrow(
      /disallowed/,
    );
    const okPath = await assertPathWithinWorkspace(runtime, dir, 'nested/file.ts');
    expect(okPath.startsWith(await runtime.realpath(dir))).toBe(true);

    expect(antigravityFlavor.isDisguisedElicitation?.({ toolCallId: 'interaction_42' })).toBe(true);
    expect(grokFlavor.sessionLoadIdleMs).toBe(2_000);
    expect(grokFlavor.classifyError?.(-32003, 'rate limited')).toBe('rate_limit');
  });
});
