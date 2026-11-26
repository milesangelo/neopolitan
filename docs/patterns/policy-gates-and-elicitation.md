# Pattern 02: Policy Gates, Disguised Elicitation & Workspace Boundaries

Autonomous coding agents fail unsafely in two classic ways: blindly approving disguised prompts inside permissive modes (`full_access`), or reading/writing symlinked files outside the repository root.

Neopolitan handles both fail-closed via `createPolicyGateMiddleware` (`@neopolitan-ai/core`) and `assertPathWithinWorkspace` (`@neopolitan-ai/adapter-acp`).

## Policy Evaluation Pipeline

<NeoDiagram name="gates" />

## Pattern Implementation (`02-acp-client-and-gates.ts`)

```ts
import { createPolicyGateMiddleware } from '@neopolitan-ai/core';
import {
  antigravityFlavor,
  assertPathWithinWorkspace,
  createAcpDriver,
} from '@neopolitan-ai/adapter-acp';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';

const runtime = new LocalExecutionRuntime({ defaultCwd: workspaceDir });

// Throws before reading/writing outside workspaceDir (including symlinks, ~, file://, NUL bytes)
await assertPathWithinWorkspace(runtime, workspaceDir, 'src/index.ts');

const gateMiddleware = createPolicyGateMiddleware({
  rules: [
    { id: 'allow-reads', match: { category: 'file_read' }, action: 'allow' },
    {
      id: 'deny-rm',
      match: { toolPattern: 'rm -rf*' },
      action: 'deny',
      reason: 'Destructive rm blocked',
    },
  ],
});

const driver = createAcpDriver({
  id: 'antigravity',
  flavor: antigravityFlavor,
  command: 'agy',
  args: ['acp'],
});

const adapter = await driver.createAdapter(
  {},
  {
    runtime,
    gateMiddleware,
    interactiveGateHandler: async (req) => {
      // Even in full_access mode, `interaction_*` disguised questions route here!
      return { decision: 'allow_once', source: 'user' };
    },
  },
);

await using session = await adapter.openSession({
  cwd: workspaceDir,
  permissionMode: 'full_access',
});
```

::: warning Pattern Matching Scope
`toolPattern` and `commandPattern` match `*` across `/` characters (so `toolPattern: 'rm -rf*'` blocks `'rm -rf /tmp/prod'`), while `pathGlob` treats single `*` as path-segment-aware (`[^/]*`) and `**` as cross-directory (`.*`).
:::

See runnable source: [`examples/src/02-acp-client-and-gates.ts`](https://github.com/milesangelo/neopolitan/blob/main/examples/src/02-acp-client-and-gates.ts).
