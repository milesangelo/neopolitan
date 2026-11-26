# Pattern 06: Custom Adapters, Wire Fixtures & Conformance Testing

Any custom coding agent CLI, HTTP daemon, or remote sandbox runtime integrates cleanly with Neopolitan by implementing `ProviderDriver`, `ProviderAdapter`, and `AgentSession` from `@neopolitan-ai/core`.

## Step 1: Implement `ProviderDriver` & `AgentSession`

Use `EventHub` for automatic monotonic `seq` assignment and late-subscriber replay, `createLfNdjsonFramer` if parsing LF-delimited JSON without Node's `U+2028`/`U+2029` split bug, and `classifyProviderFailure` before emitting failure events:

```ts
import { z } from 'zod';
import {
  EventHub,
  type AgentSession,
  type OpenSessionInput,
  type ProviderCapabilities,
  type ProviderDriver,
} from '@neopolitan-ai/core';

export const CUSTOM_CAPABILITIES: ProviderCapabilities = {
  transport: 'http-sse',
  sessions: {
    resume: false,
    fork: 'none',
    rollback: false,
    switchModelInSession: false,
    switchPermissionModeInSession: false,
    survivesProcessRestart: false,
  },
  turns: { interrupt: true, steering: 'none', queuedMessages: false, terminalStatusQuality: 'strong' },
  streaming: {
    assistantDeltas: true,
    reasoningDeltas: false,
    toolLifecycle: true,
    toolOutputDeltas: false,
    planUpdates: false,
    fileDiffs: false,
  },
  gating: {
    commandApproval: false,
    fileChangeApproval: false,
    structuredElicitation: false,
    urlElicitation: false,
    enforcement: 'client-boundary',
  },
  context: {
    systemPrompt: true,
    contextPrelude: true,
    compact: false,
    mcpServers: [],
    imageAttachments: false,
  },
  subagents: { supported: false, lifecycleEvents: false, stoppable: false },
};
```

## Step 2: Run the Shared Conformance Suite

Wire `runProviderConformanceSuite` from `@neopolitan-ai/testing/conformance` inside your adapter test suite (`vitest`):

```ts
import { runProviderConformanceSuite } from '@neopolitan-ai/testing/conformance';

runProviderConformanceSuite('MyCustomAdapter', async () => {
  return {
    openSession: async (input) => createMySession(input),
    triggerGatePrompt: 'Run shell check',
    triggerSecretFailurePrompt: 'Trigger auth error',
    triggerUnknownOutcomePrompt: 'Trigger transport drop',
  };
});
```

`runProviderConformanceSuite` enforces 7 invariants automatically:
1. Valid Zod `providerCapabilitiesSchema` compliance and startup `session.started` buffering.
2. Turn completion + `rawEvent` opt-in isolation (`includeRaw: false` omits raw payloads).
3. Interactive gate approval and deny-with-feedback behavior.
4. Secret redaction in sanitized failure events (`sk-ant-*` -> `[REDACTED...]`).
5. Clean `interruptTurn()` and stream termination on `close()`.
6. Strictly monotonic `seq` ordering and deterministic `afterSeq` non-ephemeral replay.
7. `'unknown'` `DispatchReceipt` reporting on ambiguous disconnect.

## Step 3: Add Golden Wire-Transcript Fixtures

Add a sanitized NDJSON transcript under `tests/fixtures/` (modeling noise lines, malformed trailing output, approvals, usage merges, and flavor-specific edge cases) and test deterministic normalization in CI without making billed LLM API calls.
