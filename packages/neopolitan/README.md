# `neopolitan`

Umbrella package and zero-dependency CLI for the [Neopolitan](https://github.com/milesangelo/neopolitan) provider-agnostic coding-agent SDK.

## Install

```bash
npm install neopolitan
```

## CLI Quickstart

```bash
npx neopolitan doctor
npx neopolitan run --provider codex "Summarize recent changes"
npx neopolitan serve --port 7420 --token secret
```

## SDK Usage

```ts
import {
  LocalExecutionRuntime,
  SessionManager,
  InMemoryEventStore,
  createDefaultRegistry,
} from 'neopolitan';

const registry = createDefaultRegistry();
const store = new InMemoryEventStore();
const manager = new SessionManager(registry, store, {
  runtime: new LocalExecutionRuntime(),
});
```

Subpath imports (`neopolitan/acp`, `neopolitan/claude`, `neopolitan/codex`, `neopolitan/pty`, `neopolitan/auth`, `neopolitan/sessions`, `neopolitan/workspace`, `neopolitan/server`, `neopolitan/orchestration`) keep tree-shaking and dependency boundaries clean.

For testing utilities (`MockExecutionRuntime`, `createMockDriver`, and `runProviderConformanceSuite`), install `@neopolitan/testing`.
