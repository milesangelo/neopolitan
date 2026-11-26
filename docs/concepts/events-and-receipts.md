# Canonical Events & Receipts

Every adapter translates provider-specific wire protocols (`stream-json`, Codex JSON-RPC, ACP notifications, PTY + HTTP hooks) into one strongly typed `AgentEvent` union and strict dispatch acknowledgement contract.

## `AgentEvent` Union Taxonomy

All events share `AgentEventBase`: `{ eventId, seq, sessionId, turnId?, parentBlockId?, timestamp, rawEvent? }`.

| Category | Event Types | Key Guarantees |
|---|---|---|
| **Session Lifecycle** | `session.started`, `session.status`, `session.ended` | `session.started` carries resolved `anchor` and session-level `capabilities`; `session.ended` distinguishes `requested`, `unexpected_exit` (+ `exitCode`), and `idle_timeout` |
| **Turn Lifecycle** | `turn.started`, `turn.completed` | `turn.completed` reports `status`, `disposition` (`'identified'` \| `'ambiguous'`), `threadDisposition` (`'reusable'` \| `'broken'`), sanitized `failure`, and `usage` |
| **Assistant & Reasoning** | `assistant.delta`, `assistant.completed`, `reasoning.delta`, `reasoning.completed` | Deltas carry `blockId` and optional `phase` (`'commentary'` \| `'partial_answer'` \| `'final_answer'`) for incremental UI rendering |
| **Tools, Diffs & Plans** | `tool.started`, `tool.output`, `tool.completed`, `file.diff`, `plan.updated` | `tool.output` may mark `ephemeral: true` so infinite terminal logs stream live without filling replay buffers |
| **Gates & Control** | `gate.requested`, `gate.resolved`, `subagent.updated`, `compaction.updated`, `usage.updated`, `auth.required` | `gate.requested` / `gate.resolved` correlate via `requestId` without blocking the turn RPC channel |
| **History & Notices** | `history.reset`, `notice` | `history.reset` signals thread replay or rewind (`TurnItemAccumulator` resets prior blocks cleanly) |

::: warning Raw Events Are Opt-In
`rawEvent` is stripped by `EventHub.subscribe()` unless the subscriber passes `{ includeRaw: true }`. This prevents internal provider objects, SDK frames, or oversized diagnostics from leaking into logs or UI clients by default.
:::

## `EventHub` & Non-Ephemeral Replay

<NeoDiagram name="events" />

## 4-Outcome `DispatchReceipt`

Calling `session.sendTurn()` resolves immediately once dispatch settles rather than blocking for minutes until the model finishes:

| `outcome` | Meaning | Caller Action |
|---|---|---|
| `accepted` | Provider RPC explicitly confirmed turn creation (`providerTurnId` may be present) | Track `turnId` through `turn.completed` |
| `admitted` | Turn input was written to transport (e.g., interactive PTY stdin) without a synchronous turn ACK | Correlate completion via status hooks / `OSC 7501` |
| `rejected` | Input was never accepted (e.g., closed session or immediate validation failure) | Surface sanitized `reason` / `code` safely |
| `unknown` | Connection dropped mid-dispatch; provider state is uncertain | Never silently resend non-idempotent turns; verify or prompt user |

## Monotonic Interview Settlement (`applyInterviewSettlement`)

When multiple sources can race to resolve a user elicitation (GUI interaction vs runtime timeout/error), `applyInterviewSettlement` enforces strict state transitions:
- `source: 'gui'` beats `'runtime'`.
- `'failed'` never overwrites an already `'answered'` or `'skipped'` settlement.
- `'delivered'` delivery state is absorbing.
