import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalExecutionRuntime,
  WslExecutionRuntime,
  buildWslEnv,
  stripAgentSessionEnv,
  windowsPathToWsl,
} from './index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('@neopolitan/runtime-local', () => {
  it('spawns processes, captures redacted stderr tail, and kills process trees', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-rt-'));
    tempDirs.push(dir);

    const runtime = new LocalExecutionRuntime({ defaultCwd: dir });
    const proc = await runtime.spawn({
      command: process.execPath,
      args: [
        '-e',
        'console.error("Bearer sk-ant-secretvalue12345678"); console.log("ok"); setTimeout(() => {}, 10000);',
      ],
      cwd: dir,
    });

    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    expect(Buffer.from(value ?? []).toString('utf8')).toContain('ok');
    reader.releaseLock();

    await new Promise((r) => setTimeout(r, 80));
    expect(proc.getStderrTail()).not.toContain('sk-ant-secretvalue12345678');

    await proc.killTree(200);
    const exit = await proc.exited;
    expect(exit.code === null || typeof exit.code === 'number').toBe(true);

    await runtime.writeFile(path.join(dir, 'hello.txt'), 'world');
    expect(await runtime.exists(path.join(dir, 'hello.txt'))).toBe(true);
    expect(await runtime.readFile(path.join(dir, 'hello.txt'))).toBe('world');
  });

  it('strips parent orchestrator env and isolates WSL paths and WSLENV', () => {
    const clean = stripAgentSessionEnv(
      { PATH: '/usr/bin', ORCA_TOKEN: 'secret', T3_SESSION: '123' },
      { CUSTOM: 'yes' },
    );
    expect(clean.ORCA_TOKEN).toBeUndefined();
    expect(clean.T3_SESSION).toBeUndefined();
    expect(clean.CUSTOM).toBe('yes');

    expect(windowsPathToWsl('C:\\Users\\dev\\repo')).toBe('/mnt/c/Users/dev/repo');
    const wslEnv = buildWslEnv({
      PATH: 'C:\\Windows',
      HOME: 'C:\\Users\\dev',
      ANTHROPIC_API_KEY: 'key',
    });
    expect(wslEnv.WSL_UTF8).toBe('1');
    expect(wslEnv.PATH).toBeUndefined();
    expect(wslEnv.HOME).toBeUndefined();
    expect(wslEnv.WSLENV).toBe('ANTHROPIC_API_KEY/u');

    const wsl = new WslExecutionRuntime({ distro: 'Ubuntu-24.04' });
    expect(wsl.id).toBe('wsl:Ubuntu-24.04');
    expect(wsl.mapHostPathToRuntime('D:\\proj\\app')).toBe('/mnt/d/proj/app');
  });
});
