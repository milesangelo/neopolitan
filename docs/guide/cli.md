# CLI Reference

The `neopolitan-ai` umbrella package ships a zero-dependency Node CLI (`node:util` `parseArgs`) exposed under both `neopolitan-ai` and `neopolitan` binary names.

## Commands Overview

| Command | Purpose | Exit Codes |
|---|---|---|
| `neopolitan-ai doctor` | Probe local CLIs, transport types, paths, and versions | `0` if OK (or all `--require` present); `1` if missing required provider |
| `neopolitan-ai run` | Execute a single streaming turn against a provider | `0` on turn completion; `1` on dispatch/turn failure or invalid args |
| `neopolitan-ai serve` | Start a headless HTTP+SSE & WebSocket `AgentRpcServer` | Graceful shutdown on `SIGINT` / `SIGTERM`; `1` on invalid port |
| `neopolitan-ai handoff` | Compile a cross-provider handoff packet from a `JsonlEventStore` | `0` with rendered Markdown or JSON; `1` if session missing |

---

## `doctor`

Probes every registered built-in driver (`claude-code`, `codex`, `opencode`, `antigravity`, `gemini`, `acp`, `pty`):

```bash
npx neopolitan-ai doctor [--json] [--require <provider>]...
```

| Flag | Description |
|---|---|
| `--json` | Emit structured JSON (`{ ok, missingRequired, providers }`) |
| `--require <id>` | Repeatable flag; exits `1` unless `<id>` probes `available: true` |

---

## `run`

Opens a single session and streams normalized output (or raw JSON lines):

```bash
npx neopolitan-ai run --provider <id> [--cwd <dir>] [--mode <mode>] [--raw] "<prompt>"
```

| Flag | Default | Description |
|---|---|---|
| `--provider <id>` | *(required)* | Registered provider ID (`claude-code`, `codex`, `opencode`, `antigravity`, `gemini`, `acp`, `pty`) |
| `--cwd <dir>` | `process.cwd()` | Working directory passed to `openSession` |
| `--mode <mode>` | `supervised` | Permission preset (`supervised`, `auto_accept_edits`, `auto`, `full_access`) |
| `--raw` | `false` | Emit serialized `AgentEvent` NDJSON including `rawEvent` payloads |

---

## `serve`

Launches `AgentRpcServer` backed by either `JsonlEventStore` (`--store`) or `InMemoryEventStore`:

```bash
npx neopolitan-ai serve [--host 127.0.0.1] [--port 7420] [--token <secret>] [--store <dir>]
```

Outputs a single JSON startup line `{ url, wsUrl, port }` so parent orchestrators can discover dynamically bound ports cleanly.

---

## `handoff`

Reads a persisted session snapshot and `.events.jsonl` log from disk, redacts secrets via `redactSecrets()`, and renders either a `native-resume` anchor or a token-budgeted `compiled-prelude`:

```bash
npx neopolitan-ai handoff --store <dir> --session <id> --to <provider> [--cwd <dir>] [--budget <tokens>] [--json]
```
