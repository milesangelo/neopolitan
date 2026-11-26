# Contributing to Neopolitan

Thank you for helping build `neopolitan`!

## Local Development Setup

Requirements:
- Node.js >= 20 (`20`, `22`, or `24`)
- `pnpm` (v11 recommended; `pnpm install` uses `pnpm-workspace.yaml` with `autoInstallPeers: false` so native optional dependencies are skipped)

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run examples:all
```

## Coding & Architecture Rules

Before opening a Pull Request, verify all checks locally:

```bash
pnpm run format:check
pnpm run lint
pnpm run check:boundaries
pnpm run typecheck
pnpm run test:coverage
pnpm run test:packed
```

Key architectural boundaries enforced automatically by `scripts/check-boundaries.mjs`:
- `@neopolitan/core` must stay pure TypeScript + `zod` (no `node:child_process`, `node-pty`, `electron`, `effect`, or `@neopolitan/*` imports).
- `node-pty` must stay isolated as an optional `peerDependency` in `packages/adapter-pty`.
- `@neopolitan/testing` runtime exports (`src/index.ts`) must remain Vitest-free (`vitest` belongs strictly in `src/conformance.ts`).

## Adding or Modifying a Provider Adapter

1. Implement `ProviderDriver`, `ProviderAdapter`, and `AgentSession` from `@neopolitan/core`.
2. Wire `runProviderConformanceSuite` from `@neopolitan/testing/conformance` into the adapter's test suite.
3. Add a sanitized golden NDJSON transcript under `tests/fixtures/` and an adapter replay test (`fixtures.test.ts`).
4. Do not send billed LLM API calls during `pnpm test`. Put opt-in CLI probes or zero-cost protocol handshakes behind `NEOPOLITAN_LIVE_TESTS=1`.

## Changesets & Releases

All publishable packages (`neopolitan` + `@neopolitan/*`) follow a fixed version line managed by Changesets:

```bash
pnpm changeset
```

Commit the generated `.changeset/*.md` file with your PR.
