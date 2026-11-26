# Pattern 03: Headless RPC Server (HTTP+SSE & WebSocket)

When an IDE frontend, browser UI, or background orchestrator drives coding sessions over a socket, blocking a `POST /rpc` prompt request until the agent finishes **deadlocks interactive approvals**: the client needs to answer `gate.requested` *during* the active turn.

`AgentRpcServer` (`@neopolitan-ai/server`) solves this cleanly using non-blocking dispatch, per-session `KeyedLock` serialization, and `afterSeq` cursor replay over both HTTP+SSE and WebSocket.

## Non-Blocking Turn + Live Gate Sequence

<NeoDiagram name="rpc" />

## Code Recipe (`03-headless-rpc-server.ts`)

::: code-group

```ts [Server + HTTP/SSE + WS Client]
import { AgentRpcClient, AgentRpcServer } from '@neopolitan-ai/server';
import { InMemoryEventStore, SessionManager } from '@neopolitan-ai/sessions';
import { LocalExecutionRuntime } from '@neopolitan-ai/runtime-local';
import { createDefaultRegistry } from 'neopolitan-ai';

const eventStore = new InMemoryEventStore();
const sessionManager = new SessionManager(createDefaultRegistry(), eventStore, {
  runtime: new LocalExecutionRuntime(),
});

const server = new AgentRpcServer({
  sessionManager,
  eventStore,
  authToken: 'demo-bearer-token', // enforces 401 HTTP / 4401 WS close on missing token
});
const { url } = await server.listen({ host: '127.0.0.1', port: 0 });

const client = new AgentRpcClient({ baseUrl: url, authToken: 'demo-bearer-token' });
await client.connectWebSocket(); // optional: switch subscribeEvents() & RPC to WebSocket

const opened = await client.openSession('codex', {
  cwd: '/workspace',
  permissionMode: 'supervised',
});

// Subscribe with deterministic replay from seq 0
const ac = new AbortController();
const loop = (async () => {
  for await (const ev of client.subscribeEvents(opened.sessionId, {
    afterSeq: 0,
    signal: ac.signal,
  })) {
    if (ev.type === 'gate.requested') {
      await client.respondToGate(opened.sessionId, {
        requestId: ev.request.requestId,
        resolution: { decision: 'allow_once', source: 'user' },
      });
    }
    if (ev.type === 'turn.completed') ac.abort();
  }
})();

const receipt = await client.sendTurn(opened.sessionId, { prompt: 'Deploy build' });
await loop;
```

```bash [CLI Daemon]
npx neopolitan-ai serve \
  --host 127.0.0.1 \
  --port 7420 \
  --token demo-bearer-token \
  --store ./.neopolitan-sessions
```

:::

See runnable source: [`examples/src/03-headless-rpc-server.ts`](https://github.com/milesangelo/neopolitan/blob/main/examples/src/03-headless-rpc-server.ts).
