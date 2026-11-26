import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';

function run(cmd, args, cwd = rootDir, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    shell: isWin,
  });
  if (res.status !== 0) {
    throw new Error(
      `Command failed (${res.status}): ${cmd} ${args.join(' ')}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
    );
  }
  return res.stdout;
}

function binPath(baseDir, name) {
  return path.join(baseDir, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);
}

const packageDirs = [
  'core',
  'runtime-local',
  'testing',
  'adapter-acp',
  'adapter-claude',
  'adapter-codex',
  'adapter-pty',
  'auth',
  'sessions',
  'workspace',
  'server',
  'orchestration',
  'neopolitan',
];

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neopolitan-packed-'));
const tarballDir = path.join(tmpRoot, 'tarballs');
const consumerDir = path.join(tmpRoot, 'consumer');

try {
  fs.mkdirSync(tarballDir, { recursive: true });
  fs.mkdirSync(path.join(consumerDir, 'src'), { recursive: true });

  console.log('1/5 Building all workspace packages...');
  run(pnpmCmd, ['run', 'build']);

  console.log('2/5 Packing all 13 publishable packages...');
  const tarballs = new Map();
  for (const dir of packageDirs) {
    const pkgDir = path.join(rootDir, 'packages', dir);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    run(pnpmCmd, ['pack', '--pack-destination', tarballDir], pkgDir);
    const filePrefix = pkgJson.name.startsWith('@')
      ? pkgJson.name.slice(1).replace('/', '-')
      : pkgJson.name;
    const tgzPath = path.join(tarballDir, `${filePrefix}-${pkgJson.version}.tgz`);
    if (!fs.existsSync(tgzPath)) {
      throw new Error(`Expected tarball missing at ${tgzPath}`);
    }
    tarballs.set(pkgJson.name, tgzPath);
  }

  console.log('3/5 Running publint & attw across all 13 tarballs...');
  const publintBin = binPath(rootDir, 'publint');
  const attwBin = binPath(rootDir, 'attw');
  for (const [pkgName, tgzPath] of tarballs) {
    run(publintBin, ['--strict', tgzPath]);
    run(attwBin, ['--profile', 'esm-only', tgzPath]);
    console.log(`  ✓ ${pkgName} passed publint + attw`);
  }

  console.log('4/5 Installing packed tarballs into isolated external consumer...');
  const overrides = {};
  for (const [pkgName, tgzPath] of tarballs) {
    overrides[pkgName] = `file:${tgzPath.replace(/\\/g, '/')}`;
  }

  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'neopolitan-packed-consumer-e2e',
        private: true,
        type: 'module',
        dependencies: {
          'neopolitan-ai': overrides['neopolitan-ai'],
          '@neopolitan-ai/core': overrides['@neopolitan-ai/core'],
        },
        devDependencies: {
          '@neopolitan-ai/testing': overrides['@neopolitan-ai/testing'],
          typescript: '^5.8.3',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const workspaceLines = [
    'packages:',
    "  - '.'",
    'autoInstallPeers: false',
    'overrides:',
    ...Object.entries(overrides).map(([k, v]) => `  '${k}': '${v}'`),
    'ignoredOptionalDependencies:',
    "  - '@anthropic-ai/claude-agent-sdk-darwin-arm64'",
    "  - '@anthropic-ai/claude-agent-sdk-darwin-x64'",
    "  - '@anthropic-ai/claude-agent-sdk-linux-arm64'",
    "  - '@anthropic-ai/claude-agent-sdk-linux-arm64-musl'",
    "  - '@anthropic-ai/claude-agent-sdk-linux-x64'",
    "  - '@anthropic-ai/claude-agent-sdk-linux-x64-musl'",
    "  - '@anthropic-ai/claude-agent-sdk-win32-arm64'",
    "  - '@anthropic-ai/claude-agent-sdk-win32-x64'",
    '',
  ];
  fs.writeFileSync(
    path.join(consumerDir, 'pnpm-workspace.yaml'),
    workspaceLines.join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(consumerDir, 'tsconfig.nodenext.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          outDir: 'dist',
          rootDir: 'src',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
    'utf8',
  );

  fs.writeFileSync(
    path.join(consumerDir, 'tsconfig.bundler.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
    'utf8',
  );

  fs.writeFileSync(
    path.join(consumerDir, 'src', 'verify.ts'),
    `import {
  InMemoryEventStore,
  LocalExecutionRuntime,
  SessionManager,
  createDefaultRegistry,
} from 'neopolitan-ai';
import { ACP_BASE_CAPABILITIES } from 'neopolitan-ai/acp';
import { CLAUDE_BASE_CAPABILITIES } from 'neopolitan-ai/claude';
import { CODEX_BASE_CAPABILITIES } from 'neopolitan-ai/codex';
import { PTY_BASE_CAPABILITIES } from 'neopolitan-ai/pty';
import { AgentRpcServer } from 'neopolitan-ai/server';
import { redactSecrets } from '@neopolitan-ai/core';
import { MockExecutionRuntime, createMockDriver } from '@neopolitan-ai/testing';

const registry = createDefaultRegistry().register(createMockDriver());
const store = new InMemoryEventStore();
const runtime = new MockExecutionRuntime();
const manager = new SessionManager(registry, store, { runtime });

const session = await manager.open('mock', { cwd: runtime.defaultCwd });
const receipt = await session.sendTurn({ prompt: 'Hello from tarball' });
if (receipt.outcome !== 'accepted') {
  throw new Error('Expected accepted dispatch receipt');
}
await manager.waitForFlush(session.sessionId);
await manager.closeAll();

const redacted = redactSecrets('Authorization: Bearer sk-ant-tarballsecret12345');
if (redacted.includes('sk-ant-tarballsecret12345')) {
  throw new Error('Secret was not redacted');
}

const localRt = new LocalExecutionRuntime();
if (!localRt.id || !ACP_BASE_CAPABILITIES.transport || !CLAUDE_BASE_CAPABILITIES.transport || !CODEX_BASE_CAPABILITIES.transport || !PTY_BASE_CAPABILITIES.transport || !AgentRpcServer) {
  throw new Error('Missing expected exports');
}

console.log('Packed consumer TypeScript & runtime verification passed!');
`,
    'utf8',
  );

  run(pnpmCmd, ['install'], consumerDir);

  console.log(
    '5/5 Verifying NodeNext + Bundler compilation, runtime execution & neopolitan CLI...',
  );
  const tscBin = binPath(consumerDir, 'tsc');
  run(tscBin, ['-p', 'tsconfig.nodenext.json'], consumerDir);
  run(tscBin, ['-p', 'tsconfig.bundler.json'], consumerDir);
  console.log(run(process.execPath, ['dist/verify.js'], consumerDir).trim());

  const cliBin = binPath(consumerDir, 'neopolitan-ai');
  const cliAliasBin = binPath(consumerDir, 'neopolitan');
  const ver = run(cliBin, ['--version'], consumerDir).trim();
  if (!/^\d+\.\d+\.\d+/.test(ver)) {
    throw new Error(`Unexpected CLI --version output: ${ver}`);
  }
  const doctorJson = JSON.parse(run(cliAliasBin, ['doctor', '--json'], consumerDir));
  if (!Array.isArray(doctorJson.providers) || doctorJson.providers.length < 4) {
    throw new Error(`Unexpected CLI doctor output: ${JSON.stringify(doctorJson)}`);
  }
  console.log(
    `  ✓ neopolitan CLI verified (v${ver}, ${doctorJson.providers.length} providers probed)`,
  );
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
