import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type ReviewTarget, formatReviewTargetPrompt } from '@neopolitan-ai/core';
import { GitWorkspaceManager } from '@neopolitan-ai/workspace';

const execFile = promisify(execFileCb);

async function main(): Promise<void> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-ex4-'));
  const repoRoot = path.join(baseDir, 'repo');
  const worktreeDir = path.join(baseDir, 'worktrees', 'feat-review');

  try {
    // Initialize a temporary git repo with AGENTS.md
    await fs.mkdir(repoRoot, { recursive: true });
    await execFile('git', ['init', '-b', 'main'], { cwd: repoRoot });
    await execFile('git', ['config', 'user.email', 'dev@example.com'], { cwd: repoRoot });
    await execFile('git', ['config', 'user.name', 'Dev'], { cwd: repoRoot });
    await fs.writeFile(
      path.join(repoRoot, 'AGENTS.md'),
      '# Project Rules\nRun pnpm test.\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoRoot, 'src.ts'),
      'export const add = (a: number, b: number) => a + b;\n',
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoRoot });
    await execFile('git', ['commit', '-m', 'Initial commit'], { cwd: repoRoot });

    const workspace = new GitWorkspaceManager();
    const handle = await workspace.prepareWorktree({
      workspaceDir: worktreeDir,
      repos: [{ repoId: 'app', repoRoot, branch: 'feat/review-demo' }],
    });

    const instructions = await workspace.discoverInstructions(worktreeDir);
    console.log(
      '[1] Discovered instructions:',
      instructions.map((i) => i.kind),
    );

    const heads = await workspace.snapshotHeads(handle);
    console.log('[2] Snapshot head commit:', heads.app);

    // Simulate an agent editing a file inside the isolated worktree
    await fs.writeFile(
      path.join(worktreeDir, 'src.ts'),
      'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n',
      'utf8',
    );

    const diff = await workspace.getDiff(worktreeDir);
    const tier = await workspace.inspectWorktreeTier(worktreeDir, {
      baseCommit: handle.repos[0]!.baseCommit,
      defaultBranch: 'main',
    });
    console.log('[3] Changed files:', diff.changedFiles, 'cleanup tier:', tier);

    const reviewTarget: ReviewTarget = {
      repos: [{ repoId: 'app', name: 'app', baseCommit: handle.repos[0]!.baseCommit }],
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
    };
    console.log(`[4] Formatted ReviewTarget prompt:\n${formatReviewTargetPrompt(reviewTarget)}`);

    // Start & stop an isolated preview dev server outside agent locks
    const devServer = await workspace.startDevServer({
      cwd: worktreeDir,
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
    });
    console.log('[5] Isolated dev server pid:', devServer.pid);
    await devServer.stop();
    await workspace.cleanupWorktree(handle, { force: true });
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
}

await main();
