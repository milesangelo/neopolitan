# Session Persistence & Cross-Provider Handoff

`@neopolitan/sessions` persists normalized `AgentEvent` streams and coordinates seamless switching between providers.

## Durable `JsonlEventStore`
- Appends events per session using serialized write queues and `seq` deduplication.
- Recovers cleanly if the trailing line of `.events.jsonl` is truncated during an abrupt process crash.
- Supports `subscribe(sessionId, afterSeq)` for live + backlog cursor replay.

## Hybrid Handoff (`compileHandoffBundle` & `SessionManager.handoff`)
- **Same provider + workspace + auth profile:** Uses `native-resume` with the recorded `SessionAnchor` (Zero re-summarization).
- **Cross-provider or changed workspace:** Compiles a token-budgeted `compiled-prelude` from canonical assistant turns, tool completions, plan states, and optional `gitDiff`.
- **Automatic Secret Scrubbing:** All compiled summary, recent-turn, and git-diff sections pass through `redactSecrets()` before entering the target session's `contextPrelude`.

## CLI Equivalent

```bash
npx neopolitan handoff --store ./.sessions --session sess-1 --to codex --budget 8000
```
