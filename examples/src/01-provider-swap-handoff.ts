import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProviderRegistry, type AgentEvent, type AgentSession } from '@neopolitan/core';
import { JsonlEventStore, SessionManager, TurnItemAccumulator } from '@neopolitan/sessions';
import { createMockDriver, MockExecutionRuntime } from '@neopolitan/testing';

async function runTurn(session: AgentSession, prompt: string, accumulator?: TurnItemAccumulator) {
  const ac = new AbortController();
  const collect = (async () => {
    for await (const ev of session.events({ signal: ac.signal })) {
      accumulator?.apply(ev);
      if (ev.type === 'turn.completed') {
        ac.abort();
      }
    }
  })();
  await session.sendTurn({ prompt });
  await collect;
}

async function main(): Promise<void> {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-ex1-'));
  const runtime = new MockExecutionRuntime();
  const registry = new ProviderRegistry()
    .register({ ...createMockDriver(), id: 'claude-code', label: 'Claude Code (Mock)' })
    .register({ ...createMockDriver(), id: 'codex', label: 'Codex (Mock)' });

  const store = new JsonlEventStore(storeDir);
  const manager = new SessionManager(registry, store, { runtime });

  try {
    // 1. Start work on Claude Code
    const claudeSession = await manager.open('claude-code', {
      cwd: '/workspace/app',
      model: { model: 'claude-sonnet-4-5' },
    });
    const accumulator = new TurnItemAccumulator();
    await runTurn(claudeSession, 'Draft an authentication middleware in src/auth.ts', accumulator);

    // Wait briefly for EventStore background flush
    await new Promise((r) => setTimeout(r, 30));
    console.log('[1] Claude blocks accumulated:', accumulator.getBlocks().length);

    // 2. Hot-swap mid-task to Codex with a custom summarizer & current git diff
    const { session: codexSession, bundle } = await manager.handoff(
      claudeSession.sessionId,
      { providerId: 'codex', model: { model: 'gpt-5-codex' } },
      {
        tokenBudget: 8_000,
        gitDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n+export function verifyJwt() {}',
        summarizer: {
          async summarize({ events, maxTokens }) {
            return `Summarized ${events.length} canonical events within ${maxTokens} tokens.`;
          },
        },
      },
    );

    console.log('[2] Handoff strategy:', bundle.strategy);
    console.log('[2] Handoff summary:', bundle.compiledPrelude?.summaryMarkdown);
    console.log('[2] Estimated prelude tokens:', bundle.compiledPrelude?.estimatedTokens);

    const codexAcc = new TurnItemAccumulator();
    await runTurn(codexSession, 'Add unit tests for verifyJwt()', codexAcc);
    console.log('[3] Codex resumed blocks:', codexAcc.getBlocks());

    await codexSession.close();
    await claudeSession.close();
    await manager.closeAll();
  } finally {
    await fs.rm(storeDir, { recursive: true, force: true });
  }
}

await main();
