import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistry, type AgentEvent } from '@neopolitan/core';
import { InMemoryEventStore, SessionManager } from '@neopolitan/sessions';
import { createMockDriver, MockExecutionRuntime } from '@neopolitan/testing';
import { AgentRpcClient, AgentRpcServer } from './index.js';

const servers: AgentRpcServer[] = [];
const clients: AgentRpcClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const s of servers.splice(0)) await s.close();
});

describe('@neopolitan/server', () => {
  it('supports non-blocking HTTP+SSE RPC + interactive gate resolution without deadlocking', async () => {
    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry().register(
      createMockDriver({ requireGateOnPrompt: /gate/i }),
    );
    const eventStore = new InMemoryEventStore();
    const sessionManager = new SessionManager(registry, eventStore, { runtime });

    const server = new AgentRpcServer({ sessionManager, eventStore, authToken: 'tok-123' });
    servers.push(server);
    const { url } = await server.listen();

    const client = new AgentRpcClient({ baseUrl: url, authToken: 'tok-123' });
    clients.push(client);

    const opened = await client.openSession('mock', {
      cwd: '/workspace',
      permissionMode: 'supervised',
    });

    const ac = new AbortController();
    const received: AgentEvent[] = [];
    const sseLoop = (async () => {
      for await (const ev of client.subscribeEvents(opened.sessionId, { signal: ac.signal })) {
        received.push(ev);
        if (ev.type === 'gate.requested') {
          await client.respondToGate(opened.sessionId, {
            requestId: ev.request.requestId,
            resolution: { decision: 'allow_once', source: 'user' },
          });
        }
        if (ev.type === 'turn.completed') {
          ac.abort();
        }
      }
    })();

    const receipt = await client.sendTurn(opened.sessionId, { prompt: 'Run gate check' });
    expect(receipt.outcome).toBe('accepted');
    await sseLoop;

    expect(received.some((e) => e.type === 'gate.resolved')).toBe(true);
    expect(received.some((e) => e.type === 'turn.completed' && e.status === 'completed')).toBe(true);
  });

  it('supports WebSocket RPC with afterSeq cursor replay', async () => {
    const runtime = new MockExecutionRuntime();
    const registry = new ProviderRegistry().register(createMockDriver());
    const eventStore = new InMemoryEventStore();
    const sessionManager = new SessionManager(registry, eventStore, { runtime });

    const server = new AgentRpcServer({ sessionManager, eventStore });
    servers.push(server);
    const { url } = await server.listen();

    const client = new AgentRpcClient({ baseUrl: url });
    clients.push(client);
    await client.connectWebSocket();

    const opened = await client.openSession('mock', { cwd: '/workspace' });
    await client.sendTurn(opened.sessionId, { prompt: 'WS hello' });
    await new Promise((r) => setTimeout(r, 40));

    const replayed: AgentEvent[] = [];
    const ac = new AbortController();
    for await (const ev of client.subscribeEvents(opened.sessionId, { afterSeq: 0, signal: ac.signal })) {
      replayed.push(ev);
      if (ev.type === 'turn.completed') ac.abort();
    }
    expect(replayed.some((e) => e.type === 'assistant.completed')).toBe(true);
  });
});
