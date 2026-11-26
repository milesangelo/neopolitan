# `neopolitan-ai`

Umbrella package and zero-dependency CLI for the [Neopolitan](https://github.com/milesangelo/neopolitan) provider-agnostic coding-agent SDK.

## Install

```bash
npm install neopolitan-ai
```

## CLI Quickstart

```bash
npx neopolitan-ai doctor
npx neopolitan-ai run --provider codex "Summarize recent changes"
npx neopolitan-ai serve --port 7420 --token secret
```

## SDK Usage

```ts
import {
  LocalExecutionRuntime,
  SessionManager,
  InMemoryEventStore,
  createDefaultRegistry,
} from 'neopolitan-ai';

const registry = createDefaultRegistry();
const store = new InMemoryEventStore();
const manager = new SessionManager(registry, store, {
  runtime: new LocalExecutionRuntime(),
});
```

Subpath imports (`neopolitan-ai/acp`, `neopolitan-ai/claude`, `neopolitan-ai/codex`, `neopolitan-ai/pty`, `neopolitan-ai/auth`, `neopolitan-ai/sessions`, `neopolitan-ai/workspace`, `neopolitan-ai/server`, `neopolitan-ai/orchestration`) keep tree-shaking and dependency boundaries clean.

For testing utilities (`MockExecutionRuntime`, `createMockDriver`, and `runProviderConformanceSuite`), install `@neopolitan-ai/testing`.
