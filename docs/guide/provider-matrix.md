# Provider Compatibility Matrix

Neopolitan normalizes heterogeneous coding-agent harnesses under one `ProviderCapabilities` manifest and `AgentSession` interface while exposing dialect flavor presets where ACP servers diverge.

## Harness Matrix

| Provider / CLI | Package | Transport | Resume / Fork | Approval & Elicitation Gates | Verification Tier |
|---|---|---|---|---|---|
| **Claude Code** | `@neopolitan-ai/adapter-claude` | `stream-json` / optional `@anthropic-ai/claude-agent-sdk` | Native resume + `messageUuid` checkpoint fork | Tool & permission gating | Conformance + Golden Fixture (`claude-stream-json.jsonl`) + Live Probe |
| **OpenAI Codex** | `@neopolitan-ai/adapter-codex` | `app-server` JSON-RPC / NDJSON | `thread/resume` + `thread/fork` | Command, file change & user input elicitation | Conformance + Golden Fixture (`codex-app-server.jsonl`) + Live Handshake |
| **OpenCode** | `@neopolitan-ai/adapter-acp` | ACP (`opencode` flavor) | `session/load` + tip fork | ACP permission + URL/form elicitation | Conformance + Golden Fixture + Live Handshake |
| **Antigravity (`agy`)** | `@neopolitan-ai/adapter-acp` | ACP (`antigravity` flavor) | `session/load` | Treats `interaction_*` as `isDisguisedElicitation` | Conformance + Golden Fixture (`acp-flavors.jsonl`) + Live Probe |
| **Grok / Kiro / Copilot / `omp` / `pi`** | `@neopolitan-ai/adapter-acp` | ACP dialect presets | Flavor-specific | ACP permission + rate/billing mapping | Flavor unit tests + Golden Fixture |
| **Amp / Droid / Custom CLI** | `@neopolitan-ai/adapter-pty` | Optional `node-pty` + `AgentHookServer` + `OSC 7501` | Ephemeral / host turn tracking | Coarse flags + `PermissionRequest` HTTP hold | Conformance + Golden Fixture (`pty-amp-droid.jsonl`) |

## ACP Dialect Flavors (`resolveAcpFlavor`)

`@neopolitan-ai/adapter-acp` automatically resolves dialect hooks by agent ID or binary name (`opencode`, `antigravity`/`agy`, `grok`, `kiro`, `copilot`, `omp`, `pi`):

| Flavor ID | Protocol Quirk Handled |
|---|---|
| `antigravity` / `agy` | Flags `toolCallId` starting with `interaction_` via `isDisguisedElicitation`, preventing auto-approval in `full_access` mode |
| `grok` | Sets `sessionLoadIdleMs: 2000` for servers whose `session/load` omits a final response; passes extension `_meta` on prompts/cancels; maps `-32003` -> `'rate_limit'` |
| `opencode` | Maps HTTP `402` or billing/credit messages cleanly to `failureClass: 'billing'` |
| `copilot` | Sets `alwaysSetModelOnNewSession: true` so model selection applies reliably right after `session/new` |
| `omp` | Enables `stripToolEchoPrefix: true` to normalize redundant tool prefixes |
| `kiro` / `pi` / `default` | Standard ACP v1/v2 capabilities with fail-closed `assertPathWithinWorkspace` file checks |

::: info Verification Level Definitions
- **Conformance:** Tested against the shared Vitest suite in `@neopolitan-ai/testing/conformance` (capabilities, replay, `rawEvent` opt-in isolation, secret redaction, `afterSeq`, interrupt + `close()`).
- **Golden Fixture:** Replayed against versioned NDJSON transcripts in `tests/fixtures/*.jsonl`.
- **Live Handshake / Probe:** Exercised against local binaries via `NEOPOLITAN_LIVE_TESTS=1` using `probe()` and zero-cost `initialize` + `thread/start` or `session/new` handshakes (zero billed LLM turns).
:::
