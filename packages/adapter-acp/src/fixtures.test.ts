import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { type AgentEvent, type GateRequest, classifyProviderFailure } from '@neopolitan-ai/core';
import { MockExecutionRuntime } from '@neopolitan-ai/testing';
import { describe, expect, it } from 'vitest';
import { createAcpDriver, grokFlavor, opencodeFlavor, resolveAcpFlavor } from './index.js';

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures',
);

describe('ACP v1/v2 golden wire fixture & flavors', () => {
  it('replays acp-flavors.jsonl updates, elicitations, and antigravity disguised permission checks', async () => {
    const raw = await fs.readFile(path.join(fixturesDir, 'acp-flavors.jsonl'), 'utf8');
    const frames = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    const agent = acp
      .agent({ name: 'fixture-acp-agent' })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({
        sessionId: 'acp-golden-sess-1',
      }))
      .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
        for (const frame of frames) {
          if (frame.frameType === 'update') {
            const { frameType: _ft, ...update } = frame;
            await ctx.client.notify(acp.methods.client.session.update, {
              sessionId: ctx.params.sessionId,
              update: update as unknown as acp.SessionUpdate,
            });
          } else if (frame.frameType === 'elicitation') {
            await ctx.client.request(acp.methods.client.elicitation.create, {
              sessionId: ctx.params.sessionId,
              mode: frame.mode as 'form' | 'url',
              message: String(frame.message),
              ...(frame.url ? { url: String(frame.url) } : {}),
              ...(frame.mode === 'form'
                ? { requestedSchema: { type: 'object', properties: {} } }
                : { elicitationId: 'el-url-1' }),
            } as unknown as acp.CreateElicitationRequest);
          } else if (frame.frameType === 'permission') {
            await ctx.client.request(acp.methods.client.session.requestPermission, {
              sessionId: ctx.params.sessionId,
              toolCall: frame.toolCall as acp.ToolCallUpdate,
              options: [
                { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
                { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
              ],
            });
          }
        }
        return { stopReason: 'end_turn' };
      });

    const gatesSeen: GateRequest[] = [];
    const driver = createAcpDriver({
      id: 'antigravity',
      flavor: 'antigravity',
      inProcessAgent: agent,
    });
    const adapter = await driver.createAdapter(
      {},
      {
        runtime: new MockExecutionRuntime(),
        interactiveGateHandler: async (req) => {
          gatesSeen.push(req);
          if (req.kind === 'elicitation') {
            return { decision: 'answered', answers: { tag: 'v0.1.0' }, source: 'user' };
          }
          return { decision: 'deny', feedback: 'Asked interactively', source: 'user' };
        },
      },
    );

    await using session = await adapter.openSession({
      cwd: '/workspace',
      permissionMode: 'full_access',
    });

    const events: AgentEvent[] = [];
    const ac = new AbortController();
    const consume = (async () => {
      for await (const ev of session.events({ signal: ac.signal })) {
        events.push(ev);
        if (ev.type === 'turn.completed') ac.abort();
      }
    })();

    await session.sendTurn({ prompt: 'Run fixture' });
    await consume;

    expect(events.some((e) => e.type === 'reasoning.delta')).toBe(true);
    expect(events.some((e) => e.type === 'plan.updated' && e.todos.length === 2)).toBe(true);
    expect(events.some((e) => e.type === 'tool.started' && e.kind === 'file_read')).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'tool.completed' && e.callId === 'tc-edit-2' && e.status === 'failed',
      ),
    ).toBe(true);
    // Disguised interaction_* permission MUST still trigger interactive handler even in full_access
    expect(gatesSeen.some((g) => g.kind === 'approval' && g.isDisguisedElicitation === true)).toBe(
      true,
    );
    expect(
      gatesSeen.some((g) => g.kind === 'elicitation' && g.mode === 'url' && g.personOnly),
    ).toBe(true);
  });

  it('resolves dialect flavors and provider-specific error mappings', () => {
    expect(resolveAcpFlavor('agy').id).toBe('antigravity');
    expect(resolveAcpFlavor('grok').id).toBe('grok');
    expect(resolveAcpFlavor('kiro').id).toBe('kiro');
    expect(resolveAcpFlavor('copilot').alwaysSetModelOnNewSession).toBe(true);
    expect(resolveAcpFlavor('omp').stripToolEchoPrefix).toBe(true);
    expect(resolveAcpFlavor('unknown-cli').id).toBe('default');

    expect(grokFlavor.classifyError?.(-32003, 'slow down')).toBe('rate_limit');
    expect(opencodeFlavor.classifyError?.(402, 'out of credits')).toBe('billing');
    expect(classifyProviderFailure('bad request', { code: -32602 }).failureClass).toBe(
      'validation_error',
    );
  });
});
