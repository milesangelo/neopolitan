# Pattern 01: Provider Swap & Hybrid Handoff

Rate limits, context exhaustion, or specialized strengths (e.g., drafting in Claude Code and finishing verification in OpenAI Codex) shouldn't force users to copy-paste terminal transcripts.

`@neopolitan-ai/sessions` pairs durable event logging (`JsonlEventStore`) with a deterministic **hybrid handoff compiler** (`compileHandoffBundle` and `SessionManager.handoff()`).

## Hybrid Handoff Decision Flow

<div class="neo-diagram">
  <svg viewBox="0 0 820 205" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hybrid handoff decision tree">
    <defs>
      <marker id="hoff-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
      </marker>
    </defs>

    <rect x="20" y="64" width="210" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="125" y="90" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">SessionManager.handoff()</text>
    <text x="125" y="109" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Reads snapshot + .events.jsonl</text>
    <text x="125" y="125" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Same provider + cwd + profile?</text>

    <line x1="230" y1="84" x2="310" y2="52" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#hoff-arrow)" />
    <text x="270" y="56" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--vp-c-brand-1)">YES</text>

    <line x1="230" y1="116" x2="310" y2="148" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#hoff-arrow)" />
    <text x="270" y="148" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--vp-c-text-2)">NO</text>

    <rect x="314" y="20" width="484" height="62" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
    <text x="556" y="45" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">strategy: &apos;native-resume&apos;</text>
    <text x="556" y="64" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Reuses source nativeAnchor (sessionId / threadId) directly — zero re-summarization</text>

    <rect x="314" y="104" width="484" height="84" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="556" y="128" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">strategy: &apos;compiled-prelude&apos;</text>
    <text x="556" y="147" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">1. Optional HandoffSummarizer (50% tokenBudget) + recent turns (60% chars) + gitDiff (25%)</text>
    <text x="556" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">2. Scrubs all sections with redactSecrets() before injecting target contextPrelude</text>
  </svg>
</div>

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
