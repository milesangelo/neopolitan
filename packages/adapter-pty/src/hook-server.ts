import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AgentWireState, Osc7501Status } from './osc7501.js';

export const HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS = 120_000;
export const CLAUDE_PERMISSION_HOLD_BUDGET_MS = 122_000;

export interface HookStatusUpdate {
  readonly state: AgentWireState;
  readonly sessionBoundary?: boolean;
  readonly interrupted?: boolean;
  readonly subagentId?: string;
  readonly turnKey?: string;
  readonly timestamp: number;
}

export interface HostTurnRecord {
  readonly currentTurnKey: string;
  readonly completed?: { readonly turnKey: string; readonly endedAt: number };
}

/**
 * Orca's `reduceHostTurnEnd`: distinguishes definitive `'identified'` turn completions
 * from `'ambiguous'` duplicate/seed stops.
 */
export function reduceHostTurnEnd(
  prev: HostTurnRecord,
  event: {
    readonly kind: 'prompt_submit' | 'stop';
    readonly turnKey?: string;
    readonly stopHookActive?: boolean;
    readonly at: number;
  },
): {
  readonly next: HostTurnRecord;
  readonly disposition?: 'identified' | 'ambiguous';
} {
  if (event.kind === 'prompt_submit') {
    return {
      next: {
        currentTurnKey: event.turnKey ?? `opened:${event.at}`,
        completed: prev.completed,
      },
    };
  }
  const alreadyCompleted = prev.completed?.turnKey === prev.currentTurnKey;
  const identified = Boolean(
    event.stopHookActive || (prev.currentTurnKey !== 'seed' && !alreadyCompleted),
  );
  return {
    next: {
      currentTurnKey: prev.currentTurnKey,
      completed: { turnKey: prev.currentTurnKey, endedAt: event.at },
    },
    disposition: identified ? 'identified' : 'ambiguous',
  };
}

/**
 * Orca's hook-vs-OSC-7501 precedence reducer:
 * - Hooks always win unless silent for > 2 minutes (`HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS`).
 * - Once `done`, OSC 7501 `working`/`waiting` only wins if observed strictly after `doneAt`.
 * - `"hook-agent-*"` subagents are excluded because Claude never emits `SubagentStop` for them.
 */
export function reduceHookAndOscStatus(input: {
  readonly lastHook?: HookStatusUpdate;
  readonly lastOsc?: Osc7501Status;
  readonly doneAt?: number;
  readonly now?: number;
}): { readonly state: AgentWireState; readonly sessionBoundary: boolean } {
  const now = input.now ?? Date.now();
  const hook =
    input.lastHook && !input.lastHook.subagentId?.startsWith('hook-agent-')
      ? input.lastHook
      : undefined;
  const osc = input.lastOsc;

  if (!hook && !osc) {
    return { state: 'done', sessionBoundary: false };
  }
  if (hook && !osc) {
    return { state: hook.state, sessionBoundary: Boolean(hook.sessionBoundary) };
  }
  if (!hook && osc) {
    return { state: osc.state, sessionBoundary: false };
  }

  // Both present
  const h = hook!;
  const o = osc!;
  if (h.state === 'done') {
    const doneAt = input.doneAt ?? h.timestamp;
    if ((o.state === 'working' || o.state === 'waiting') && o.timestamp > doneAt) {
      return { state: o.state, sessionBoundary: false };
    }
    return { state: 'done', sessionBoundary: Boolean(h.sessionBoundary) };
  }

  if (now - h.timestamp > HOOK_SILENCE_BEFORE_PROGRAM_STATUS_FALLBACK_MS) {
    return { state: o.state, sessionBoundary: false };
  }
  return { state: h.state, sessionBoundary: Boolean(h.sessionBoundary) };
}

export interface AgentHookEvent {
  readonly sessionId: string;
  readonly eventName: string;
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly subagentId?: string;
  readonly turnKey?: string;
  readonly holdForPermission?: boolean;
}

export interface AgentHookServerOptions {
  readonly permissionHoldBudgetMs?: number;
  readonly onEvent?: (event: AgentHookEvent) => void;
  readonly onPermissionRequest?: (
    event: AgentHookEvent,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown> | null>;
}

/**
 * Loopback HTTP hook server supporting both fire-and-forget status hooks and
 * Orca-style held `PermissionRequest` HTTP decisions (`122s` hold budget).
 */
export class AgentHookServer {
  private server?: http.Server;
  private port?: number;
  private readonly holdBudgetMs: number;

  constructor(private readonly options: AgentHookServerOptions = {}) {
    this.holdBudgetMs = options.permissionHoldBudgetMs ?? CLAUDE_PERMISSION_HOLD_BUDGET_MS;
  }

  async start(): Promise<{ readonly url: string; readonly port: number }> {
    if (this.server && this.port) {
      return { url: `http://127.0.0.1:${this.port}`, port: this.port };
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind AgentHookServer');
    this.port = addr.port;
    return { url: `http://127.0.0.1:${this.port}`, port: this.port };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let body: Record<string, unknown> = {};
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      res.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const sessionId = String(body.sessionId ?? req.headers['x-session-id'] ?? 'default');
    const eventName = String(body.hook_event_name ?? body.eventName ?? 'Unknown');
    const subagentId = typeof body.agent_id === 'string' ? body.agent_id : undefined;

    // Filter hook-agent-* subagents that never emit SubagentStop
    if (subagentId?.startsWith('hook-agent-')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }

    const holdHeader = req.headers['x-hook-decision'];
    const holdForPermission =
      Boolean(holdHeader) || eventName === 'PermissionRequest';

    const event: AgentHookEvent = {
      sessionId,
      eventName,
      toolName: typeof body.tool_name === 'string' ? body.tool_name : undefined,
      toolInput: body.tool_input,
      subagentId,
      turnKey: typeof body.turn_id === 'string' ? body.turn_id : randomUUID(),
      holdForPermission,
    };

    this.options.onEvent?.(event);

    if (holdForPermission && this.options.onPermissionRequest) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.holdBudgetMs);
      timer.unref?.();
      req.once('close', () => ac.abort());

      try {
        const decision = await this.options.onPermissionRequest(event, ac.signal);
        clearTimeout(timer);
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(decision ?? {}));
        }
      } catch {
        clearTimeout(timer);
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        }
      }
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
      this.server!.closeAllConnections?.();
    });
    this.server = undefined;
    this.port = undefined;
  }
}
