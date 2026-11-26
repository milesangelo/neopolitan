# Architecture & Package DAG

Neopolitan splits coding-agent orchestration into pure contracts (`@neopolitan/core`), pluggable execution runtimes, protocol adapters, and optional stateful infrastructure.

## Core Design Rules

1. **`@neopolitan/core` has zero process or framework dependencies:** Only pure TypeScript interfaces, `EventHub`, `createLfNdjsonFramer`, `createPolicyGateMiddleware`, `redactSecrets`, `classifyProviderFailure`, and Zod schemas.
2. **Three-tier Provider SPI:**
   - `ProviderDriver`: stateless descriptor (`id`, `configSchema`, `probe()`, `createAdapter()`).
   - `ProviderAdapter`: bound to an `ExecutionRuntime` + `GateMiddleware`; creates sessions via `openSession()`.
   - `AgentSession`: `AsyncDisposable` turn controller emitting monotonic sequenced `AgentEvent` items.
3. **Isolated Optional Native Addons:** `node-pty` is strictly an optional `peerDependency` of `@neopolitan/adapter-pty`, loaded lazily only when PTY mode is opened.
4. **Vitest-Free Testing Runtime:** `@neopolitan/testing` exports `MockExecutionRuntime` and `createMockDriver` without importing Vitest; Vitest conformance helpers live under `@neopolitan/testing/conformance`.
