# Architecture & 3-Tier SPI

Most coding-agent wrappers either couple directly to one vendor CLI or drag heavy application frameworks (Electron IPC, Effect-TS fibers, native C++ binaries) into every downstream consumer.

Neopolitan separates **pure contracts** (`@neopolitan-ai/core`), **execution environments** (`ExecutionRuntime`), **protocol adapters**, and **stateful infrastructure** into an acyclic, strictly typed dependency graph.

## The 3-Tier Provider SPI

<div class="neo-diagram">
  <svg viewBox="0 0 820 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Neopolitan 3-tier SPI lifecycle">
    <defs>
      <marker id="spi-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
      </marker>
    </defs>

    <rect x="20" y="34" width="230" height="104" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="135" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">1. ProviderDriver</text>
    <text x="135" y="78" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Stateless descriptor</text>
    <text x="135" y="96" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">configSchema · baseCapabilities</text>
    <text x="135" y="114" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">probe() · discoverOptions()</text>

    <line x1="250" y1="86" x2="292" y2="86" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#spi-arrow)" />

    <rect x="296" y="34" width="230" height="104" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="2" />
    <text x="411" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">2. ProviderAdapter</text>
    <text x="411" y="78" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Bound to runtime + gates</text>
    <text x="411" y="96" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">prepareWorkspace()</text>
    <text x="411" y="114" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">openSession(input, signal)</text>

    <line x1="526" y1="86" x2="568" y2="86" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#spi-arrow)" />

    <rect x="572" y="34" width="228" height="104" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
    <text x="686" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">3. AgentSession</text>
    <text x="686" y="78" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">AsyncDisposable live handle</text>
    <text x="686" y="96" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">sendTurn() · events() · respondToGate()</text>
    <text x="686" y="114" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">getAnchor() · close()</text>
  </svg>
</div>

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
