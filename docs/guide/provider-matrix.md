# Provider Compatibility Matrix

| Provider / CLI | Package | Transport | Resume / Fork | Approval & Elicitation Gates | Verification Tier |
|---|---|---|---|---|---|
| **Claude Code** | `@neopolitan/adapter-claude` | `stream-json` / optional `@anthropic-ai/claude-agent-sdk` | Native resume + `messageUuid` checkpoint fork | Tool & permission gating | Conformance + Golden Fixture (`claude-stream-json.jsonl`) + Live Probe |
| **OpenAI Codex** | `@neopolitan/adapter-codex` | `app-server` JSON-RPC / NDJSON | `thread/resume` + `thread/fork` | Command, file change & user input elicitation | Conformance + Golden Fixture (`codex-app-server.jsonl`) + Live Handshake |
| **OpenCode** | `@neopolitan/adapter-acp` | ACP (`opencode` flavor) | `session/load` + tip fork | ACP permission + URL/form elicitation | Conformance + Golden Fixture + Live Handshake |
| **Antigravity (`agy`)** | `@neopolitan/adapter-acp` | ACP (`antigravity` flavor) | `session/load` | Treats `interaction_*` as `isDisguisedElicitation` | Conformance + Golden Fixture (`acp-flavors.jsonl`) + Live Probe |
| **Grok / Kiro / Copilot / `omp` / `pi`** | `@neopolitan/adapter-acp` | ACP dialect presets | Flavor-specific | ACP permission + rate/billing mapping | Flavor unit tests + Golden Fixture |
| **Amp / Droid / Custom CLI** | `@neopolitan/adapter-pty` | Optional `node-pty` + `AgentHookServer` + `OSC 7501` | Ephemeral / host turn tracking | Coarse flags + `PermissionRequest` HTTP hold | Conformance + Golden Fixture (`pty-amp-droid.jsonl`) |
