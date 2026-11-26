import { type AgentEvent, ProviderRegistry } from '@neopolitan/core';
import { AgentRpcClient, AgentRpcServer } from '@neopolitan/server';
import { InMemoryEventStore, SessionManager } from '@neopolitan/sessions';
import { MockExecutionRuntime, createMockDriver } from '@neopolitan/testing';

async function main(): Promise<void> {
  const runtime = new MockExecutionRuntime();
  const registry = new ProviderRegistry().register(
    createMockDriver({ requireGateOnPrompt: /deploy/i }),
  );
  const eventStore = new InMemoryEventStore();
  const sessionManager = new SessionManager(registry, eventStore, { runtime });

  const server = new AgentRpcServer({
    sessionManager,
    eventStore,
    authToken: 'demo-bearer-token',
  });
  const { url, wsUrl } = await server.listen();
  console.log('[1] Headless RPC server listening:', { url, wsUrl });

  const httpClient = new AgentRpcClient({ baseUrl: url, authToken: 'demo-bearer-token' });
  const wsClient = new AgentRpcClient({ baseUrl: url, authToken: 'demo-bearer-token' });

  try {
    // 1. Drive session via non-blocking HTTP+SSE while answering a live gate request
    const opened = await httpClient.openSession('mock', {
      cwd: '/workspace',
      permissionMode: 'supervised',
    });

    const sseAbort = new AbortController();
    const sseLoop = (async () => {
      for await (const ev of httpClient.subscribeEvents(opened.sessionId, {
        signal: sseAbort.signal,
      })) {
        if (ev.type === 'gate.requested') {
          console.log(
            '[2] HTTP+SSE client received gate:',
            ev.request.kind === 'approval' ? ev.request.title : ev.request.prompt,
          );
          await httpClient.respondToGate(opened.sessionId, {
            requestId: ev.request.requestId,
            resolution: { decision: 'allow_once', source: 'user' },
          });
        }
        if (ev.type === 'turn.completed') {
          sseAbort.abort();
        }
      }
    })();

    const receipt = await httpClient.sendTurn(opened.sessionId, { prompt: 'Deploy build' });
    console.log('[3] Non-blocking sendTurn receipt:', receipt.outcome);
    await sseLoop;

    // 2. Connect a second client over WebSocket with cursor replay from seq 0
    await wsClient.connectWebSocket();
    const wsAbort = new AbortController();
    const replayed: AgentEvent[] = [];
    for await (const ev of wsClient.subscribeEvents(opened.sessionId, {
      afterSeq: 0,
      signal: wsAbort.signal,
    })) {
      replayed.push(ev);
      if (ev.type === 'turn.completed') {
        wsAbort.abort();
      }
    }
    console.log(
      '[4] WebSocket client replayed events:',
      replayed.map((e) => `${e.seq}:${e.type}`),
    );
  } finally {
    await httpClient.close();
    await wsClient.close();
    await server.close();
  }
}

await main();
