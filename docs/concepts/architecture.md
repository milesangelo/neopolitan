# Architecture & 3-Tier SPI

Most coding-agent wrappers either couple directly to one vendor CLI or drag heavy application frameworks (Electron IPC, Effect-TS fibers, native C++ binaries) into every downstream consumer.

Neopolitan separates **pure contracts** (`@neopolitan-ai/core`), **execution environments** (`ExecutionRuntime`), **protocol adapters**, and **stateful infrastructure** into an acyclic, strictly typed dependency graph.

## The 3-Tier Provider SPI

<NeoDiagram name="spi" />

1. **`ProviderDriver<TConfig, TProviderOptions>`** is lightweight and stateless. Registering a driver in `ProviderRegistry` spawns zero subprocesses and performs zero I/O until `probe()` or `createAdapter()` is invoked.
2. **`ProviderAdapter<TProviderOptions>`** binds a validated driver config to `AdapterDependencies` (`runtime: ExecutionRuntime`, optional `gateMiddleware`, optional `interactiveGateHandler`). It optionally prepares MCP workspace files via `prepareWorkspace()` and opens sessions via `openSession()`.
3. **`AgentSession<TProviderOptions>`** extends `AsyncDisposable` (`await using session = ...`) and owns the live turn lifecycle: non-blocking `sendTurn()`, `steerTurn()`, `interruptTurn()`, `respondToGate()`, session mutations (`setModel()`, `setPermissionMode()`, `fork()`, `rollback()`, `compact()`), and replayable `events()`.

## Hard Architectural Boundaries

Every pull request runs `scripts/check-boundaries.mjs` to enforce five invariants:

- **Core Purity (`@neopolitan-ai/core`):** Imports only TypeScript + `zod`. Never touches `node:child_process`, `node-pty`, `electron`, `effect`, or sibling workspace packages.
- **`node-pty` Isolation:** Only `@neopolitan-ai/adapter-pty` references `node-pty`, strictly as an optional `peerDependency` loaded via dynamic `import('node-pty')`.
- **Vitest-Free Testing Runtime (`@neopolitan-ai/testing`):** Root exports (`MockExecutionRuntime`, `createMockDriver`) can execute inside production smoke scripts without pulling Vitest internals; `runProviderConformanceSuite` lives cleanly at `@neopolitan-ai/testing/conformance`.
- **Acyclic DAG & Project Reference Parity:** Every `workspace:*` dependency in `package.json` matches its TypeScript project reference in `tsconfig.json`.
- **ESM + Strict `NodeNext` Exports:** Every publishable tarball passes `publint --strict` and `attw --profile esm-only`.
