---
layout: home

hero:
  name: Neopolitan
  text: Every coding-agent flavor in one container.
  tagline: Modular, provider-agnostic TypeScript SDK & CLI for Claude Code, OpenAI Codex, ACP v1/v2 agents, and interactive CLIs — zero Electron, zero Effect-TS, full supply-chain provenance.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture & SPI
      link: /guide/architecture
    - theme: alt
      text: Provider Matrix
      link: /guide/provider-matrix

features:
  - title: One Clean TypeScript SPI
    details: Built strictly on Promise, AsyncIterable, AbortSignal, and Zod. Swap between Claude Code, Codex, OpenCode, Antigravity, or PTY without rewriting turn or gate logic.
  - title: Deterministic Cross-Provider Handoff
    details: Durable JsonlEventStore logs every canonical event, recovers from truncated crash lines, scrubs secrets with redactSecrets(), and compiles token-budgeted handoffs.
  - title: Fail-Closed Security & Worktrees
    details: GateMiddleware never auto-approves disguised elicitations, env scrubbers strip ambient credentials, and GitWorkspaceManager classifies cleanup safety tiers before deletion.
  - title: Headless RPC & Multi-Agent Ready
    details: Ship a non-blocking HTTP+SSE & WebSocket server with cursor replay, plus quota fallback policies, A2ABroker messaging, and peer-review loops.
---
