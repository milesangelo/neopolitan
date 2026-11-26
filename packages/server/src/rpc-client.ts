import type {
  AgentEvent,
  DispatchReceipt,
  GateResponse,
  OpenSessionInput,
  ProviderCapabilities,
  ProviderId,
  SendTurnInput,
  SessionAnchor,
} from '@neopolitan-ai/core';
import WebSocket from 'ws';
import type { RpcMethod, RpcResponseEnvelope } from './rpc-server.js';

export interface AgentRpcClientOptions {
  readonly baseUrl: string; // http://... or ws://...
  readonly authToken?: string;
}

export class AgentRpcClient {
  private ws?: WebSocket;
  private nextId = 1;
  private readonly pendingWs = new Map<
    string | number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private readonly seenResponseIds: Array<string | number> = [];
  private readonly seenSet = new Set<string | number>();
  private readonly eventListeners = new Set<(ev: AgentEvent) => void>();

  constructor(private readonly options: AgentRpcClientOptions) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.authToken) {
      h.authorization = `Bearer ${this.options.authToken}`;
    }
    return h;
  }

  async connectWebSocket(): Promise<void> {
    const wsUrl = this.options.baseUrl.startsWith('ws')
      ? this.options.baseUrl
      : `${this.options.baseUrl.replace(/^http/, 'ws')}/ws`;

    const ws = new WebSocket(wsUrl, {
      headers: this.options.authToken
        ? { authorization: `Bearer ${this.options.authToken}` }
        : undefined,
    });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      if (msg.type === 'agent_event' && msg.event) {
        const ev = msg.event as AgentEvent;
        for (const cb of this.eventListeners) cb(ev);
        return;
      }
      if ('id' in msg) {
        const id = msg.id as string | number;
        if (this.seenSet.has(id)) return;
        this.recordSeenId(id);
        const pending = this.pendingWs.get(id);
        if (!pending) return;
        this.pendingWs.delete(id);
        if (msg.error && typeof msg.error === 'object') {
          pending.reject(new Error((msg.error as { message?: string }).message ?? 'RPC error'));
        } else {
          pending.resolve(msg.result);
        }
      }
    });
  }

  private recordSeenId(id: string | number): void {
    this.seenSet.add(id);
    this.seenResponseIds.push(id);
    if (this.seenResponseIds.length > 2_048) {
      const oldest = this.seenResponseIds.shift()!;
      this.seenSet.delete(oldest);
    }
  }

  async call<T = unknown>(
    method: RpcMethod | 'session.subscribe',
    params: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextId++;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return new Promise<T>((resolve, reject) => {
        this.pendingWs.set(id, { resolve: (v) => resolve(v as T), reject });
        this.ws!.send(JSON.stringify({ id, method, params }));
      });
    }

    const res = await fetch(`${this.options.baseUrl}/rpc`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ id, method, params }),
    });
    // Always consume response body so Node undici never leaks connection pool slots
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const env = JSON.parse(text) as RpcResponseEnvelope;
    if (env.error) {
      throw new Error(`${env.error.code}: ${env.error.message}`);
    }
    return env.result as T;
  }

  openSession(
    providerId: ProviderId,
    input: OpenSessionInput & { driverConfig?: Record<string, unknown>; profileId?: string },
  ): Promise<{ sessionId: string; anchor: SessionAnchor; capabilities: ProviderCapabilities }> {
    return this.call('session.open', { providerId, input });
  }

  sendTurn(sessionId: string, input: SendTurnInput): Promise<DispatchReceipt> {
    return this.call('session.sendTurn', { sessionId, input });
  }

  respondToGate(sessionId: string, response: GateResponse): Promise<{ ok: boolean }> {
    return this.call('session.respondToGate', { sessionId, response });
  }

  closeSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.call('session.close', { sessionId });
  }

  async *subscribeEvents(
    sessionId: string,
    options?: { readonly afterSeq?: number; readonly signal?: AbortSignal },
  ): AsyncIterable<AgentEvent> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const queue: AgentEvent[] = [];
      let notify: (() => void) | undefined;
      const listener = (ev: AgentEvent) => {
        if (ev.sessionId !== sessionId) return;
        queue.push(ev);
        notify?.();
        notify = undefined;
      };
      this.eventListeners.add(listener);
      options?.signal?.addEventListener('abort', () => {
        notify?.();
        notify = undefined;
      });
      await this.call('session.subscribe', { sessionId, afterSeq: options?.afterSeq ?? 0 });
      try {
        while (!options?.signal?.aborted) {
          while (queue.length > 0) {
            yield queue.shift()!;
            if (options?.signal?.aborted) return;
          }
          if (options?.signal?.aborted) break;
          await new Promise<void>((r) => {
            notify = r;
          });
        }
      } finally {
        this.eventListeners.delete(listener);
      }
      return;
    }

    let res: Response;
    try {
      res = await fetch(
        `${this.options.baseUrl}/events/${encodeURIComponent(sessionId)}?afterSeq=${options?.afterSeq ?? 0}`,
        { headers: this.headers(), signal: options?.signal },
      );
    } catch (err) {
      if (options?.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      throw err;
    }
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data: ')) {
              yield JSON.parse(line.slice(6)) as AgentEvent;
              if (options?.signal?.aborted) return;
            }
          }
          sep = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      if (options?.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      throw err;
    } finally {
      reader.releaseLock();
    }
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}
