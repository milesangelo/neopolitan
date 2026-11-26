# Neopolitan (`AGENTS.md`)

Guide for coding agents and human contributors working inside the `milesangelo/neopolitan` monorepo.

## Naming & Spelling
- The project, npm umbrella package, and scope are spelled **`neopolitan`** (`@neopolitan-ai/*`, `milesangelo/neopolitan`). Never change or "correct" the spelling to `neapolitan`.

## Architecture Invariants (Enforced by `scripts/check-boundaries.mjs`)
1. **`@neopolitan-ai/core` Purity:** `@neopolitan-ai/core` may only depend on pure TypeScript + `zod`. Never import `node:child_process`, `node-pty`, `electron`, `effect`, or sibling `@neopolitan-ai/*` packages inside `packages/core/src`.
2. **`node-pty` Isolation:** Only `packages/adapter-pty` may reference `node-pty`, strictly as an optional `peerDependency` loaded dynamically via `loadNodePtyBackend()`.
3. **`@neopolitan-ai/testing` Runtime Safety:** `packages/testing/src/index.ts` and `mock-adapter.ts` must never import `vitest`. Only `@neopolitan-ai/testing/conformance` (`src/conformance.ts`) imports `vitest`.
4. **Pure ESM (`NodeNext`):** Every package uses `"type": "module"` and `tsconfig.base.json` (`module: "NodeNext"`, `moduleResolution: "NodeNext"`, `verbatimModuleSyntax: true`). Always include `.js` extensions on relative imports.
5. **DAG Parity:** Every `workspace:*` dependency in `packages/<pkg>/package.json` must match an entry in `packages/<pkg>/tsconfig.json` `references` and root `tsconfig.json`.

## Essential Commands
```bash
pnpm run format:check      # Biome formatting check
pnpm run lint              # Biome lint checks
pnpm run check:boundaries  # Architectural & publish metadata checks
pnpm run typecheck         # Composite TypeScript build (tsc -b)
pnpm test                  # Vitest suite across all packages
pnpm run test:coverage     # Vitest + @vitest/coverage-v8 (thresholds: 80/80/80/70)
pnpm run examples:all      # Run all 5 end-to-end TypeScript examples
pnpm run test:packed       # Pack 13 tarballs + publint + attw + external consumer & CLI E2E
pnpm run docs:api && pnpm run docs:build  # TypeDoc Markdown API + VitePress site build
```

## Rules for Adding or Updating a Provider Adapter
1. Implement `ProviderDriver`, `ProviderAdapter`, and `AgentSession` cleanly without leaking provider raw objects unless `includeRaw: true` is passed to `session.events()`.
2. Wire `runProviderConformanceSuite` from `@neopolitan-ai/testing/conformance` inside your adapter tests.
3. Add a sanitized golden NDJSON transcript under `tests/fixtures/` and a replay test (`fixtures.test.ts`).
4. Never send billed LLM requests in default tests (`test:live` is strictly opt-in via `NEOPOLITAN_LIVE_TESTS=1` and executes `probe()` + zero-cost protocol handshakes only).
5. Run `pnpm changeset` if modifying runtime behavior or public APIs in publishable packages.
