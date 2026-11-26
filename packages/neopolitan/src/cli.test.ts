import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProviderRegistry } from '@neopolitan/core';
import { JsonlEventStore } from '@neopolitan/sessions';
import { MockExecutionRuntime, createMockDriver } from '@neopolitan/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import { createDefaultRegistry } from './index.js';

describe('neopolitan umbrella & cli', () => {
  it('registers built-in drivers via createDefaultRegistry()', () => {
    const registry = createDefaultRegistry();
    const ids = registry.list().map((d) => d.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex');
    expect(ids).toContain('opencode');
    expect(ids).toContain('acp');
  });

  it('prints help and version cleanly', async () => {
    const out: string[] = [];
    expect(await runCli(['--help'], { stdout: (l) => out.push(l) })).toBe(0);
    expect(out.join('\n')).toContain('neopolitan doctor');

    const ver: string[] = [];
    expect(await runCli(['--version'], { stdout: (l) => ver.push(l) })).toBe(0);
    expect(ver[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('runs doctor --json against injected runtime and checks --require', async () => {
    const runtime = new MockExecutionRuntime();
    const out: string[] = [];
    const err: string[] = [];
    const registry = new ProviderRegistry().register(createMockDriver());

    const okCode = await runCli(['doctor', '--json', '--require', 'mock'], {
      runtime,
      registry,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(okCode).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as { ok: boolean; providers: Array<{ id: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.providers[0]?.id).toBe('mock');

    const failCode = await runCli(['doctor', '--json', '--require', 'nonexistent'], {
      runtime,
      registry,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(failCode).toBe(1);
  });

  it('executes single turn via neopolitan run with mock provider', async () => {
    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry().register(createMockDriver());
    const out: string[] = [];
    const err: string[] = [];

    const code = await runCli(['run', '--provider', 'mock', 'Check build'], {
      runtime,
      registry,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out.join('\n')).toContain('Mock reply: Check build');
  });

  it('compiles cross-provider handoff packet from JsonlEventStore', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neopolitan-cli-handoff-'));
    try {
      const store = new JsonlEventStore(tmpDir);
      await store.saveSnapshot({
        sessionId: 'sess-1',
        providerId: 'claude-code',
        cwd: '/repo/a',
        anchor: { providerId: 'claude-code', sessionId: 'c-1' },
        lastSeq: 1,
        updatedAt: Date.now(),
      });
      await store.append('sess-1', [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'sess-1',
          type: 'assistant.completed',
          turnId: 't-1',
          blockId: 'b-1',
          text: 'Updated API routes using Bearer sk-ant-secretvalue12345',
        },
      ]);

      const out: string[] = [];
      const err: string[] = [];
      const code = await runCli(
        ['handoff', '--store', tmpDir, '--session', 'sess-1', '--to', 'codex', '--cwd', '/repo/b'],
        {
          stdout: (l) => out.push(l),
          stderr: (l) => err.push(l),
        },
      );
      expect(code).toBe(0);
      expect(err).toEqual([]);
      expect(out.join('\n')).toContain('Cross-Provider Context Handoff (claude-code -> codex)');
      expect(out.join('\n')).not.toContain('sk-ant-secretvalue12345');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns exit code 1 for unknown command or missing flags', async () => {
    const err: string[] = [];
    expect(await runCli(['wat'], { stderr: (l) => err.push(l) })).toBe(1);
    expect(await runCli(['run', 'hello'], { stderr: (l) => err.push(l) })).toBe(1);
    expect(err.length).toBeGreaterThanOrEqual(2);
  });
});
