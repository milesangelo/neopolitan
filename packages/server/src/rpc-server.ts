import http from 'node:http';
import type {
  AgentEvent,
  AgentSession,
  GateResponse,
  OpenSessionInput,
  ProviderId,
  SendTurnInput,
  SteerTurnInput,
} from '@neopolitan/core';
import type { EventStore, SessionManager } from '@neopolitan/sessions';
import { type WebSocket, WebSocketServer } from 'ws';

export type RpcMethod =
  | 'session.open'
  | 'session.sendTurn'
  | 'session.steerTurn'
  | 'session.interrupt'
  | 'session.respondToGate'
  | 'session.handoff'
  | 'session.close';

export interface RpcRequestEnvelope {
  readonly id: string | number;
  readonly method: RpcMethod;
  readonly params: Record<string, unknown>;
}

export interface RpcResponseEnvelope {
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

class KeyedLock {
  private readonly chains = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.chains.set(
      key,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export interface AgentRpcServerOptions {
  readonly sessionManager: SessionManager;
  readonly eventStore: EventStore;
  readonly authToken?: string;
}

/**
 * Headless WebSocket + non-blocking reentrant HTTP+SSE RPC server (`t3code` + `sandbox-agent` synthesis):
 * - Serializes per-session commands with `KeyedLock`.
 * - Resolves prompt POSTs immediately after `DispatchReceipt` so interactive `session.respondToGate`
 *   calls never deadlock behind a long-running turn.
 * - Supports `afterSeq` / `Last-Event-ID` cursor replay over both SSE and WS.
 */
export class AgentRpcServer {
  private server?: http.Server;
  private wss?: WebSocketServer;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly lock = new KeyedLock();
  private port?: number;

  constructor(private readonly options: AgentRpcServerOptions) {}

  async listen(listenOptions?: {
    readonly host?: string;
    readonly port?: number;
  }): Promise<{ readonly url: string; readonly wsUrl: string; readonly port: number }> {
    const host = listenOptions?.host ?? '127.0.0.1';
    const port = listenOptions?.port ?? 0;

    this.server = http.createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleWs(ws, req));

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind AgentRpcServer');
    this.port = addr.port;
    return {
      url: `http://${host}:${this.port}`,
      wsUrl: `ws://${host}:${this.port}/ws`,
      port: this.port,
    };
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    if (!this.options.authToken) return true;
    const auth = req.headers.authorization;
    return auth === `Bearer ${this.options.authToken}`;
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthorized(req)) {
      res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname.startsWith('/events/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/events/'.length));
      const headerSeq = req.headers['last-event-id'];
      const querySeq = url.searchParams.get('afterSeq');
      const afterSeq = Number(headerSeq ?? querySeq ?? 0) || 0;

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const ac = new AbortController();
      req.once('close', () => ac.abort());

      try {
        for await (const ev of this.options.eventStore.subscribe(sessionId, afterSeq)) {
          if (ac.signal.aborted || res.writableEnded) break;
          res.write(`id: ${ev.seq}\nevent: agent_event\ndata: ${JSON.stringify(ev)}\n\n`);
        }
      } catch {
        // client disconnected
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/rpc') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      let payload: RpcRequestEnvelope;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcRequestEnvelope;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'BAD_JSON', message: 'Invalid JSON body' } }));
        return;
      }

      const response = await this.dispatch(payload);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    res.writeHead(404).end();
  }

  private handleWs(ws: WebSocket, req: http.IncomingMessage): void {
    if (!this.isAuthorized(req)) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    const subs = new Set<AbortController>();
    ws.on('close', () => {
      for (const ac of subs) ac.abort();
      subs.clear();
    });

    ws.on('message', (data) => {
      void (async () => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        } catch {
          return;
        }

        if (
          parsed.method === 'session.subscribe' &&
          parsed.params &&
          typeof parsed.params === 'object'
        ) {
          const { sessionId, afterSeq = 0 } = parsed.params as {
            sessionId: string;
            afterSeq?: number;
          };
          const ac = new AbortController();
          subs.add(ac);
          if (parsed.id !== undefined) {
            ws.send(JSON.stringify({ id: parsed.id, result: { subscribed: true } }));
          }
          void (async () => {
            for await (const ev of this.options.eventStore.subscribe(sessionId, afterSeq)) {
              if (ac.signal.aborted || ws.readyState !== ws.OPEN) break;
              ws.send(JSON.stringify({ type: 'agent_event', event: ev }));
            }
          })();
          return;
        }

        const response = await this.dispatch(parsed as unknown as RpcRequestEnvelope);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(response));
        }
      })();
    });
  }

  private async dispatch(req: RpcRequestEnvelope): Promise<RpcResponseEnvelope> {
    try {
      const p = req.params ?? {};
      switch (req.method) {
        case 'session.open': {
          const providerId = String(p.providerId) as ProviderId;
          const input = p.input as OpenSessionInput & {
            driverConfig?: Record<string, unknown>;
            profileId?: string;
          };
          const session = await this.options.sessionManager.open(providerId, input);
          this.sessions.set(session.sessionId, session);
          return {
            id: req.id,
            result: {
              sessionId: session.sessionId,
              anchor: session.getAnchor(),
              capabilities: session.capabilities,
            },
          };
        }
        case 'session.sendTurn': {
          const sessionId = String(p.sessionId);
          return this.lock.run(sessionId, async () => {
            const session = this.requireSession(sessionId);
            const receipt = await session.sendTurn(p.input as SendTurnInput);
            return { id: req.id, result: receipt };
          });
        }
        case 'session.steerTurn': {
          const sessionId = String(p.sessionId);
          return this.lock.run(sessionId, async () => {
            const session = this.requireSession(sessionId);
            if (!session.steerTurn) {
              throw new Error(`Session "${sessionId}" does not support steerTurn`);
            }
            const receipt = await session.steerTurn(p.input as SteerTurnInput);
            return { id: req.id, result: receipt };
          });
        }
        case 'session.interrupt': {
          const sessionId = String(p.sessionId);
          const session = this.requireSession(sessionId);
          await session.interruptTurn(typeof p.turnId === 'string' ? p.turnId : undefined);
          return { id: req.id, result: { ok: true } };
        }
        case 'session.respondToGate': {
          const sessionId = String(p.sessionId);
          const session = this.requireSession(sessionId);
          await session.respondToGate(p.response as GateResponse);
          return { id: req.id, result: { ok: true } };
        }
        case 'session.handoff': {
          const sourceSessionId = String(p.sourceSessionId);
          const target = p.target as Parameters<SessionManager['handoff']>[1];
          const res = await this.options.sessionManager.handoff(sourceSessionId, target);
          this.sessions.set(res.session.sessionId, res.session);
          return {
            id: req.id,
            result: {
              sessionId: res.session.sessionId,
              bundle: res.bundle,
            },
          };
        }
        case 'session.close': {
          const sessionId = String(p.sessionId);
          const session = this.sessions.get(sessionId);
          if (session) {
            await session.close();
            this.sessions.delete(sessionId);
          }
          return { id: req.id, result: { ok: true } };
        }
        default:
          return {
            id: req.id,
            error: { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${String(req.method)}` },
          };
      }
    } catch (err) {
      return {
        id: req.id,
        error: {
          code: 'RPC_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private requireSession(sessionId: string): AgentSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Active session "${sessionId}" not found on server`);
    return s;
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.close();
    }
    this.sessions.clear();
    await new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
    await new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server.closeAllConnections?.();
      } else {
        resolve();
      }
    });
  }
}

export type { AgentEvent };
