# Neopolitan (`@neopolitan/*`)

Provider-agnostic, modular TypeScript (`Promise`, `AsyncIterable`, `AbortSignal`, Zod) SDK for driving coding-agent harnesses (`Claude Code`, `OpenAI Codex`, `ACP` v1/v2 agents, and arbitrary CLIs via optional PTY + hooks) across local, WSL, container, and cloud-sandbox runtimes — every flavor in one container.

## Packages

- [`@neopolitan/core`](./packages/core) — Driver/Adapter/Session SPI, capability manifest, canonical `AgentEvent` union, `ExecutionRuntime` interface, `GateMiddleware`, failure sanitization, `EventHub`, LF-only NDJSON framer.
- [`@neopolitan/runtime-local`](./packages/runtime-local) — `LocalExecutionRuntime` (process-tree kill, bounded stderr tail) & `WslExecutionRuntime` (`WSL_UTF8=1`, `WSLENV` isolation).
- [`@neopolitan/testing`](./packages/testing) — `MockExecutionRuntime`, `createMockDriver`, and `@neopolitan/testing/conformance` (`runProviderConformanceSuite`).
- [`@neopolitan/adapter-acp`](./packages/adapter-acp) — Hardened ACP v1/v2 adapter over `@agentclientprotocol/sdk`, dialect flavors (`antigravity`, `grok`, `kiro`, `opencode`, `copilot`, `omp`, `pi`), fail-closed workspace path policy.
- [`@neopolitan/adapter-claude`](./packages/adapter-claude) — Claude Code adapter (`stream-json` + optional SDK loader), rejected API key scrubbing, `prefixArgs` splice, cumulative token merge.
- [`@neopolitan/adapter-codex`](./packages/adapter-codex) — Clean-room Codex `app-server` NDJSON client, UTF-16 surrogate sanitizer, shared server pool + hang watchdog, `reviewStart`.
- [`@neopolitan/adapter-pty`](./packages/adapter-pty) — Optional `node-pty` runner, HTTP `AgentHookServer`, `OSC 7501` precedence, `reduceHostTurnEnd`.
- [`@neopolitan/auth`](./packages/auth) — `SecretStore` (in-memory & AES-256-GCM host-file), multi-account profiles, Bedrock/Vertex/proxy env resolution, fail-open 5-state auth status.
- [`@neopolitan/sessions`](./packages/sessions) — Event-sourced `EventStore` (`InMemoryEventStore`, `JsonlEventStore`), `TurnItemAccumulator`, `applyInterviewSettlement`, hybrid `SessionManager` + `HandoffBundle`.
- [`@neopolitan/workspace`](./packages/workspace) — Multi-repo Git worktree manager, `classifyWorktreeTier`, `AGENTS.md`/`CLAUDE.md` discovery, isolated `DevServer`.
- [`@neopolitan/server`](./packages/server) — Headless WebSocket & non-blocking reentrant HTTP+SSE RPC server + client with cursor replay.
- [`@neopolitan/orchestration`](./packages/orchestration) — `FallbackPolicyEngine`, `A2ABroker`, role claims, and `runPeerReviewLoop`.

## Quickstart

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run examples:all
```

See [examples/README.md](./examples/README.md) for runnable end-to-end use cases (`01-provider-swap-handoff.ts` through `05-multi-agent-orchestration.ts`).
