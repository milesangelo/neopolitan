import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(rootDir, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@neopolitan/core': pkg('core'),
      '@neopolitan/runtime-local': pkg('runtime-local'),
      '@neopolitan/testing/conformance': path.resolve(rootDir, 'packages/testing/src/conformance.ts'),
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
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
