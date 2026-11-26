import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type AuthProfile,
  EncryptedHostFileSecretStore,
  resolveProviderEnv,
  shouldBlockSendForAuthStatus,
} from '@neopolitan-ai/auth';
import {
  type AgentEvent,
  type AgentSession,
  EventHub,
  type ProviderDriver,
  ProviderRegistry,
  type SendTurnInput,
} from '@neopolitan-ai/core';
import { FallbackPolicyEngine, Orchestrator } from '@neopolitan-ai/orchestration';
import { InMemoryEventStore, SessionManager } from '@neopolitan-ai/sessions';
import {
  MOCK_BASE_CAPABILITIES,
  MockExecutionRuntime,
  createMockDriver,
} from '@neopolitan-ai/testing';
import { z } from 'zod';

/**
 * Reviewer driver that requests revisions on round 1 and approves on round 2.
 */
function createTwoRoundReviewerDriver(): ProviderDriver {
  let reviewCount = 0;
  return {
    id: 'reviewer-mock',
    label: 'Two-Round Reviewer',
    configSchema: z.object({}),
    baseCapabilities: MOCK_BASE_CAPABILITIES,
    async probe() {
      return { available: true, authStatus: 'authenticated' };
    },
    async createAdapter() {
      return {
        id: 'reviewer-mock',
        capabilities: MOCK_BASE_CAPABILITIES,
        async openSession(input): Promise<AgentSession> {
          const sessionId = input.sessionId ?? randomUUID();
          const hub = new EventHub({ sessionId });
          hub.emit({
            type: 'session.started',
            anchor: { providerId: 'reviewer-mock', sessionId },
            capabilities: MOCK_BASE_CAPABILITIES,
          });
          const session: AgentSession = {
            sessionId,
            capabilities: MOCK_BASE_CAPABILITIES,
            events: (opts) => hub.subscribe(opts),
            async sendTurn(turn: SendTurnInput) {
              const turnId = turn.turnId ?? randomUUID();
              reviewCount++;
              const text =
                reviewCount === 1
                  ? 'Please add input validation before approval.'
                  : 'APPROVED: Input validation looks clean.';
              hub.emit({ type: 'turn.started', turnId });
              queueMicrotask(() => {
                hub.emit({ type: 'assistant.completed', turnId, blockId: `r-${turnId}`, text });
                hub.emit({
                  type: 'turn.completed',
                  turnId,
                  status: 'completed',
                  disposition: 'identified',
                  threadDisposition: 'reusable',
                });
              });
              return { outcome: 'accepted', turnId };
            },
            async interruptTurn() {},
            async respondToGate() {},
            getAnchor: () => ({ providerId: 'reviewer-mock', sessionId }),
            async close() {
              hub.emit({ type: 'session.ended', cause: 'requested' });
              hub.close();
            },
            async [Symbol.asyncDispose]() {
              await session.close();
            },
          };
          return session;
        },
      };
    },
  };
}

async function main(): Promise<void> {
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-ex5-'));
  try {
    // 1. Auth profile sealing & fail-open send gating
    const secretStore = new EncryptedHostFileSecretStore(path.join(keyDir, 'master.key'));
    const sealed = await secretStore.seal('sk-ant-demo-token');
    const profile: AuthProfile = {
      profileId: 'work-claude',
      providerId: 'claude-code',
      authKind: 'api_key',
      runtimeScope: 'host',
      sealedSecret: sealed,
      noProxy: 'localhost,127.0.0.1',
    };
    const env = await resolveProviderEnv(profile, secretStore);
    console.log(
      '[1] Auth blocks on unknown?',
      shouldBlockSendForAuthStatus('unknown'),
      'env keys:',
      Object.keys(env),
    );

    // 2. Automatic cross-provider fallback policy decision
    const fallback = new FallbackPolicyEngine({
      ladder: ['profile', 'tier', 'wait', 'notify'],
      tierGroups: [
        {
          id: 'flagship',
          models: [
            { providerId: 'claude-code', modelPattern: 'claude-opus-*' },
            { providerId: 'codex', modelPattern: 'gpt-5-codex' },
          ],
        },
      ],
      maxWaitMs: 30_000,
      returnToPreferred: 'auto',
    });
    console.log(
      '[2] Fallback action on rate_limit:',
      fallback.decideNextAction({
        failureClass: 'rate_limit',
        currentProviderId: 'claude-code',
        currentModel: 'claude-opus-4',
      }),
    );

    // 3. Multi-agent A2A messaging, role claims, cascade stop & peer-review loop
    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry()
      .register(createMockDriver())
      .register(createTwoRoundReviewerDriver());
    const store = new InMemoryEventStore();
    const manager = new SessionManager(registry, store, { runtime });
    const orchestrator = new Orchestrator(manager);

    const lead = await orchestrator.spawnAgent({
      agentId: 'lead',
      providerId: 'mock',
      cwd: '/workspace',
    });
    const worker = await orchestrator.spawnAgent({
      agentId: 'worker',
      parentAgentId: 'lead',
      providerId: 'mock',
      cwd: '/workspace',
    });

    const role1 = orchestrator.claimRole({
      agentId: 'lead',
      role: 'Implementer',
      scope: 'packages/auth',
    });
    const role2 = orchestrator.claimRole({
      agentId: 'worker',
      role: 'implementer',
      scope: 'packages/auth',
    });
    console.log(
      '[3] Role claim overlaps detected:',
      role1.overlapping.length,
      '->',
      role2.overlapping.length,
    );

    const msg = await orchestrator.sendAgentMessage({
      fromAgentId: lead.agentId,
      toAgentId: worker.agentId,
      body: 'Implement AES-GCM sealing',
      expectReply: true,
    });
    console.log('[4] A2A message delivered with responseId:', msg.responseId);

    await orchestrator.stopAgent('lead', { cascade: true });

    const reviewResult = await orchestrator.runPeerReviewLoop({
      author: { providerId: 'mock', cwd: '/workspace' },
      reviewer: { providerId: 'reviewer-mock', cwd: '/workspace' },
      task: 'Write token validator',
      maxRounds: 3,
    });
    console.log('[5] Peer review result:', reviewResult);
  } finally {
    await fs.rm(keyDir, { recursive: true, force: true });
  }
}

await main();
