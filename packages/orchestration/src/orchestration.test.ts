import { ProviderRegistry } from '@neopolitan-ai/core';
import { InMemoryEventStore, SessionManager } from '@neopolitan-ai/sessions';
import { MockExecutionRuntime, createMockDriver } from '@neopolitan-ai/testing';
import { describe, expect, it } from 'vitest';
import { FallbackPolicyEngine, Orchestrator } from './index.js';

describe('@neopolitan-ai/orchestration', () => {
  it('walks fallback policy ladder (profile -> tier -> wait -> notify)', () => {
    const engine = new FallbackPolicyEngine({
      ladder: ['profile', 'tier', 'wait', 'notify'],
      tierGroups: [
        {
          id: 'frontier',
          models: [
            { providerId: 'claude-code', modelPattern: 'claude-opus-*' },
            { providerId: 'codex', modelPattern: 'gpt-5-codex' },
          ],
        },
      ],
      reasonOverrides: {
        auth: ['profile', 'notify'],
      },
      maxWaitMs: 30_000,
      returnToPreferred: 'auto',
    });

    expect(
      engine.decideNextAction({
        failureClass: 'rate_limit',
        currentProviderId: 'claude-code',
        currentModel: 'claude-opus-4',
        currentProfileId: 'p1',
        alternateProfileIds: ['p1', 'p2'],
      }),
    ).toEqual({ kind: 'switch_profile', profileId: 'p2' });

    expect(
      engine.decideNextAction({
        failureClass: 'rate_limit',
        currentProviderId: 'claude-code',
        currentModel: 'claude-opus-4',
      }),
    ).toEqual({ kind: 'switch_tier_model', providerId: 'codex', model: 'gpt-5-codex' });

    expect(
      engine.decideNextAction({
        failureClass: 'auth',
        currentProviderId: 'claude-code',
        currentModel: 'claude-opus-4',
      }),
    ).toEqual({ kind: 'notify', reason: 'auth' });
  });

  it('coordinates A2A messaging, role claim overlap detection, cascade stop, and peer review loops', async () => {
    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry().register(createMockDriver());
    const store = new InMemoryEventStore();
    const manager = new SessionManager(registry, store, { runtime });
    const orch = new Orchestrator(manager);

    const parent = await orch.spawnAgent({
      agentId: 'lead',
      providerId: 'mock',
      cwd: '/workspace',
    });
    const child = await orch.spawnAgent({
      agentId: 'worker-1',
      parentAgentId: 'lead',
      providerId: 'mock',
      cwd: '/workspace',
    });

    const msg = await orch.sendAgentMessage({
      fromAgentId: parent.agentId,
      toAgentId: child.agentId,
      body: 'Review auth module',
      expectReply: true,
    });
    expect(msg.responseId).toBeTruthy();
    expect(orch.getInbox('worker-1')).toHaveLength(1);

    const c1 = orch.claimRole({ agentId: 'lead', role: 'Architect', scope: 'packages/core' });
    expect(c1.overlapping).toHaveLength(0);
    const c2 = orch.claimRole({
      agentId: 'worker-1',
      role: '  architect ',
      scope: 'packages/core',
    });
    expect(c2.overlapping).toHaveLength(1);

    await orch.stopAgent('lead', { cascade: true });
    expect(orch.listAgents()).toHaveLength(0);

    const review = await orch.runPeerReviewLoop({
      author: { providerId: 'mock', cwd: '/workspace' },
      reviewer: { providerId: 'mock', cwd: '/workspace' },
      task: 'Write function',
      maxRounds: 2,
    });
    expect(review.rounds).toBe(2);
    expect(review.approved).toBe(false);
  });
});
