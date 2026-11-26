#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type {
  ExecutionRuntime,
  PermissionMode,
  ProviderId,
  ProviderRegistry,
} from '@neopolitan-ai/core';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';
import { AgentRpcServer } from '@neopolitan-ai/server';
import {
  InMemoryEventStore,
  JsonlEventStore,
  SessionManager,
  compileHandoffBundle,
} from '@neopolitan-ai/sessions';
import { createDefaultRegistry } from './index.js';

export interface CliDependencies {
  readonly runtime?: ExecutionRuntime;
  readonly registry?: ProviderRegistry;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
  readonly cwd?: string;
}

interface DoctorEntry {
  readonly id: string;
  readonly label: string;
  readonly transport: string;
  readonly available: boolean;
  readonly executablePath?: string;
  readonly version?: string;
  readonly authStatus?: string;
  readonly error?: string;
}

const require = createRequire(import.meta.url);

function readPackageVersion(): string {
  try {
    const pkg = require('../package.json') as { readonly version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function usageText(): string {
  return [
    'neopolitan — provider-agnostic coding-agent SDK & CLI',
    '',
    'Usage:',
    '  neopolitan doctor [--json] [--require <provider>]...',
    '  neopolitan run --provider <id> [--cwd <dir>] [--mode <mode>] [--raw] "<prompt>"',
    '  neopolitan serve [--host 127.0.0.1] [--port 7420] [--token <secret>] [--store <dir>]',
    '  neopolitan handoff --store <dir> --session <id> --to <provider> [--cwd <dir>] [--budget <tokens>] [--json]',
    '  neopolitan --help | -h',
    '  neopolitan --version | -v',
  ].join('\n');
}

function renderHandoffMarkdown(bundle: Awaited<ReturnType<typeof compileHandoffBundle>>): string {
  if (bundle.strategy !== 'compiled-prelude' && bundle.nativeAnchor) {
    return [
      `# Native Resume Handoff (${bundle.sourceProvider} -> ${bundle.targetProvider})`,
      `Strategy: ${bundle.strategy}`,
      `Anchor: ${JSON.stringify(bundle.nativeAnchor)}`,
    ].join('\n');
  }
  const prelude = bundle.compiledPrelude;
  if (!prelude) {
    return `# Handoff (${bundle.sourceProvider} -> ${bundle.targetProvider})\nStrategy: ${bundle.strategy}`;
  }
  return [
    `# Cross-Provider Context Handoff (${bundle.sourceProvider} -> ${bundle.targetProvider})`,
    prelude.summaryMarkdown,
    prelude.recentTurnsMarkdown,
    prelude.gitStatusSummary ? `## Git Diff\n\`\`\`diff\n${prelude.gitStatusSummary}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runDoctor(
  args: ReadonlyArray<string>,
  runtime: ExecutionRuntime,
  registry: ProviderRegistry,
  cwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      json: { type: 'boolean', default: false },
      require: { type: 'string', multiple: true, default: [] },
    },
    allowPositionals: false,
  });

  const drivers = registry.list();
  const providers: DoctorEntry[] = [];
  for (const driver of drivers) {
    try {
      const probe = await driver.probe({ cwd }, runtime);
      providers.push({
        id: driver.id,
        label: driver.label,
        transport: driver.baseCapabilities.transport,
        available: probe.available,
        executablePath: probe.executablePath,
        version: probe.version,
        authStatus: probe.authStatus,
        error: probe.reason,
      });
    } catch (err) {
      providers.push({
        id: driver.id,
        label: driver.label,
        transport: driver.baseCapabilities.transport,
        available: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const requiredIds = values.require ?? [];
  const missingRequired = requiredIds.filter(
    (reqId) => !providers.some((entry) => entry.id === reqId && entry.available),
  );
  const ok = missingRequired.length === 0;

  if (values.json) {
    stdout(JSON.stringify({ ok, missingRequired, providers }, null, 2));
  } else {
    stdout('Provider         Transport   Status       Version / Reason');
    stdout('----------------------------------------------------------------------');
    for (const p of providers) {
      const status = p.available ? 'available' : 'missing';
      const detail = p.available
        ? (p.version ?? p.authStatus ?? 'ready')
        : (p.error ?? 'not found');
      stdout(`${p.id.padEnd(16)} ${p.transport.padEnd(11)} ${status.padEnd(12)} ${detail}`);
    }
    if (!ok) {
      stderr(`Required provider(s) unavailable: ${missingRequired.join(', ')}`);
    }
  }

  return ok ? 0 : 1;
}

async function runSingleTurn(
  args: ReadonlyArray<string>,
  runtime: ExecutionRuntime,
  registry: ProviderRegistry,
  defaultCwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      provider: { type: 'string' },
      cwd: { type: 'string', default: defaultCwd },
      mode: { type: 'string', default: 'supervised' },
      raw: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const providerId = values.provider as ProviderId | undefined;
  const prompt = positionals.join(' ').trim();
  if (!providerId) {
    stderr('Missing required flag: --provider <id>');
    return 1;
  }
  if (!prompt) {
    stderr('Missing prompt argument. Example: neopolitan run --provider mock "Explain this file"');
    return 1;
  }

  const driver = registry.get(providerId);
  if (!driver) {
    stderr(
      `Unknown provider "${providerId}". Run "neopolitan doctor" to inspect registered providers.`,
    );
    return 1;
  }

  const adapter = await driver.createAdapter({}, { runtime });
  const session = await adapter.openSession({
    cwd: path.resolve(values.cwd ?? defaultCwd),
    permissionMode: (values.mode ?? 'supervised') as PermissionMode,
  });

  let exitCode = 0;
  const ac = new AbortController();
  const onSignal = () => {
    ac.abort();
    void session.interruptTurn();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const consumePromise = (async () => {
      for await (const ev of session.events({
        includeRaw: Boolean(values.raw),
        signal: ac.signal,
      })) {
        if (values.raw) {
          stdout(JSON.stringify(ev));
        } else if (ev.type === 'assistant.completed') {
          stdout(ev.text);
        } else if (ev.type === 'turn.completed') {
          if (ev.status === 'failed') {
            stderr(ev.failure?.safeMessage ?? 'Turn failed');
            exitCode = 1;
          }
          ac.abort();
        }
      }
    })();

    const receipt = await session.sendTurn({ prompt }, ac.signal);
    if (receipt.outcome === 'rejected') {
      stderr(receipt.reason);
      ac.abort();
      exitCode = 1;
    }

    await consumePromise;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await session.close('cli finished');
  }

  return exitCode;
}

async function runServe(
  args: ReadonlyArray<string>,
  runtime: ExecutionRuntime,
  registry: ProviderRegistry,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '7420' },
      token: { type: 'string' },
      store: { type: 'string' },
    },
    allowPositionals: false,
  });

  const portNum = Number(values.port);
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    stderr(`Invalid --port value "${values.port}"`);
    return 1;
  }

  const eventStore = values.store
    ? new JsonlEventStore(path.resolve(values.store))
    : new InMemoryEventStore();
  const sessionManager = new SessionManager(registry, eventStore, { runtime });
  const server = new AgentRpcServer({
    sessionManager,
    eventStore,
    authToken: values.token,
  });

  const listening = await server.listen({ host: values.host, port: portNum });
  stdout(JSON.stringify(listening));

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void (async () => {
        await server.close();
        await sessionManager.closeAll();
        resolve();
      })();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

  return 0;
}

async function runHandoff(
  args: ReadonlyArray<string>,
  defaultCwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      store: { type: 'string' },
      session: { type: 'string' },
      to: { type: 'string' },
      cwd: { type: 'string' },
      budget: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (!values.store || !values.session || !values.to) {
    stderr(
      'Missing required flags. Usage: neopolitan handoff --store <dir> --session <id> --to <provider>',
    );
    return 1;
  }

  const store = new JsonlEventStore(path.resolve(values.store));
  const snapshot = await store.loadSnapshot(values.session);
  if (!snapshot) {
    stderr(`Session "${values.session}" not found in "${values.store}"`);
    return 1;
  }

  const events = await store.read(values.session);
  const tokenBudget = values.budget ? Number(values.budget) : undefined;
  if (values.budget && (!Number.isFinite(tokenBudget) || (tokenBudget ?? 0) <= 0)) {
    stderr(`Invalid --budget value "${values.budget}"`);
    return 1;
  }

  const bundle = await compileHandoffBundle({
    sourceSnapshot: snapshot,
    events,
    targetProvider: values.to as ProviderId,
    targetCwd: path.resolve(values.cwd ?? defaultCwd),
    tokenBudget,
  });

  stdout(values.json ? JSON.stringify(bundle, null, 2) : renderHandoffMarkdown(bundle));
  return 0;
}

export async function runCli(
  argv: ReadonlyArray<string>,
  deps: CliDependencies = {},
): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const cwd = deps.cwd ?? process.cwd();
  const runtime = deps.runtime ?? new LocalExecutionRuntime({ defaultCwd: cwd });
  const registry = deps.registry ?? createDefaultRegistry();

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    stdout(usageText());
    return 0;
  }

  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    stdout(readPackageVersion());
    return 0;
  }

  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case 'doctor':
        return await runDoctor(rest, runtime, registry, cwd, stdout, stderr);
      case 'run':
        return await runSingleTurn(rest, runtime, registry, cwd, stdout, stderr);
      case 'serve':
        return await runServe(rest, runtime, registry, stdout, stderr);
      case 'handoff':
        return await runHandoff(rest, cwd, stdout, stderr);
      default:
        stderr(`Unknown command "${subcommand}". Run "neopolitan --help" for usage.`);
        return 1;
    }
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(entry);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
