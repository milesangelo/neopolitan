import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk/unstable';
import {
  antigravityFlavor,
  assertPathWithinWorkspace,
  createAcpDriver,
} from '@neopolitan-ai/adapter-acp';
import { type AgentEvent, createPolicyGateMiddleware } from '@neopolitan-ai/core';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';

function createSimulatedAntigravityAgent(): acp.AgentApp {
  return acp
    .agent({ name: 'simulated-antigravity' })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }))
    .onRequest(acp.methods.agent.session.new, () => ({
      sessionId: 'agy-sess-1',
    }))
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      // 1. Safe file read check (policy auto-allows)
      const readPerm = await ctx.client.request(acp.methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: {
          toolCallId: 'read-1',
          title: 'Read package.json',
          kind: 'read',
          status: 'pending',
        },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Deny' },
        ],
      });

      // 2. Destructive shell command (policy denies)
      const rmPerm = await ctx.client.request(acp.methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: {
          toolCallId: 'exec-1',
          title: 'rm -rf /tmp/prod',
          kind: 'execute',
          status: 'pending',
        },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Deny' },
        ],
      });

      // 3. Disguised question (`interaction_*`): must reach interactive handler even in full_access
      const questionPerm = await ctx.client.request(acp.methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: {
          toolCallId: 'interaction_choose_db',
          title: 'Choose database: Postgres or SQLite?',
          kind: 'other',
          status: 'pending',
        },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Postgres' },
          { optionId: 'reject', kind: 'reject_once', name: 'SQLite' },
        ],
      });

      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: `Outcomes -> read:${readPerm.outcome.outcome}, rm:${rmPerm.outcome.outcome}, question:${questionPerm.outcome.outcome}`,
          },
        },
      });
      return { stopReason: 'end_turn' };
    });
}

async function main(): Promise<void> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-ex2-'));
  try {
    const runtime = new LocalExecutionRuntime({ defaultCwd: workspaceDir });

    // Demonstrate fail-closed workspace boundary policy
    try {
      await assertPathWithinWorkspace(runtime, workspaceDir, '/etc/passwd');
    } catch (err) {
      console.log('[1] Fail-closed path policy blocked escape:', (err as Error).message);
    }

    const gateMiddleware = createPolicyGateMiddleware({
      rules: [
        { id: 'allow-reads', match: { category: 'file_read' }, action: 'allow' },
        {
          id: 'deny-rm',
          match: { toolPattern: 'rm -rf*' },
          action: 'deny',
          reason: 'Destructive rm blocked',
        },
      ],
    });

    const driver = createAcpDriver({
      id: 'antigravity',
      flavor: antigravityFlavor,
      inProcessAgent: createSimulatedAntigravityAgent(),
    });

    const adapter = await driver.createAdapter(
      {},
      {
        runtime,
        gateMiddleware,
        interactiveGateHandler: async (req) => {
          console.log(
            '[2] Interactive handler invoked for:',
            req.kind,
            req.kind === 'approval' ? req.title : req.prompt,
          );
          return { decision: 'allow_once', source: 'user' };
        },
      },
    );

    await using session = await adapter.openSession({
      cwd: workspaceDir,
      permissionMode: 'full_access',
    });

    const ac = new AbortController();
    const events: AgentEvent[] = [];
    const loop = (async () => {
      for await (const ev of session.events({ signal: ac.signal })) {
        events.push(ev);
        if (ev.type === 'assistant.completed') {
          console.log('[3] Agent reply:', ev.text);
        }
        if (ev.type === 'turn.completed') {
          ac.abort();
        }
      }
    })();

    await session.sendTurn({ prompt: 'Inspect repo and ask DB preference' });
    await loop;
    console.log(
      '[4] Gate resolutions:',
      events
        .filter(
          (e): e is Extract<AgentEvent, { type: 'gate.resolved' }> => e.type === 'gate.resolved',
        )
        .map((e) => ({
          id: e.requestId,
          decision: e.resolution.decision,
          source: e.resolution.source,
        })),
    );
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

await main();
