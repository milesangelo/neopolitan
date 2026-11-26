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

<div class="neo-diagram">
  <svg viewBox="0 0 820 175" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EventHub sequence and afterSeq replay">
    <defs>
      <marker id="ev-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
      </marker>
    </defs>

    <rect x="20" y="28" width="215" height="96" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="127" y="54" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">hub.emit(event)</text>
    <text x="127" y="74" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Assigns monotonic seq (1, 2, 3...)</text>
    <text x="127" y="92" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Buffers unless ephemeral: true</text>
    <text x="127" y="110" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Pushes live to active iterators</text>

    <line x1="235" y1="76" x2="285" y2="76" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#ev-arrow)" />

    <rect x="289" y="28" width="235" height="96" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="2" />
    <text x="406" y="54" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Replay Ring Buffer (2,048)</text>
    <text x="406" y="74" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Startup session.started never lost</text>
    <text x="406" y="92" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Late subscribe({ afterSeq })</text>
    <text x="406" y="110" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">replays seq &gt; afterSeq in order</text>

    <line x1="524" y1="76" x2="574" y2="76" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#ev-arrow)" />

    <rect x="578" y="28" width="222" height="96" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
    <text x="689" y="54" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">TurnItemAccumulator</text>
    <text x="689" y="74" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Deterministic UI block state:</text>
    <text x="689" y="92" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">text · reasoning · tool_call</text>
    <text x="689" y="110" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">file_diff · plan · gate</text>

    <text x="410" y="154" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Strict ordering and afterSeq deduplication are verified by @neopolitan-ai/testing/conformance.</text>
  </svg>
</div>

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
