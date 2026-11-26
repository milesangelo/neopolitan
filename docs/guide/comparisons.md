# Comparisons

| Feature | Neopolitan | `@agentclientprotocol/sdk` | Claude Agent SDK | Vercel AI SDK |
|---|---|---|---|---|
| **Primary Scope** | Multi-provider coding-agent harness SDK + CLI | Wire protocol SDK for ACP servers/clients | Claude Code TypeScript SDK | LLM HTTP/streaming completions |
| **Supported Harnesses** | Claude Code, Codex, ACP v1/v2, PTY + HTTP hooks | ACP agents only | Claude Code only | Stateless model providers |
| **Approval & Elicitation Policy Engine** | Built-in `GateMiddleware` | Manual callback wiring | Hook handlers | N/A |
| **Durable Cross-Provider Handoff** | Built-in `JsonlEventStore` + secret redaction | None | Resume Claude only | App-owned |
| **Git Worktree Isolation & Tiers** | Built-in (`@neopolitan-ai/workspace`) | None | None | None |
| **Zero Electron / Effect-TS Lock-In** | Pure Node / TypeScript + Zod | Pure TypeScript + Zod | Node/TS | Pure TS |
