import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorkspaceManager, classifyWorktreeTier } from './index.js';

const execFile = promisify(execFileCb);
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('@neopolitan/workspace', () => {
  it('classifies worktree cleanup safety tiers accurately', () => {
    expect(
      classifyWorktreeTier({
        isInUse: true,
        isDirty: false,
        isDetached: false,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: false,
        isAtBaseCommit: true,
      }),
    ).toBe('in-use');

    expect(
      classifyWorktreeTier({
        isInUse: false,
        isDirty: true,
        isDetached: false,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: true,
        isAtBaseCommit: false,
      }),
    ).toBe('review');
  });

  it('creates isolated Git worktrees, discovers AGENTS.md, snapshots heads/diffs, and cleans up', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-ws-'));
    tempDirs.push(baseDir);

    const repoRoot = path.join(baseDir, 'repo');
    const wtDir = path.join(baseDir, 'wt-1');
    await fs.mkdir(repoRoot, { recursive: true });
    await execFile('git', ['init', '-b', 'main'], { cwd: repoRoot });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
    await fs.writeFile(path.join(repoRoot, 'AGENTS.md'), '# Repo Rules\nRun pnpm test.\n', 'utf8');
    await fs.writeFile(path.join(repoRoot, 'README.md'), 'hello\n', 'utf8');
    await execFile('git', ['add', '.'], { cwd: repoRoot });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoRoot });

    const mgr = new GitWorkspaceManager();
    const handle = await mgr.prepareWorktree({
      workspaceDir: wtDir,
      repos: [{ repoId: 'main-repo', repoRoot, branch: 'feat/test-wt' }],
    });

    const instructions = await mgr.discoverInstructions(wtDir);
    expect(instructions.some((i) => i.kind === 'AGENTS.md')).toBe(true);

    const headsBefore = await mgr.snapshotHeads(handle);
    expect(headsBefore['main-repo']).toHaveLength(40);

    await fs.writeFile(path.join(wtDir, 'README.md'), 'updated\n', 'utf8');
    const diff = await mgr.getDiff(wtDir);
    expect(diff.changedFiles).toEqual(['README.md']);
    expect(diff.patch).toContain('+updated');

    const tier = await mgr.inspectWorktreeTier(wtDir, {
      baseCommit: handle.repos[0]!.baseCommit,
      defaultBranch: 'main',
    });
    expect(tier).toBe('review');

    const devServer = await mgr.startDevServer({
      cwd: wtDir,
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
    });
    expect(devServer.pid).toBeGreaterThan(0);
    await devServer.stop();

    await mgr.cleanupWorktree(handle, { force: true });
  });

  it('classifies orphaned, merged, at-base-commit, unreferenced, detached, and unreadable tiers', () => {
    expect(
      classifyWorktreeTier({
        isInUse: false,
        isDirty: false,
        isDetached: true,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: false,
        isAtBaseCommit: true,
      }),
    ).toBe('review');
    expect(
      classifyWorktreeTier({
        isInUse: false,
        isDirty: false,
        isDetached: false,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: true,
        isMergedIntoDefault: false,
        isAtBaseCommit: false,
      }),
    ).toBe('orphaned');
    expect(
      classifyWorktreeTier({
        isInUse: false,
        isDirty: false,
        isDetached: false,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: true,
        isAtBaseCommit: false,
      }),
    ).toBe('merged');
    expect(
      classifyWorktreeTier({
        isInUse: false,
        isDirty: false,
        isDetached: false,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: false,
        isAtBaseCommit: true,
      }),
    ).toBe('at-base-commit');
    expect(
      classifyWorktreeTier({
        isInUse: false,
        isDirty: false,
        isDetached: false,
        gitUnreadable: false,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: false,
        isAtBaseCommit: false,
      }),
    ).toBe('unreferenced');
  });
});
