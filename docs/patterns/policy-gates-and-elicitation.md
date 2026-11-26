# Pattern 02: Policy Gates, Disguised Elicitation & Workspace Boundaries

Autonomous coding agents fail unsafely in two classic ways: blindly approving disguised prompts inside permissive modes (`full_access`), or reading/writing symlinked files outside the repository root.

Neopolitan handles both fail-closed via `createPolicyGateMiddleware` (`@neopolitan-ai/core`) and `assertPathWithinWorkspace` (`@neopolitan-ai/adapter-acp`).

## Policy Evaluation Pipeline

<div class="neo-diagram">
  <svg viewBox="0 0 820 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GateMiddleware evaluation pipeline">
    <defs>
      <marker id="gate-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
      </marker>
    </defs>

    <rect x="20" y="42" width="185" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="112" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">1. Safety Override</text>
    <text x="112" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">kind === &apos;elicitation&apos; OR</text>
    <text x="112" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">isDisguisedElicitation</text>
    <text x="112" y="120" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--vp-c-brand-1)">Always Interactive</text>

    <line x1="205" y1="87" x2="233" y2="87" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#gate-arrow)" />

    <rect x="237" y="42" width="175" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="324" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">2. PolicyRule Match</text>
    <text x="324" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">category · toolPattern</text>
    <text x="324" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">commandPattern · pathGlob</text>
    <text x="324" y="120" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">allow (unless ruleForced) / deny / ask</text>

    <line x1="412" y1="87" x2="440" y2="87" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#gate-arrow)" />

    <rect x="444" y="42" width="180" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="534" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">3. PermissionMode</text>
    <text x="534" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">full_access (unless ruleForced)</text>
    <text x="534" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">auto_accept_edits (files/patch)</text>
    <text x="534" y="120" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">auto -&gt; async autoJudge()</text>

    <line x1="624" y1="87" x2="652" y2="87" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#gate-arrow)" />

    <rect x="656" y="42" width="144" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
    <text x="728" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">4. Interactive</text>
    <text x="728" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">User handler or</text>
    <text x="728" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">respondToGate()</text>
    <text x="728" y="120" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">RPC call</text>

    <text x="410" y="166" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">URL elicitations set personOnly: true so remote subagents cannot consent to OAuth flows on a user&apos;s behalf.</text>
  </svg>
</div>

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
