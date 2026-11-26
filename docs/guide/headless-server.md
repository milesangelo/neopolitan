# Headless RPC Server (`@neopolitan-ai/server`)

`AgentRpcServer` exposes your `SessionManager` over both HTTP+SSE and WebSocket (`ws`) for desktop frontends, web dashboards, or remote workers:

- **Non-blocking Prompt Dispatch:** `session.sendTurn` resolves immediately with `DispatchReceipt` while events stream concurrently over SSE (`/events/:sessionId`) or WebSocket (`/ws`). Interactive `session.respondToGate` calls never deadlock behind active turns.
- **Cursor Replay:** Both `GET /events/:sessionId?afterSeq=...` (also supporting `Last-Event-ID`) and WebSocket `session.subscribe` replay missed events deterministically.
- **Per-Session Serialization:** Commands on the same session execute sequentially via `KeyedLock`.
- **Bearer Auth:** Configure `authToken` to enforce `401 Unauthorized` on HTTP routes and `4401` close codes on unauthenticated WebSocket handshakes.

Start immediately from the CLI:

```bash
npx neopolitan-ai serve --host 127.0.0.1 --port 7420 --token dev-secret --store ./.sessions
```
