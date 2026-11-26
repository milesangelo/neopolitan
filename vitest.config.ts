import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(rootDir, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@neopolitan/core': pkg('core'),
      '@neopolitan/runtime-local': pkg('runtime-local'),
      '@neopolitan/testing/conformance': path.resolve(
        rootDir,
        'packages/testing/src/conformance.ts',
      ),
      '@neopolitan/testing': pkg('testing'),
      '@neopolitan/adapter-acp': pkg('adapter-acp'),
      '@neopolitan/adapter-claude': pkg('adapter-claude'),
      '@neopolitan/adapter-codex': pkg('adapter-codex'),
      '@neopolitan/adapter-pty': pkg('adapter-pty'),
      '@neopolitan/auth': pkg('auth'),
      '@neopolitan/sessions': pkg('sessions'),
      '@neopolitan/workspace': pkg('workspace'),
      '@neopolitan/server': pkg('server'),
      '@neopolitan/orchestration': pkg('orchestration'),
      'neopolitan/acp': path.resolve(rootDir, 'packages/neopolitan/src/acp.ts'),
      'neopolitan/claude': path.resolve(rootDir, 'packages/neopolitan/src/claude.ts'),
      'neopolitan/codex': path.resolve(rootDir, 'packages/neopolitan/src/codex.ts'),
      'neopolitan/pty': path.resolve(rootDir, 'packages/neopolitan/src/pty.ts'),
      'neopolitan/auth': path.resolve(rootDir, 'packages/neopolitan/src/auth.ts'),
      'neopolitan/sessions': path.resolve(rootDir, 'packages/neopolitan/src/sessions.ts'),
      'neopolitan/workspace': path.resolve(rootDir, 'packages/neopolitan/src/workspace.ts'),
      'neopolitan/server': path.resolve(rootDir, 'packages/neopolitan/src/server.ts'),
      'neopolitan/orchestration': path.resolve(rootDir, 'packages/neopolitan/src/orchestration.ts'),
      neopolitan: pkg('neopolitan'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/index.ts',
        'packages/neopolitan/src/{acp,claude,codex,pty,auth,sessions,workspace,server,orchestration}.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
