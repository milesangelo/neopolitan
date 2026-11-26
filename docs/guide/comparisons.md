# Comparisons

How Neopolitan compares with adjacent TypeScript and coding-agent toolkits — and when each is the right fit.

## Capability Matrix

| Feature | Neopolitan | `@agentclientprotocol/sdk` | Claude Agent SDK | Vercel AI SDK |
|---|---|---|---|---|
| **Primary Scope** | Multi-provider coding-agent harness SDK + CLI | Wire protocol SDK for ACP servers/clients | Claude Code TypeScript SDK | LLM HTTP/streaming completions |
| **Supported Harnesses** | Claude Code, Codex, ACP v1/v2, PTY + HTTP hooks | ACP agents only | Claude Code only | Stateless model APIs |
| **Policy & Disguised Gate Guard** | Built-in `GateMiddleware` | Manual callback wiring | Hook callbacks | N/A |
| **Durable Cross-Provider Handoff** | Built-in `JsonlEventStore` + `redactSecrets()` | None | Claude resume only | App-owned |
| **Git Worktree Isolation & Tiers** | Built-in (`@neopolitan-ai/workspace`) | None | None | None |
| **Headless HTTP+SSE / WS Server** | Built-in (`@neopolitan-ai/server`) | Stdio/stream only | No | Helpers only |
| **Runtime Constraints** | Pure Node / TypeScript + Zod (`node-pty` optional) | Pure TypeScript + Zod | Node/TS | Pure TS |

## Choosing the Right Layer

- **Use `@agentclientprotocol/sdk` directly** when you are building a single custom ACP agent server or only need raw JSON-RPC ACP framing. Neopolitan uses `@agentclientprotocol/sdk/unstable` inside `@neopolitan-ai/adapter-acp` and adds dialect flavors, fail-closed workspace path checks, `id: 0` remapping, and cross-provider session portability on top.
- **Use Vercel AI SDK** when you are calling stateless model endpoints (`generateText` / `streamText`) with your own tool execution loop in-process. Use **Neopolitan** when you want to orchestrate full coding-agent CLIs/harnesses (`Claude Code`, `Codex`, `OpenCode`, etc.) with persistent sessions, Git worktrees, and approval gates.
- **Use Neopolitan** when your application needs to support multiple coding-agent flavors behind one interface, hand off conversations between providers, run headless over HTTP+SSE/WS, or guard autonomous runs with fail-closed policy & worktree safety tiers.
