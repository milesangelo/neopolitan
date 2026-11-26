# Pattern 03: Headless RPC Server (HTTP+SSE & WebSocket)

When an IDE frontend, browser UI, or background orchestrator drives coding sessions over a socket, blocking a `POST /rpc` prompt request until the agent finishes **deadlocks interactive approvals**: the client needs to answer `gate.requested` *during* the active turn.

`AgentRpcServer` (`@neopolitan-ai/server`) solves this cleanly using non-blocking dispatch, per-session `KeyedLock` serialization, and `afterSeq` cursor replay over both HTTP+SSE and WebSocket.

## Non-Blocking Turn + Live Gate Sequence

<div class="neo-diagram">
  <svg viewBox="0 0 820 215" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Non-blocking HTTP+SSE RPC sequence">
    <defs>
      <marker id="rpc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
      </marker>
    </defs>

    <!-- Lifelines -->
    <rect x="44" y="14" width="160" height="36" rx="8" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="1.75" />
    <text x="124" y="37" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">AgentRpcClient</text>
    <line x1="124" y1="50" x2="124" y2="195" stroke="var(--vp-c-divider)" stroke-dasharray="4 4" stroke-width="1.5" />

    <rect x="330" y="14" width="160" height="36" rx="8" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
    <text x="410" y="37" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">AgentRpcServer</text>
    <line x1="410" y1="50" x2="410" y2="195" stroke="var(--vp-c-divider)" stroke-dasharray="4 4" stroke-width="1.5" />

    <rect x="616" y="14" width="160" height="36" rx="8" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
    <text x="696" y="37" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">AgentSession</text>
    <line x1="696" y1="50" x2="696" y2="195" stroke="var(--vp-c-divider)" stroke-dasharray="4 4" stroke-width="1.5" />

    <!-- Step 1 -->
    <line x1="124" y1="74" x2="404" y2="74" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
    <text x="267" y="68" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">POST /rpc session.sendTurn (Authorization: Bearer ...)</text>

    <!-- Step 2 -->
    <line x1="404" y1="98" x2="130" y2="98" stroke="#E14B6A" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
    <text x="267" y="92" text-anchor="middle" font-size="11" font-weight="600" fill="var(--vp-c-brand-1)">Immediate DispatchReceipt (non-blocking)</text>

    <!-- Step 3 -->
    <line x1="696" y1="124" x2="130" y2="124" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
    <text x="410" y="118" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">SSE /events/:id (or WS) streams gate.requested (id: seq)</text>

    <!-- Step 4 -->
    <line x1="124" y1="150" x2="404" y2="150" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
    <text x="267" y="144" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">POST /rpc session.respondToGate (unblocked by KeyedLock)</text>

    <!-- Step 5 -->
    <line x1="696" y1="176" x2="130" y2="176" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
    <text x="410" y="170" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">assistant.delta -&gt; assistant.completed -&gt; turn.completed</text>
  </svg>
</div>

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
