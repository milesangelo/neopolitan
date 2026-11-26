import {
  type ExecutionRuntime,
  type ManagedProcess,
  ThreadInUseError,
  createLfNdjsonFramer,
} from '@neopolitan-ai/core';

export const DEFAULT_CODEX_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_CODEX_HANG_TIMEOUT_MS = 120_000;

export interface CodexRpcConnectionOptions {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly runtime: ExecutionRuntime;
  readonly requestTimeoutMs?: number;
  readonly hangTimeoutMs?: number;
  readonly onNotification?: (method: string, params: unknown) => void;
  readonly onServerRequest?: (
    id: number | string,
    method: string,
    params: unknown,
  ) => Promise<unknown>;
  readonly onHangRetired?: () => void;
}

/**
 * Clean-room NDJSON client for `codex app-server`:
 * - Tracks monotonic frame activity to detect hung shared servers (`hangTimeoutMs`).
 * - Maps JSON-RPC `-32600` `"already has an active writer"` to `ThreadInUseError`.
 * - Safely handles `serverRequest/resolved` cancellation and clean process-tree exit.
 */
export class CodexAppServerClient {
  private proc?: ManagedProcess;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private nextId = 1;
  private frames = 0;
  private closed = false;
  private readonly pending = new Map<
    number | string,
    {
      resolve: (v: unknown) => void;
      reject: (err: unknown) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly pendingServerRequests = new Set<number | string>();

  constructor(private readonly options: CodexRpcConnectionOptions) {}

  async start(signal?: AbortSignal): Promise<void> {
    this.proc = await this.options.runtime.spawn(
      {
        command: this.options.command,
        args: this.options.args ?? ['app-server'],
        cwd: this.options.cwd,
        env: this.options.env,
      },
      signal,
    );
    this.writer = this.proc.stdin.getWriter();
    void this.readLoop();

    await this.request('initialize', {
      clientInfo: { name: '@neopolitan-ai/adapter-codex', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    await this.notify('initialized', {});
  }

  private async readLoop(): Promise<void> {
    if (!this.proc) return;
    const framer = createLfNdjsonFramer({
      onJson: (value) => {
        this.frames++;
        if (!value || typeof value !== 'object') return;
        const msg = value as Record<string, unknown>;

        if ('id' in msg && !('method' in msg)) {
          const id = msg.id as number | string;
          const entry = this.pending.get(id);
          if (!entry) return;
          this.pending.delete(id);
          if (entry.timer) clearTimeout(entry.timer);
          if (msg.error && typeof msg.error === 'object') {
            const errObj = msg.error as { code?: number; message?: string };
            const errMsg = errObj.message ?? 'Codex RPC error';
            if (errObj.code === -32600 && /already has an active writer/i.test(errMsg)) {
              entry.reject(new ThreadInUseError('unknown', errMsg));
            } else {
              entry.reject(new Error(`${errObj.code ?? 'ERR'}: ${errMsg}`));
            }
          } else {
            entry.resolve(msg.result);
          }
          return;
        }

        if ('method' in msg && typeof msg.method === 'string') {
          if ('id' in msg && msg.id !== undefined && msg.id !== null) {
            const reqId = msg.id as number | string;
            this.pendingServerRequests.add(reqId);
            void this.handleServerRequest(reqId, msg.method, msg.params);
          } else {
            if (
              msg.method === 'serverRequest/resolved' &&
              msg.params &&
              typeof msg.params === 'object'
            ) {
              const resolvedId = (msg.params as { id?: number | string }).id;
              if (resolvedId !== undefined) this.pendingServerRequests.delete(resolvedId);
            }
            this.options.onNotification?.(msg.method, msg.params);
          }
        }
      },
    });

    const reader = this.proc.stdout.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) framer.push(value);
      }
      framer.flush();
    } finally {
      this.rejectAllPending(new Error('Codex app-server closed'));
    }
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = this.options.onServerRequest
        ? await this.options.onServerRequest(id, method, params)
        : {};
      if (this.pendingServerRequests.has(id) && !this.closed) {
        this.pendingServerRequests.delete(id);
        await this.writeLine({ id, result });
      }
    } catch (err) {
      this.pendingServerRequests.delete(id);
      if (!this.closed) {
        await this.writeLine({
          id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }

  private async writeLine(payload: unknown): Promise<void> {
    if (!this.writer || this.closed) {
      throw new Error('Codex app-server connection is closed');
    }
    await this.writer.write(this.encoder.encode(`${JSON.stringify(payload)}\n`));
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.writeLine({ method, params });
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_CODEX_REQUEST_TIMEOUT_MS;
    const hangMs = this.options.hangTimeoutMs ?? DEFAULT_CODEX_HANG_TIMEOUT_MS;
    const startFrames = this.frames;

    return new Promise<T>((resolve, reject) => {
      const hangTimer = setTimeout(() => {
        if (this.frames === startFrames && !this.closed) {
          this.pending.delete(id);
          clearTimeout(reqTimer);
          this.options.onHangRetired?.();
          void this.close();
          reject(new Error(`Codex app-server hung for ${hangMs}ms with zero frames on ${method}`));
        }
      }, hangMs);
      hangTimer.unref?.();

      const reqTimer = setTimeout(() => {
        clearTimeout(hangTimer);
        if (this.pending.delete(id)) {
          reject(new Error(`Codex RPC request "${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      reqTimer.unref?.();

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(hangTimer);
          resolve(v as T);
        },
        reject: (err) => {
          clearTimeout(hangTimer);
          reject(err);
        },
        timer: reqTimer,
      });

      this.writeLine({ id, method, params }).catch((err) => {
        clearTimeout(hangTimer);
        clearTimeout(reqTimer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error('Codex app-server closed'));
    try {
      this.writer?.releaseLock();
    } catch {
      // ignore
    }
    await this.proc?.killTree();
  }
}
