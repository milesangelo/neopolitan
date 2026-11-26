# Pattern 05: Multi-Agent Orchestration & Quota Fallback

Long-running autonomous workflows hit two realities: **single accounts hit rate limits**, and **multi-agent teams need hierarchy, messaging, role ownership, and automated peer review**.

`@neopolitan-ai/orchestration` layers cleanly on top of `SessionManager` without requiring an external actor framework.

## 1. 4-Rung Quota Fallback (`FallbackPolicyEngine`)

Evaluate failures (`rate_limit`, `billing`, `auth`, `model_unavailable`, `context_exhausted`) across a configurable 4-rung ladder (`'profile' -> 'tier' -> 'wait' -> 'notify'`):

```ts
import { FallbackPolicyEngine } from '@neopolitan-ai/orchestration';

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

const action = fallback.decideNextAction({
  failureClass: 'rate_limit',
  currentProviderId: 'claude-code',
  currentModel: 'claude-opus-4',
});
// -> { kind: 'switch_tier_model', providerId: 'codex', model: 'gpt-5-codex' }
```

## 2. Parent-Child Agents, Role Claims, A2A & Peer Review (`Orchestrator`)

```ts
import { Orchestrator } from '@neopolitan-ai/orchestration';

const orchestrator = new Orchestrator(sessionManager);

// Parent -> child spawn hierarchy
const lead = await orchestrator.spawnAgent({ agentId: 'lead', providerId: 'mock', cwd: '/workspace' });
const worker = await orchestrator.spawnAgent({
  agentId: 'worker',
  parentAgentId: 'lead',
  providerId: 'mock',
  cwd: '/workspace',
});

// Detect overlapping file/module claims (case-insensitive role + scope)
orchestrator.claimRole({ agentId: 'lead', role: 'Implementer', scope: 'packages/auth' });
const overlap = orchestrator.claimRole({ agentId: 'worker', role: 'implementer', scope: 'packages/auth' });
console.log(overlap.overlapping.length); // 1

// Direct agent-to-agent dispatch (A2A)
await orchestrator.sendAgentMessage({
  fromAgentId: lead.agentId,
  toAgentId: worker.agentId,
  body: 'Implement AES-GCM sealing',
  expectReply: true,
});

// Cascade stop kills parent + all descendants cleanly
await orchestrator.stopAgent('lead', { cascade: true });

// Author <-> Reviewer loop until "APPROVED:" or maxRounds
const reviewResult = await orchestrator.runPeerReviewLoop({
  author: { providerId: 'claude-code', cwd: '/workspace' },
  reviewer: { providerId: 'codex', cwd: '/workspace' },
  task: 'Write token validator',
  maxRounds: 3,
});
```

::: tip Auth Fail-Open Integration
Pair `FallbackPolicyEngine` with `@neopolitan-ai/auth`'s `EncryptedHostFileSecretStore` and `resolveProviderEnv()` so failed over profiles automatically mount clean `CLAUDE_CONFIG_DIR` / `CODEX_HOME` credentials.
:::

See runnable source: [`examples/src/05-multi-agent-orchestration.ts`](https://github.com/milesangelo/neopolitan/blob/main/examples/src/05-multi-agent-orchestration.ts).
