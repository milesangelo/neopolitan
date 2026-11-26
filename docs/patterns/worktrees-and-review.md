# Pattern 04: Isolated Worktrees & Structured Review

Running multiple coding agents against one shared checkout causes index lock contention (`index.lock`) and dirty-tree collisions. At the same time, auto-cleaning ephemeral worktrees without checking git state risks wiping unmerged work.

`@neopolitan-ai/workspace` gives you multi-repo Git worktrees (`GitWorkspaceManager`), `AGENTS.md` / `CLAUDE.md` discovery, structured `ReviewTarget` formatting, preview `DevServerHandle`s, and a 6-tier cleanup safety classifier.

## 6-Tier Cleanup Classifier (`classifyWorktreeTier`)

<div class="neo-diagram">
  <svg viewBox="0 0 820 155" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="6-tier worktree safety classification">
    <rect x="20" y="24" width="122" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="81" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">in-use</text>
    <text x="81" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Active session</text>
    <text x="81" y="85" text-anchor="middle" font-size="10.5" fill="#E14B6A">Never delete</text>

    <rect x="154" y="24" width="142" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
    <text x="225" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">review</text>
    <text x="225" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Dirty / detached / unmerged</text>
    <text x="225" y="85" text-anchor="middle" font-size="10.5" fill="#E14B6A">Never auto-delete</text>

    <rect x="308" y="24" width="118" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="367" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">orphaned</text>
    <text x="367" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Clean &amp; detached</text>
    <text x="367" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">from task</text>

    <rect x="438" y="24" width="114" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
    <text x="495" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">merged</text>
    <text x="495" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Clean &amp; merged</text>
    <text x="495" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Safe to prune</text>

    <rect x="564" y="24" width="120" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
    <text x="624" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">at-base-commit</text>
    <text x="624" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">No new commits</text>
    <text x="624" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Safe to prune</text>

    <rect x="696" y="24" width="106" height="72" rx="8" fill="var(--vp-c-bg)" stroke="var(--vp-c-divider)" stroke-width="1.5" />
    <text x="749" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">unreferenced</text>
    <text x="749" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Fallback</text>
    <text x="749" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Prune w/ policy</text>

    <text x="410" y="130" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">GitWorkspaceManager serializes per-repo git worktree mutations with internal locking so parallel agents never race.</text>
  </svg>
</div>

## Multi-Repo Worktree & Structured Review (`04-isolated-worktree-review.ts`)

```ts
import { type ReviewTarget, formatReviewTargetPrompt } from '@neopolitan-ai/core';
import { GitWorkspaceManager } from '@neopolitan-ai/workspace';

const workspace = new GitWorkspaceManager();

const handle = await workspace.prepareWorktree({
  workspaceDir: '/tmp/wt-feat-review',
  repos: [{ repoId: 'app', repoRoot: '/repos/app', branch: 'feat/review-demo' }],
});

const instructions = await workspace.discoverInstructions(handle.workspaceDir);
const heads = await workspace.snapshotHeads(handle);
const diff = await workspace.getDiff(handle.workspaceDir);
const tier = await workspace.inspectWorktreeTier(handle.workspaceDir, {
  baseCommit: handle.repos[0]!.baseCommit,
  defaultBranch: 'main',
});

// Format inline code comments for non-Codex adapters (or pass ReviewTarget to Codex reviewStart)
const reviewPrompt = formatReviewTargetPrompt({
  repos: [{ repoId: 'app', name: 'app', baseCommit: heads.app! }],
  comments: [
    {
      filePath: 'src.ts',
      lineNumber: 2,
      side: 'right',
      text: 'Add JSDoc comment for exported helper.',
      codeLine: 'export const sub = (a: number, b: number) => a - b;',
    },
  ],
  instructions: 'Verify edge cases and formatting.',
} satisfies ReviewTarget);

// Run preview servers outside agent locks
const devServer = await workspace.startDevServer({
  cwd: handle.workspaceDir,
  command: 'pnpm',
  args: ['dev'],
});
// ... later ...
await devServer.stop();
await workspace.cleanupWorktree(handle, { force: tier !== 'review' });
```

See runnable source: [`examples/src/04-isolated-worktree-review.ts`](https://github.com/milesangelo/neopolitan/blob/main/examples/src/04-isolated-worktree-review.ts).
