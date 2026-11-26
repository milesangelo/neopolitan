import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { sanitizeProviderFailureMessage } from '@neopolitan-ai/core';

const PARENT_AGENT_ENV_PREFIXES = ['ORCA_', 'T3_', 'TRAYCER_AGENT_'];

/**
 * Strips parent orchestrator session variables so nested coding agents never inherit
 * host daemon tokens or session locks (Orca process-host pattern).
 */
export function stripAgentSessionEnv(
  baseEnv: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  overrides?: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (PARENT_AGENT_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    result[key] = value;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Retains a bounded UTF-8 byte tail of stderr regardless of whether callers drain stderr,
 * preventing pipe-buffer deadlocks and redacting secrets on read.
 */
export class BoundedStderrTail {
  private readonly maxBytes: number;
  private buffer = Buffer.alloc(0);

  constructor(maxBytes = 8 * 1024) {
    this.maxBytes = maxBytes;
  }

  push(chunk: Uint8Array | string): void {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    if (buf.length === 0) return;
    if (buf.length >= this.maxBytes) {
      this.buffer = buf.subarray(buf.length - this.maxBytes);
      return;
    }
    const combined = Buffer.concat([this.buffer, buf]);
    this.buffer =
      combined.length > this.maxBytes
        ? combined.subarray(combined.length - this.maxBytes)
        : combined;
  }

  readRedacted(): string {
    return sanitizeProviderFailureMessage(this.buffer.toString('utf8'));
  }
}

/**
 * Terminates a child process and its descendant process group cleanly (POSIX `-pid`
 * SIGTERM -> grace -> SIGKILL; Windows `taskkill /T /F`).
 */
export async function killProcessTree(
  child: Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>,
  graceMs = 2_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      });
    });
    return;
  }

  const sendGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // already exited
      }
    }
  };

  sendGroup('SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (child.exitCode === null && child.signalCode === null) {
    sendGroup('SIGKILL');
  }
}
