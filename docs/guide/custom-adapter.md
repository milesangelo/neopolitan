# Custom Adapter Authoring & Conformance

Any third-party coding agent CLI or HTTP runtime can plug into Neopolitan by implementing `ProviderDriver`, `ProviderAdapter`, and `AgentSession` from `@neopolitan/core`.

## Step 1: Implement `ProviderDriver`

```ts
import { z } from 'zod';
import {
  EventHub,
  type AgentSession,
  type OpenSessionInput,
  type ProviderCapabilities,
  type ProviderDriver,
} from '@neopolitan/core';

export const MY_CAPABILITIES: ProviderCapabilities = {
  transport: 'http',
  sessions: { resume: false, fork: 'none', rollback: false, switchModelInSession: false, switchPermissionModeInSession: false, survivesProcessRestart: false },
  turns: { interrupt: true, steering: 'none', queuedMessages: false, terminalStatusQuality: 'strong' },
  streaming: { assistantDeltas: true, reasoningDeltas: false, toolLifecycle: true, toolOutputDeltas: false, planUpdates: false, fileDiffs: false },
  gating: { commandApproval: false, fileChangeApproval: false, structuredElicitation: false, urlElicitation: false, enforcement: 'none' },
  context: { systemPrompt: true, contextPrelude: true, compact: false, mcpServers: [], imageAttachments: false },
  subagents: { supported: false, lifecycleEvents: false, stoppable: false },
};
```

## Step 2: Run the Shared Conformance Suite

Wire `runProviderConformanceSuite` from `@neopolitan/testing/conformance` inside your adapter's `.test.ts` file:

```ts
import { runProviderConformanceSuite } from '@neopolitan/testing/conformance';

runProviderConformanceSuite('MyCustomAdapter', async () => {
  return {
    openSession: async (input) => createMySession(input),
    triggerGatePrompt: 'Run shell check',
    triggerSecretFailurePrompt: 'Trigger auth error',
    triggerUnknownOutcomePrompt: 'Trigger transport drop',
  };
});
```

Passing `runProviderConformanceSuite` guarantees capability schema validity, startup event buffering, `rawEvent` opt-in isolation, secret redaction, monotonic `seq` + `afterSeq` replay, `'unknown'` dispatch semantics, and clean `AsyncDisposable` teardown.
