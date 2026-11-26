# `@neopolitan/*` Examples

Self-contained, offline-runnable TypeScript examples demonstrating every layer of Neopolitan:

| File | Scenario | Packages Exercised |
| :--- | :--- | :--- |
| [01-provider-swap-handoff.ts](./src/01-provider-swap-handoff.ts) | Start work on one provider, fold events via `TurnItemAccumulator`, and hot-swap mid-task to another provider with `SessionManager.handoff` + `JsonlEventStore` | `@neopolitan/core`, `@neopolitan/sessions`, `@neopolitan/testing` |
| [02-acp-client-and-gates.ts](./src/02-acp-client-and-gates.ts) | Drive an in-process `@agentclientprotocol/sdk` agent with `antigravityFlavor`, declarative `PolicyRule`s, disguised-elicitation protection, and fail-closed `assertPathWithinWorkspace` | `@neopolitan/core`, `@neopolitan/runtime-local`, `@neopolitan/adapter-acp` |
| [03-headless-rpc-server.ts](./src/03-headless-rpc-server.ts) | Run `AgentRpcServer` with Bearer auth, handle a live gate concurrently over HTTP+SSE, and replay events over WebSocket with `afterSeq` | `@neopolitan/core`, `@neopolitan/sessions`, `@neopolitan/server`, `@neopolitan/testing` |
| [04-isolated-worktree-review.ts](./src/04-isolated-worktree-review.ts) | Create an isolated Git worktree, discover `AGENTS.md`, snapshot heads, compute diffs, classify cleanup safety tiers, format `ReviewTarget` comments, and manage an isolated `DevServer` | `@neopolitan/core`, `@neopolitan/workspace` |
| [05-multi-agent-orchestration.ts](./src/05-multi-agent-orchestration.ts) | Seal credentials with `EncryptedHostFileSecretStore`, compute cross-provider `FallbackPolicyEngine` steps, coordinate A2A agents & role claims, and run a multi-round `runPeerReviewLoop` | `@neopolitan/core`, `@neopolitan/auth`, `@neopolitan/sessions`, `@neopolitan/orchestration`, `@neopolitan/testing` |

## Run

From the repository root:

```bash
pnpm run examples:all
```

Or run individually:

```bash
pnpm run example:handoff
pnpm run example:acp
pnpm run example:server
pnpm run example:workspace
pnpm run example:orchestration
```
