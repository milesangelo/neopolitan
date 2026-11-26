---
layout: home

hero:
  name: Neopolitan
  text: Every coding-agent flavor in one container.
  tagline: Modular, provider-agnostic TypeScript SDK & CLI for Claude Code, OpenAI Codex, ACP v1/v2 harnesses, and interactive CLIs — without Electron, Effect-TS, or vendor lock-in.
  image:
    src: /logo.svg
    alt: Neopolitan
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Core Concepts
      link: /concepts/architecture
    - theme: alt
      text: Patterns & Recipes
      link: /patterns/provider-swap-handoff

features:
  - title: 3-Tier TypeScript SPI
    details: Built strictly on Promise, AsyncIterable, AbortSignal, and Zod. Swap between Claude Code, Codex, OpenCode, Antigravity, or PTY without rewriting turn or gate loops.
    link: /concepts/architecture
    linkText: Architecture & SPI
  - title: Canonical Events & Receipts
    details: Monotonic EventHub replay, non-ephemeral cursor resume (afterSeq), 4-outcome DispatchReceipt guarantees, and monotonic interview settlement.
    link: /concepts/events-and-receipts
    linkText: Events & Receipts
  - title: Hybrid Provider Swap & Handoff
    details: Durable JsonlEventStore recovers past crash-truncated lines, redacts secrets via redactSecrets(), and chooses native-resume vs compiled-prelude automatically.
    link: /patterns/provider-swap-handoff
    linkText: Provider Swap Pattern
  - title: Fail-Closed Gates & Env Scrubbing
    details: GateMiddleware never auto-approves disguised elicitations even under full_access, while env scrubbers isolate ambient keys, rejected configs, and parent tokens.
    link: /patterns/policy-gates-and-elicitation
    linkText: Policy & Gate Pattern
  - title: Multi-Repo Worktrees & Review
    details: GitWorkspaceManager discovers AGENTS.md/CLAUDE.md rules, formats structured ReviewTarget prompts, and classifies 6 cleanup safety tiers before deleting anything.
    link: /patterns/worktrees-and-review
    linkText: Worktree Pattern
  - title: Headless RPC & Multi-Agent Ready
    details: Ship a non-blocking HTTP+SSE & WebSocket server with KeyedLock serialization, quota fallback ladders, A2ABroker messaging, and peer-review loops.
    link: /patterns/headless-rpc-server
    linkText: Headless RPC Pattern
---

## One SPI, Every Harness

Write your orchestration, approval policy, and streaming consumer once. Switching providers changes only the driver configuration and provider ID:

::: code-group

```ts [Claude Code]
import { LocalExecutionRuntime, SessionManager, InMemoryEventStore } from 'neopolitan-ai';
import { createClaudeDriver } from 'neopolitan-ai/claude';
import { ProviderRegistry } from '@neopolitan-ai/core';

const registry = new ProviderRegistry().register(createClaudeDriver());
const manager = new SessionManager(registry, new InMemoryEventStore(), {
  runtime: new LocalExecutionRuntime(),
});

await using session = await manager.open('claude-code', {
  cwd: process.cwd(),
  permissionMode: 'supervised',
});
await session.sendTurn({ prompt: 'Audit src/auth.ts for timing leaks' });
```

```ts [OpenAI Codex]
import { LocalExecutionRuntime, SessionManager, InMemoryEventStore } from 'neopolitan-ai';
import { createCodexDriver } from 'neopolitan-ai/codex';
import { ProviderRegistry } from '@neopolitan-ai/core';

const registry = new ProviderRegistry().register(createCodexDriver());
const manager = new SessionManager(registry, new InMemoryEventStore(), {
  runtime: new LocalExecutionRuntime(),
});

await using session = await manager.open('codex', {
  cwd: process.cwd(),
  permissionMode: 'auto_accept_edits',
});
await session.sendTurn({ prompt: 'Audit src/auth.ts for timing leaks' });
```

```ts [OpenCode / Antigravity (ACP)]
import { LocalExecutionRuntime, SessionManager, InMemoryEventStore } from 'neopolitan-ai';
import { createAcpDriver } from 'neopolitan-ai/acp';
import { ProviderRegistry } from '@neopolitan-ai/core';

const registry = new ProviderRegistry().register(
  createAcpDriver({ id: 'opencode', command: 'opencode', args: ['acp'], flavor: 'opencode' }),
);
const manager = new SessionManager(registry, new InMemoryEventStore(), {
  runtime: new LocalExecutionRuntime(),
});

await using session = await manager.open('opencode', { cwd: process.cwd() });
await session.sendTurn({ prompt: 'Audit src/auth.ts for timing leaks' });
```

```ts [Amp / Custom CLI (PTY)]
import { LocalExecutionRuntime, SessionManager, InMemoryEventStore } from 'neopolitan-ai';
import { createPtyDriver } from 'neopolitan-ai/pty';
import { ProviderRegistry } from '@neopolitan-ai/core';

const registry = new ProviderRegistry().register(
  createPtyDriver({ command: 'amp' }),
);
const manager = new SessionManager(registry, new InMemoryEventStore(), {
  runtime: new LocalExecutionRuntime(),
});

await using session = await manager.open('pty', { cwd: process.cwd() });
await session.sendTurn({ prompt: 'Audit src/auth.ts for timing leaks' });
```

:::

## Modular Architecture DAG

`@neopolitan-ai/core` has zero dependency on Node child processes, native binaries, Electron, or Effect-TS. Optional `node-pty` lives strictly behind `@neopolitan-ai/adapter-pty`, and `vitest` lives strictly inside `@neopolitan-ai/testing/conformance`.

<div class="neo-diagram">
  <svg viewBox="0 0 820 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Neopolitan modular package dependency DAG">
    <defs>
      <marker id="neo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
      </marker>
    </defs>

    <!-- Umbrella -->
    <rect x="275" y="16" width="270" height="46" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="410" y="36" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">neopolitan-ai</text>
    <text x="410" y="52" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Umbrella Re-Exports + Zero-Dep CLI</text>

    <!-- Edges from Umbrella -->
    <line x1="330" y1="62" x2="155" y2="104" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
    <line x1="410" y1="62" x2="410" y2="104" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
    <line x1="490" y1="62" x2="665" y2="104" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />

    <!-- Middle Layer: Adapters -->
    <rect x="24" y="108" width="260" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="154" y="131" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Provider Adapters</text>
    <text x="154" y="149" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">adapter-claude · adapter-codex</text>
    <text x="154" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">adapter-acp · adapter-pty (opt. node-pty)</text>

    <!-- Middle Layer: Stateful Infra -->
    <rect x="304" y="108" width="212" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="410" y="131" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Stateful Infra</text>
    <text x="410" y="149" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">sessions · server</text>
    <text x="410" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">orchestration</text>

    <!-- Middle Layer: Runtimes, Auth, Workspace -->
    <rect x="536" y="108" width="260" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="666" y="131" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Runtimes &amp; Environment</text>
    <text x="666" y="149" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">runtime-local (Local + WSL2)</text>
    <text x="666" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">auth (AES-GCM) · workspace (Worktrees)</text>

    <!-- Edges to Core -->
    <line x1="154" y1="180" x2="310" y2="232" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
    <line x1="410" y1="180" x2="410" y2="232" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
    <line x1="666" y1="180" x2="510" y2="232" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />

    <!-- Core -->
    <rect x="190" y="236" width="440" height="58" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
    <text x="410" y="259" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">@neopolitan-ai/core (Pure TS + Zod)</text>
    <text x="410" y="277" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">ProviderDriver · AgentSession · AgentEvent · GateMiddleware · EventHub · redactSecrets</text>

    <!-- Testing dev-only -->
    <rect x="24" y="242" width="144" height="46" rx="8" fill="var(--vp-c-bg)" stroke="var(--vp-c-divider)" stroke-dasharray="5 3" stroke-width="1.5" />
    <text x="96" y="262" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--vp-c-text-1)">@neopolitan-ai/testing</text>
    <text x="96" y="278" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Mocks + /conformance</text>
    <line x1="168" y1="265" x2="186" y2="265" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />

    <text x="410" y="322" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Verified acyclic by scripts/check-boundaries.mjs and tested across Linux, macOS, and Windows.</text>
  </svg>
</div>

## Battle-Tested Protocol Hardening

Community harnesses exhibit subtle wire quirks in production. Neopolitan handles them inside its adapters and stores so application code never has to:

| CLI / Subsystem | Real-World Failure Mode | Neopolitan Protection |
|---|---|---|
| **Claude Code** | `SessionStart:resume` emits a foreign boot UUID before `system/init`; `~/.claude.json` rejected keys trigger silent failures | Holds session ID binding until `system/init`, splices `prefixArgs` cleanly, and scrubs rejected keys with `withoutRejectedClaudeApiKey` |
| **Codex App-Server** | Node `readline` splits lines on `U+2028`/`U+2029`; unpaired UTF-16 surrogates corrupt JSON-RPC; hung servers stall turns | Strict LF-only NDJSON framer (`createLfNdjsonFramer`), `sanitizeLoneSurrogates`, and configurable hang timeout retirement |
| **ACP v1 / v2** | JSON-RPC `id: 0` fails Int32 validation on certain servers; non-JSON stdout banner lines break parsers | `createHardenedAcpStream` remaps `id: 0` above `ACP_INT32_ID_FLOOR`, filters non-JSON noise, and scrubs `RequestError.data` |
| **Antigravity ACP** | Questions arrive disguised as `session/request_permission` (`interaction_*`) and risk silent approval under `full_access` | `antigravityFlavor` tags `isDisguisedElicitation: true`; `GateMiddleware` never auto-approves disguised elicitations |
| **Event Persistence** | Abrupt `SIGKILL` leaves a half-written final JSON record in `.events.jsonl` | `JsonlEventStore.read()` catches malformed trailing JSON lines gracefully while preserving all prior events |
| **PTY + Hooks** | `OSC 7501` status markers and HTTP `PermissionRequest` hooks race or go silent | `HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS` (2 min) gives HTTP hooks precedence until silence triggers fallback |

## Build by Use Case

Pick the production pattern closest to your architecture:

<div class="neo-use-cases">
  <a class="neo-card" href="./patterns/provider-swap-handoff">
    <span class="neo-card-tag">Pattern 01</span>
    <span class="neo-card-title">Provider Swap &amp; Hybrid Handoff</span>
    <span class="neo-card-desc">Start a task on Claude Code, capture canonical history + git diff, and resume cleanly on Codex within a token budget.</span>
  </a>
  <a class="neo-card" href="./patterns/policy-gates-and-elicitation">
    <span class="neo-card-tag">Pattern 02</span>
    <span class="neo-card-title">Policy Gates &amp; Elicitation</span>
    <span class="neo-card-desc">Enforce declarative allow/deny rules, block disguised prompts, and validate workspace path escapes fail-closed.</span>
  </a>
  <a class="neo-card" href="./patterns/headless-rpc-server">
    <span class="neo-card-tag">Pattern 03</span>
    <span class="neo-card-title">Headless RPC Server (HTTP+SSE &amp; WS)</span>
    <span class="neo-card-desc">Run a bearer-authenticated RPC daemon with non-blocking turn dispatch and deterministic afterSeq cursor replay.</span>
  </a>
  <a class="neo-card" href="./patterns/worktrees-and-review">
    <span class="neo-card-tag">Pattern 04</span>
    <span class="neo-card-title">Isolated Worktrees &amp; Code Review</span>
    <span class="neo-card-desc">Spin up multi-repo Git worktrees, discover AGENTS.md rules, and guard cleanup with 6 safety tiers.</span>
  </a>
  <a class="neo-card" href="./patterns/multi-agent-orchestration">
    <span class="neo-card-tag">Pattern 05</span>
    <span class="neo-card-title">Multi-Agent &amp; Quota Fallback</span>
    <span class="neo-card-desc">Coordinate role claims, A2A messaging, cascade teardown, peer-review loops, and 4-rung rate-limit failover.</span>
  </a>
  <a class="neo-card" href="./patterns/custom-adapters">
    <span class="neo-card-tag">Pattern 06</span>
    <span class="neo-card-title">Custom Adapters &amp; Conformance</span>
    <span class="neo-card-desc">Wrap any CLI or HTTP agent in a ProviderDriver and verify it with the shared conformance suite &amp; fixtures.</span>
  </a>
</div>
