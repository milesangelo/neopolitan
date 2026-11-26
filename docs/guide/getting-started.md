# Getting Started

Neopolitan works **both** as a zero-dependency CLI for probing local coding agents and running headless RPC servers, and as a modular TypeScript SDK you embed directly in desktop apps, CI workers, or web backends.

## Install

Install the umbrella `neopolitan-ai` package (includes the CLI, core contracts, runtime, adapters, sessions, workspace, server, and orchestration) or install only the `@neopolitan-ai/*` packages you need:

::: code-group

```bash [npm (Umbrella)]
npm install neopolitan-ai
```

```bash [pnpm (Umbrella)]
pnpm add neopolitan-ai
```

```bash [bun (Umbrella)]
bun add neopolitan-ai
```

```bash [Scoped Packages Only]
pnpm add @neopolitan-ai/core @neopolitan-ai/runtime-local @neopolitan-ai/adapter-codex @neopolitan-ai/sessions
```

:::

::: tip Requirements
- **Consumers & Runtime:** Node.js `>= 20.0.0` (`22` or `24` LTS recommended). Pure ESM (`"type": "module"`).
- **Optional `node-pty`:** `@neopolitan-ai/adapter-pty` marks `node-pty` as an optional `peerDependency`, so installing `neopolitan-ai` triggers zero native C++ builds unless you explicitly use PTY mode.
:::

## 10-Second CLI Probe

Verify which coding-agent CLIs are available in your environment:

```bash
npx neopolitan-ai doctor
```

Use `--json --require <id>` in CI pipelines or bootstrap scripts to fail fast if a required harness is missing. See the full [CLI Reference](./cli).

## Your First SDK Session (15 Lines)

```ts
import {
  InMemoryEventStore,
  LocalExecutionRuntime,
  SessionManager,
  createDefaultRegistry,
} from 'neopolitan-ai';

const manager = new SessionManager(createDefaultRegistry(), new InMemoryEventStore(), {
  runtime: new LocalExecutionRuntime({ defaultCwd: process.cwd() }),
});

await using session = await manager.open('codex', {
  cwd: process.cwd(),
  permissionMode: 'supervised',
});

const receipt = await session.sendTurn({ prompt: 'Run vitest and summarize any failures' });
console.log('Dispatch receipt:', receipt);

for await (const ev of session.events()) {
  if (ev.type === 'assistant.delta') process.stdout.write(ev.text);
  if (ev.type === 'turn.completed') break;
}
```

## Mock Testing Without API Keys

Install `@neopolitan-ai/testing` as a `devDependency` to run deterministic tests in Vitest, Node's test runner, or plain scripts — root imports of `@neopolitan-ai/testing` never import `vitest`:

```ts
import { ProviderRegistry } from '@neopolitan-ai/core';
import { MockExecutionRuntime, createMockDriver } from '@neopolitan-ai/testing';

const registry = new ProviderRegistry().register(createMockDriver());
const runtime = new MockExecutionRuntime();
```

## Where to Go Next

- Learn how the 3-tier SPI works in [Architecture & 3-Tier SPI](/concepts/architecture).
- Understand canonical streaming in [Canonical Events & Receipts](/concepts/events-and-receipts).
- Jump straight to production examples in [Provider Swap & Hybrid Handoff](/patterns/provider-swap-handoff).
