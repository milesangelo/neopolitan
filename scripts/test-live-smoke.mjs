import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NEOPOLITAN_LIVE_TESTS !== '1') {
  console.log(
    'Skipping live CLI smoke tests (set NEOPOLITAN_LIVE_TESTS=1 to run zero-cost CLI probes & handshakes).',
  );
  process.exit(0);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { LocalExecutionRuntime, createAcpDriver, createCodexDriver, createDefaultRegistry } =
  await import(path.join(rootDir, 'packages', 'neopolitan', 'dist', 'index.js'));

const runtime = new LocalExecutionRuntime({ defaultCwd: rootDir });
const registry = createDefaultRegistry();

console.log('Running local provider probes (zero billed tokens)...');
const probeMap = new Map();
for (const driver of registry.list()) {
  const probe = await driver.probe({ cwd: rootDir }, runtime);
  probeMap.set(driver.id, probe);
  console.log(
    `  - ${driver.id}: available=${probe.available} version=${probe.version ?? 'n/a'} auth=${probe.authStatus ?? 'n/a'}`,
  );
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neopolitan-live-smoke-'));
try {
  if (probeMap.get('codex')?.available) {
    console.log(
      'Running zero-cost Codex app-server handshake (initialize + thread/start + close)...',
    );
    const codexAdapter = await createCodexDriver().createAdapter({}, { runtime });
    const session = await codexAdapter.openSession({ cwd: tmpDir });
    const anchor = session.getAnchor();
    console.log(`  ✓ Codex handshake succeeded: ${JSON.stringify(anchor)}`);
    await session.close('live smoke done');
  }

  if (probeMap.get('opencode')?.available) {
    console.log('Running zero-cost OpenCode ACP handshake (initialize + session/new + close)...');
    const acpAdapter = await createAcpDriver({
      id: 'opencode',
      command: 'opencode',
      args: ['acp'],
      flavor: 'opencode',
    }).createAdapter({}, { runtime });
    const session = await acpAdapter.openSession({ cwd: tmpDir });
    const anchor = session.getAnchor();
    console.log(`  ✓ OpenCode ACP handshake succeeded: ${JSON.stringify(anchor)}`);
    await session.close('live smoke done');
  }
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

console.log('Live CLI smoke verification completed.');
