import { execFile as execFileCb, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type WorktreeCleanupTier =
  | 'in-use'
  | 'review'
  | 'orphaned'
  | 'merged'
  | 'at-base-commit'
  | 'unreferenced';

export interface WorktreeTierInput {
  readonly isInUse: boolean;
  readonly isDirty: boolean;
  readonly isDetached: boolean;
  readonly gitUnreadable: boolean;
  readonly hasUnmergedCommits: boolean;
  readonly isOrphaned: boolean;
  readonly isMergedIntoDefault: boolean;
  readonly isAtBaseCommit: boolean;
}

/**
 * Shared pure safety classifier (ported from Traycer's `classifyWorktreeTier`):
 * guarantees dirty, detached, unreadable, or unmerged worktrees are never auto-deleted.
 */
export function classifyWorktreeTier(input: WorktreeTierInput): WorktreeCleanupTier {
  if (input.isInUse) return 'in-use';
  if (input.gitUnreadable || input.isDirty || input.isDetached || input.hasUnmergedCommits) {
    return 'review';
  }
  if (input.isOrphaned) return 'orphaned';
  if (input.isMergedIntoDefault) return 'merged';
  if (input.isAtBaseCommit) return 'at-base-commit';
  return 'unreferenced';
}

export interface RepoSpec {
  readonly repoId: string;
  readonly repoRoot: string;
  readonly branch: string;
  readonly baseRef?: string;
}

export interface WorktreeRepoMount {
  readonly repoId: string;
  readonly repoRoot: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly baseCommit: string;
}

export interface WorktreeHandle {
  readonly workspaceDir: string;
  readonly repos: ReadonlyArray<WorktreeRepoMount>;
}

export interface WorkspaceDiff {
  readonly patch: string;
  readonly truncated: boolean;
  readonly changedFiles: ReadonlyArray<string>;
}

export interface InstructionFile {
  readonly path: string;
  readonly kind: 'AGENTS.md' | 'CLAUDE.md' | 'selection-guide';
  readonly content: string;
}

export interface DevServerHandle {
  readonly pid?: number;
  stop(): Promise<void>;
}

async function git(cwd: string, args: ReadonlyArray<string>): Promise<string> {
  const { stdout } = await execFile('git', [...args], { cwd });
  return stdout.trim();
}

export class GitWorkspaceManager {
  private readonly locks = new Map<string, Promise<void>>();

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(key, prev.then(() => gate));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Creates isolated Git worktrees for 1 or more repos under `workspaceDir`, optionally
   * symlinking validated gitignored `sharedDirectories` (Orca `orca.yaml` safety rule).
   */
  async prepareWorktree(input: {
    readonly workspaceDir: string;
    readonly repos: ReadonlyArray<RepoSpec>;
    readonly sharedDirectories?: ReadonlyArray<string>;
  }): Promise<WorktreeHandle> {
    await fs.mkdir(input.workspaceDir, { recursive: true });
    const mounts: WorktreeRepoMount[] = [];

    for (const repo of input.repos) {
      const mountPath =
        input.repos.length === 1
          ? input.workspaceDir
          : path.join(input.workspaceDir, path.basename(repo.repoRoot));

      await this.withLock(repo.repoRoot, async () => {
        const baseRef = repo.baseRef ?? 'HEAD';
        const baseCommit = await git(repo.repoRoot, ['rev-parse', baseRef]);
        await git(repo.repoRoot, [
          'worktree',
          'add',
          '--no-track',
          '-b',
          repo.branch,
          mountPath,
          baseRef,
        ]);

        if (input.sharedDirectories) {
          for (const rel of input.sharedDirectories) {
            if (rel === '.' || rel === '..' || rel === '.git' || path.isAbsolute(rel)) {
              throw new Error(`Invalid sharedDirectory "${rel}"`);
            }
            const sourceDir = path.join(repo.repoRoot, rel);
            const targetDir = path.join(mountPath, rel);
            // Enforce gitignore check before symlinking
            let ignored = false;
            try {
              await git(repo.repoRoot, ['check-ignore', '-q', rel]);
              ignored = true;
            } catch {
              ignored = false;
            }
            if (!ignored) {
              throw new Error(`sharedDirectory "${rel}" must be gitignored before symlinking`);
            }
            await fs.mkdir(path.dirname(targetDir), { recursive: true });
            await fs.symlink(sourceDir, targetDir, 'dir');
          }
        }

        mounts.push({
          repoId: repo.repoId,
          repoRoot: repo.repoRoot,
          worktreePath: mountPath,
          branch: repo.branch,
          baseCommit,
        });
      });
    }

    return { workspaceDir: input.workspaceDir, repos: mounts };
  }

  async snapshotHeads(handle: WorktreeHandle): Promise<Record<string, string>> {
    const heads: Record<string, string> = {};
    for (const repo of handle.repos) {
      heads[repo.repoId] = await git(repo.worktreePath, ['rev-parse', 'HEAD']);
    }
    return heads;
  }

  async inspectWorktreeTier(
    worktreePath: string,
    options?: { readonly isInUse?: boolean; readonly baseCommit?: string; readonly defaultBranch?: string },
  ): Promise<WorktreeCleanupTier> {
    try {
      const status = await git(worktreePath, ['status', '--porcelain']);
      const head = await git(worktreePath, ['rev-parse', 'HEAD']);
      let isDetached = false;
      try {
        await git(worktreePath, ['symbolic-ref', '-q', 'HEAD']);
      } catch {
        isDetached = true;
      }
      const isAtBaseCommit = options?.baseCommit ? head === options.baseCommit : false;
      const defaultRef = options?.defaultBranch ?? 'main';
      let isMergedIntoDefault = false;
      let hasUnmergedCommits = false;
      if (options?.baseCommit && head !== options.baseCommit) {
        try {
          await git(worktreePath, ['merge-base', '--is-ancestor', head, defaultRef]);
          isMergedIntoDefault = true;
        } catch {
          hasUnmergedCommits = true;
        }
      }
      return classifyWorktreeTier({
        isInUse: options?.isInUse ?? false,
        isDirty: status.length > 0,
        isDetached,
        gitUnreadable: false,
        hasUnmergedCommits,
        isOrphaned: false,
        isMergedIntoDefault,
        isAtBaseCommit,
      });
    } catch {
      return classifyWorktreeTier({
        isInUse: options?.isInUse ?? false,
        isDirty: false,
        isDetached: false,
        gitUnreadable: true,
        hasUnmergedCommits: false,
        isOrphaned: false,
        isMergedIntoDefault: false,
        isAtBaseCommit: false,
      });
    }
  }

  async discoverInstructions(cwd: string): Promise<ReadonlyArray<InstructionFile>> {
    const candidates: Array<{ file: string; kind: InstructionFile['kind'] }> = [
      { file: path.join(cwd, 'AGENTS.md'), kind: 'AGENTS.md' },
      { file: path.join(cwd, 'CLAUDE.md'), kind: 'CLAUDE.md' },
      { file: path.join(cwd, '.traycer', 'agent-selection-guide.md'), kind: 'selection-guide' },
    ];
    const found: InstructionFile[] = [];
    for (const c of candidates) {
      try {
        const content = await fs.readFile(c.file, 'utf8');
        found.push({ path: c.file, kind: c.kind, content });
      } catch {
        // ignore missing
      }
    }
    return found;
  }

  async getDiff(
    cwd: string,
    options?: { readonly baseRef?: string; readonly maxBytes?: number },
  ): Promise<WorkspaceDiff> {
    const base = options?.baseRef ?? 'HEAD';
    const maxBytes = options?.maxBytes ?? 1_000_000;
    const filesRaw = await git(cwd, ['diff', '--name-only', base]);
    const changedFiles = filesRaw ? filesRaw.split('\n').filter(Boolean) : [];
    const patch = await git(cwd, ['diff', base]);
    const truncated = Buffer.byteLength(patch, 'utf8') > maxBytes;
    return {
      patch: truncated ? patch.slice(0, maxBytes) : patch,
      truncated,
      changedFiles,
    };
  }

  /**
   * Spawns an isolated dev/preview server outside agent stop & finalization locks
   * (Vibe-Kanban `ExecutionProcessRunReason::DevServer` pattern).
   */
  async startDevServer(input: {
    readonly cwd: string;
    readonly command: string;
    readonly args?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
  }): Promise<DevServerHandle> {
    const child = spawn(input.command, [...(input.args ?? [])], {
      cwd: input.cwd,
      env: { ...process.env, ...(input.env ?? {}) },
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });

    return {
      pid: child.pid,
      async stop() {
        if (child.exitCode !== null || !child.pid) return;
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
        } catch {
          // ignore
        }
      },
    };
  }

  async cleanupWorktree(
    handle: WorktreeHandle,
    options?: { readonly force?: boolean },
  ): Promise<void> {
    for (const repo of handle.repos) {
      await this.withLock(repo.repoRoot, async () => {
        const args = ['worktree', 'remove'];
        if (options?.force) args.push('--force');
        args.push(repo.worktreePath);
        await git(repo.repoRoot, args);
      });
    }
  }
}
