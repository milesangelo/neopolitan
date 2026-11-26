# Pattern 04: Isolated Worktrees & Structured Review

Running multiple coding agents against one shared checkout causes index lock contention (`index.lock`) and dirty-tree collisions. At the same time, auto-cleaning ephemeral worktrees without checking git state risks wiping unmerged work.

`@neopolitan-ai/workspace` gives you multi-repo Git worktrees (`GitWorkspaceManager`), `AGENTS.md` / `CLAUDE.md` discovery, structured `ReviewTarget` formatting, preview `DevServerHandle`s, and a 6-tier cleanup safety classifier.

## 6-Tier Cleanup Classifier (`classifyWorktreeTier`)

<NeoDiagram name="worktrees" />

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
