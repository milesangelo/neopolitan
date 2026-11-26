# Pattern 01: Provider Swap & Hybrid Handoff

Rate limits, context exhaustion, or specialized strengths (e.g., drafting in Claude Code and finishing verification in OpenAI Codex) shouldn't force users to copy-paste terminal transcripts.

`@neopolitan-ai/sessions` pairs durable event logging (`JsonlEventStore`) with a deterministic **hybrid handoff compiler** (`compileHandoffBundle` and `SessionManager.handoff()`).

## Hybrid Handoff Decision Flow

<NeoDiagram name="handoff" />

## End-to-End Example (`01-provider-swap-handoff.ts`)

::: code-group

```ts [TypeScript SDK]
import { ProviderRegistry } from '@neopolitan-ai/core';
import { JsonlEventStore, SessionManager, TurnItemAccumulator } from '@neopolitan-ai/sessions';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';
import { createClaudeDriver } from '@neopolitan-ai/adapter-claude';
import { createCodexDriver } from '@neopolitan-ai/adapter-codex';

const registry = new ProviderRegistry()
  .register(createClaudeDriver())
  .register(createCodexDriver());

const store = new JsonlEventStore('./.neopolitan-sessions');
const manager = new SessionManager(registry, store, {
  runtime: new LocalExecutionRuntime({ defaultCwd: process.cwd() }),
});

// 1. Start work on Claude Code
const claudeSession = await manager.open('claude-code', {
  cwd: '/workspace/app',
  model: { model: 'claude-sonnet-4-5' },
});
// ... run turn and wait for pending JSONL writes while session remains open ...
await manager.waitForFlush(claudeSession.sessionId);

// 2. Hot-swap to Codex with custom summarizer + git diff within 8,000 token cap
const { session: codexSession, bundle } = await manager.handoff(
  claudeSession.sessionId,
  { providerId: 'codex', model: { model: 'gpt-5-codex' } },
  {
    tokenBudget: 8_000,
    gitDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n+export function verifyJwt() {}',
    summarizer: {
      async summarize({ events, maxTokens }) {
        return `Summarized ${events.length} canonical events within ${maxTokens} tokens.`;
      },
    },
  },
);

console.log(bundle.strategy); // 'compiled-prelude'
```

```bash [CLI Equivalent]
npx neopolitan-ai handoff \
  --store ./.neopolitan-sessions \
  --session sess-01 \
  --to codex \
  --budget 8000
```

:::

## Hardening Highlights

- **Non-blocking `waitForFlush(sessionId)`:** Tracks background `EventStore` write promises independently of `pumpEvents()`, so callers can flush JSONL writes before handing off while the source session stays open.
- **Crash-truncated JSONL recovery:** If a sudden crash leaves an incomplete JSON fragment on the final line of `.events.jsonl`, `JsonlEventStore.read()` ignores only the corrupt line and preserves every prior canonical event.
- **Zero secret leaks in handoff context:** `compileHandoffBundle()` passes `summaryMarkdown`, `recentTurnsMarkdown`, and `gitStatusSummary` through `redactSecrets()` automatically.

See runnable source: [`examples/src/01-provider-swap-handoff.ts`](https://github.com/milesangelo/neopolitan/blob/main/examples/src/01-provider-swap-handoff.ts).
