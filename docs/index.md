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

<NeoDiagram name="dag" />

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
