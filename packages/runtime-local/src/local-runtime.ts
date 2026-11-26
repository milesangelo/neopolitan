import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import type {
  ExecutionRuntime,
  ManagedProcess,
  ProcessExitResult,
  SpawnSpec,
} from '@neopolitan/core';
import { BoundedStderrTail, killProcessTree, stripAgentSessionEnv } from './process-tree.js';

export interface LocalExecutionRuntimeOptions {
  readonly id?: string;
  readonly defaultCwd?: string;
  readonly stderrTailBytes?: number;
}

export function wrapChildProcess(
  child: ChildProcessWithoutNullStreams,
  options?: { readonly stderrTailBytes?: number; readonly signal?: AbortSignal },
): ManagedProcess {
  const stderrTail = new BoundedStderrTail(options?.stderrTailBytes ?? 8 * 1024);

  const exited = new Promise<ProcessExitResult>((resolve, reject) => {
    child.once('error', (err) => reject(err));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  // Web ReadableStream backed by child.stderr that always feeds stderrTail
  const stderrWeb = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stderr.on('data', (chunk: Buffer) => {
        const bytes = new Uint8Array(chunk);
        stderrTail.push(bytes);
        try {
          controller.enqueue(bytes);
        } catch {
          // consumer cancelled
        }
      });
      child.stderr.once('end', () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      child.stderr.once('error', (err) => {
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      });
    },
  });

  const stdoutWeb = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
  const stdinWeb = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>;

  const abortListener = () => {
    void killProcessTree(child);
  };
  if (options?.signal) {
    if (options.signal.aborted) {
      void killProcessTree(child);
    } else {
      options.signal.addEventListener('abort', abortListener, { once: true });
      void exited.finally(() => options.signal?.removeEventListener('abort', abortListener));
    }
  }

  return {
    pid: child.pid,
    stdin: stdinWeb,
    stdout: stdoutWeb,
    stderr: stderrWeb,
    exited,
    getStderrTail: () => stderrTail.readRedacted(),
    killTree: (graceMs) => killProcessTree(child, graceMs),
  };
}

export class LocalExecutionRuntime implements ExecutionRuntime {
  readonly id: string;
  readonly platform = process.platform as 'darwin' | 'linux' | 'win32';
  readonly kind = 'local' as const;
  readonly defaultCwd: string;
  private readonly stderrTailBytes: number;

  constructor(options?: LocalExecutionRuntimeOptions) {
    this.id = options?.id ?? 'local';
    this.defaultCwd = options?.defaultCwd ?? process.cwd();
    this.stderrTailBytes = options?.stderrTailBytes ?? 8 * 1024;
  }

  async spawn(spec: SpawnSpec, signal?: AbortSignal): Promise<ManagedProcess> {
    if (signal?.aborted) {
      throw new Error('Aborted before spawn');
    }
    const env = stripAgentSessionEnv(process.env, spec.env);
    const child = nodeSpawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    if (spec.timeoutMs && spec.timeoutMs > 0) {
      const timer = setTimeout(() => {
        void killProcessTree(child);
      }, spec.timeoutMs);
      timer.unref?.();
      child.once('close', () => clearTimeout(timer));
    }

    return wrapChildProcess(child, { stderrTailBytes: this.stderrTailBytes, signal });
  }

  async which(command: string, env?: Readonly<Record<string, string>>): Promise<string | null> {
    if (path.isAbsolute(command)) {
      return (await this.exists(command)) ? command : null;
    }
    const pathEnv = env?.PATH ?? process.env.PATH ?? '';
    const dirs = pathEnv.split(path.delimiter).filter(Boolean);
    const exts =
      process.platform === 'win32'
        ? (env?.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
        : [''];

    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, `${command}${ext}`);
        try {
          const st = await fs.stat(candidate);
          if (st.isFile()) return candidate;
        } catch {
          // continue
        }
      }
    }
    return null;
  }

  realpath(targetPath: string): Promise<string> {
    return fs.realpath(targetPath);
  }

  async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void> {
    await fs.mkdir(targetPath, { recursive: options?.recursive ?? true });
  }

  async readdir(
    targetPath: string,
  ): Promise<ReadonlyArray<{ readonly name: string; readonly isDirectory: boolean }>> {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  readFile(targetPath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    return fs.readFile(targetPath, { encoding });
  }

  writeFile(targetPath: string, content: string): Promise<void> {
    return fs.writeFile(targetPath, content, 'utf8');
  }

  async stat(
    targetPath: string,
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number } | null> {
    try {
      const st = await fs.stat(targetPath);
      return { isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size };
    } catch {
      return null;
    }
  }
}
