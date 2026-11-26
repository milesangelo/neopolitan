import { spawn as nodeSpawn } from 'node:child_process';
import type { ExecutionRuntime, ManagedProcess, SpawnSpec } from '@neopolitan-ai/core';
import { wrapChildProcess } from './local-runtime.js';

export const WSL_MAX_COMMAND_LINE_CHARS = 16_000;
const WSL_EXCLUDED_ENV_KEYS = new Set(['PATH', 'HOME', 'TMP', 'TEMP']);

export interface WslExecutionRuntimeOptions {
  readonly distro: string;
  readonly defaultCwd?: string;
  readonly hostInteropCwd?: string;
}

export function windowsPathToWsl(windowsPath: string): string {
  const driveMatch = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath);
  if (!driveMatch) {
    return windowsPath.replace(/\\/g, '/');
  }
  const drive = driveMatch[1]!.toLowerCase();
  const rest = driveMatch[2]!.replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

export function buildWslEnv(env?: Readonly<Record<string, string>>): Record<string, string> {
  const propagatedKeys: string[] = [];
  const merged: Record<string, string> = {
    WSL_UTF8: '1',
  };
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (WSL_EXCLUDED_ENV_KEYS.has(key.toUpperCase())) continue;
      merged[key] = value;
      propagatedKeys.push(`${key}/u`);
    }
  }
  if (propagatedKeys.length > 0) {
    merged.WSLENV = propagatedKeys.join(':');
  }
  return merged;
}

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * ExecutionRuntime targeting a Windows Subsystem for Linux distro (`wsl.exe`).
 * Applies Orca's verified hardening: forces `WSL_UTF8=1`, strips Windows `PATH`/`HOME`/`TMP`
 * from `WSLENV`, uses a stable Windows-side spawn `cwd`, and avoids `/mnt/<drive>` leakage.
 */
export class WslExecutionRuntime implements ExecutionRuntime {
  readonly id: string;
  readonly platform = 'linux' as const;
  readonly kind = 'wsl' as const;
  readonly defaultCwd: string;
  readonly distro: string;
  private readonly hostInteropCwd: string;

  constructor(options: WslExecutionRuntimeOptions) {
    this.distro = options.distro;
    this.id = `wsl:${options.distro}`;
    this.defaultCwd = options.defaultCwd ?? '/home';
    this.hostInteropCwd = options.hostInteropCwd ?? process.cwd();
  }

  mapHostPathToRuntime(hostPath: string): string {
    return windowsPathToWsl(hostPath);
  }

  async spawn(spec: SpawnSpec, signal?: AbortSignal): Promise<ManagedProcess> {
    if (signal?.aborted) {
      throw new Error('Aborted before WSL spawn');
    }
    const guestCwd = this.mapHostPathToRuntime(spec.cwd);
    const fullCmd = [spec.command, ...(spec.args ?? [])].map(shellEscape).join(' ');
    const script = `cd ${shellEscape(guestCwd)} || exit 1; exec ${fullCmd}`;
    const useStdinScript = script.length > WSL_MAX_COMMAND_LINE_CHARS;

    const wslArgs = useStdinScript
      ? ['-d', this.distro, '--', 'sh', '-s']
      : ['-d', this.distro, '--', 'sh', '-c', script];

    const child = nodeSpawn('wsl.exe', wslArgs, {
      cwd: this.hostInteropCwd,
      env: { ...process.env, ...buildWslEnv(spec.env) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (useStdinScript) {
      child.stdin.write(`${script}\n`);
    }

    return wrapChildProcess(child, { signal });
  }

  private async runHelper(command: string): Promise<{ code: number; stdout: string }> {
    const proc = await this.spawn({
      command: 'sh',
      args: ['-c', command],
      cwd: this.defaultCwd,
    });
    const reader = proc.stdout.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const exit = await proc.exited;
    return {
      code: exit.code ?? 1,
      stdout: Buffer.concat(chunks).toString('utf8').trim(),
    };
  }

  async which(command: string): Promise<string | null> {
    const res = await this.runHelper(`command -v ${shellEscape(command)}`);
    if (res.code !== 0 || !res.stdout) return null;
    if (res.stdout.startsWith('/mnt/')) return null;
    return res.stdout;
  }

  async realpath(targetPath: string): Promise<string> {
    const res = await this.runHelper(
      `realpath ${shellEscape(this.mapHostPathToRuntime(targetPath))}`,
    );
    if (res.code !== 0) throw new Error(`realpath failed for ${targetPath}`);
    return res.stdout;
  }

  async exists(targetPath: string): Promise<boolean> {
    const res = await this.runHelper(
      `test -e ${shellEscape(this.mapHostPathToRuntime(targetPath))}`,
    );
    return res.code === 0;
  }

  async mkdir(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void> {
    const flag = options?.recursive === false ? '' : '-p ';
    const res = await this.runHelper(
      `mkdir ${flag}${shellEscape(this.mapHostPathToRuntime(targetPath))}`,
    );
    if (res.code !== 0) throw new Error(`mkdir failed for ${targetPath}`);
  }

  async readdir(
    targetPath: string,
  ): Promise<ReadonlyArray<{ readonly name: string; readonly isDirectory: boolean }>> {
    const mapped = shellEscape(this.mapHostPathToRuntime(targetPath));
    const res = await this.runHelper(
      `for f in ${mapped}/*; do [ -e "$f" ] || continue; if [ -d "$f" ]; then printf 'd:%s\\n' "$(basename "$f")"; else printf 'f:%s\\n' "$(basename "$f")"; fi; done`,
    );
    if (res.code !== 0 || !res.stdout) return [];
    return res.stdout.split('\n').map((line) => ({
      isDirectory: line.startsWith('d:'),
      name: line.slice(2),
    }));
  }

  async readFile(targetPath: string): Promise<string> {
    const res = await this.runHelper(`cat ${shellEscape(this.mapHostPathToRuntime(targetPath))}`);
    if (res.code !== 0) throw new Error(`readFile failed for ${targetPath}`);
    return res.stdout;
  }

  async writeFile(targetPath: string, content: string): Promise<void> {
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const res = await this.runHelper(
      `printf '%s' ${shellEscape(b64)} | base64 -d > ${shellEscape(this.mapHostPathToRuntime(targetPath))}`,
    );
    if (res.code !== 0) throw new Error(`writeFile failed for ${targetPath}`);
  }

  async stat(
    targetPath: string,
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number } | null> {
    const res = await this.runHelper(
      `stat -c '%F:%s' ${shellEscape(this.mapHostPathToRuntime(targetPath))} 2>/dev/null`,
    );
    if (res.code !== 0 || !res.stdout) return null;
    const [kind = '', sizeStr = '0'] = res.stdout.split(':');
    return {
      isFile: kind.includes('file'),
      isDirectory: kind.includes('directory'),
      size: Number(sizeStr) || 0,
    };
  }
}
