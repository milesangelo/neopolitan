import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(rootDir, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@neopolitan-ai/core': pkg('core'),
      '@neopolitan-ai/runtime-local': pkg('runtime-local'),
      '@neopolitan-ai/testing/conformance': path.resolve(
        rootDir,
        'packages/testing/src/conformance.ts',
      ),
      '@neopolitan-ai/testing': pkg('testing'),
      '@neopolitan-ai/adapter-acp': pkg('adapter-acp'),
      '@neopolitan-ai/adapter-claude': pkg('adapter-claude'),
      '@neopolitan-ai/adapter-codex': pkg('adapter-codex'),
      '@neopolitan-ai/adapter-pty': pkg('adapter-pty'),
      '@neopolitan-ai/auth': pkg('auth'),
      '@neopolitan-ai/sessions': pkg('sessions'),
      '@neopolitan-ai/workspace': pkg('workspace'),
      '@neopolitan-ai/server': pkg('server'),
      '@neopolitan-ai/orchestration': pkg('orchestration'),
      'neopolitan-ai/acp': path.resolve(rootDir, 'packages/neopolitan/src/acp.ts'),
      'neopolitan-ai/claude': path.resolve(rootDir, 'packages/neopolitan/src/claude.ts'),
      'neopolitan-ai/codex': path.resolve(rootDir, 'packages/neopolitan/src/codex.ts'),
      'neopolitan-ai/pty': path.resolve(rootDir, 'packages/neopolitan/src/pty.ts'),
      'neopolitan-ai/auth': path.resolve(rootDir, 'packages/neopolitan/src/auth.ts'),
      'neopolitan-ai/sessions': path.resolve(rootDir, 'packages/neopolitan/src/sessions.ts'),
      'neopolitan-ai/workspace': path.resolve(rootDir, 'packages/neopolitan/src/workspace.ts'),
      'neopolitan-ai/server': path.resolve(rootDir, 'packages/neopolitan/src/server.ts'),
      'neopolitan-ai/orchestration': path.resolve(
        rootDir,
        'packages/neopolitan/src/orchestration.ts',
      ),
      'neopolitan-ai': pkg('neopolitan'),
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
