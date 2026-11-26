import * as acp from '@agentclientprotocol/sdk/unstable';
import { createLfNdjsonFramer } from '@neopolitan/core';

export const ACP_INT32_ID_FLOOR = 2 ** 30;
export const ACP_INT32_ID_MAX = 2_147_483_647;

const SIGN_IN_URL_REGEX = /(https?:\/\/[^\s"'<>]+(?:login|oauth|auth|signin|device)[^\s"'<>]*)/i;

export interface AcpStreamOptions {
  readonly int32IdFloor?: number;
  readonly onSignInUrlDetected?: (url: string) => void;
  readonly onNonJsonLine?: (line: string) => void;
}

/**
 * Wraps raw byte stdout/stdin into a hardened `@agentclientprotocol/sdk` `Stream`:
 * 1. Filters non-JSON stdout noise before `ndJsonStream` so the SDK never echoes `-32700` Parse Error.
 * 2. Detects browser sign-in URLs emitted on stdout (`SignInWatch`) without persisting them in diagnostics.
 * 3. Remaps outbound JSON-RPC request IDs (which `@agentclientprotocol/sdk` starts at `0`)
 *    into `[2^30, 2^31 - 1]` signed Int32 IDs so Kotlin/strict ACP servers accept them cleanly.
 * 4. Normalizes ACP v1 `tool_call` `name: null` and `protocolVersion` quirks cleanly.
 */
export function createHardenedAcpStream(
  stdin: WritableStream<Uint8Array>,
  stdout: ReadableStream<Uint8Array>,
  options?: AcpStreamOptions,
): acp.Stream {
  const idFloor = options?.int32IdFloor ?? ACP_INT32_ID_FLOOR;
  const outboundToWireId = new Map<string | number, number>();
  const wireToOutboundId = new Map<number, string | number>();
  let nextWireId = idFloor;

  const allocWireId = (sdkId: string | number): number => {
    if (typeof sdkId === 'number' && sdkId >= 1 && sdkId <= ACP_INT32_ID_MAX && sdkId >= idFloor) {
      return sdkId;
    }
    const existing = outboundToWireId.get(sdkId);
    if (existing !== undefined) return existing;
    const wireId = nextWireId >= ACP_INT32_ID_MAX ? idFloor : nextWireId++;
    outboundToWireId.set(sdkId, wireId);
    wireToOutboundId.set(wireId, sdkId);
    return wireId;
  };

  // Pre-filter stdout into strictly valid LF-delimited JSON lines
  const filteredStdout = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const framer = createLfNdjsonFramer({
        onJson(value, rawLine) {
          const normalized = normalizeInboundMessage(value, wireToOutboundId);
          const line = normalized === value ? rawLine : JSON.stringify(normalized);
          controller.enqueue(encoder.encode(`${line}\n`));
        },
        onNonJsonLine(line) {
          const urlMatch = SIGN_IN_URL_REGEX.exec(line);
          if (urlMatch?.[1]) {
            options?.onSignInUrlDetected?.(urlMatch[1]);
          }
          options?.onNonJsonLine?.(line);
        },
      });

      const reader = stdout.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) framer.push(value);
        }
        framer.flush();
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const baseStream = acp.ndJsonStream(stdin, filteredStdout);

  const wrappedWritable = new WritableStream<acp.AnyMessage>({
    async write(message) {
      const writer = baseStream.writable.getWriter();
      try {
        const msg = message as unknown as Record<string, unknown>;
        if ('method' in msg && 'id' in msg && msg.id !== undefined && msg.id !== null) {
          const wireId = allocWireId(msg.id as string | number);
          const params = ensureInitializeCompat(msg.method, msg.params);
          await writer.write({ ...msg, id: wireId, params } as unknown as acp.AnyMessage);
        } else {
          await writer.write(message);
        }
      } finally {
        writer.releaseLock();
      }
    },
    async close() {
      await baseStream.writable.close();
    },
    async abort(reason) {
      await baseStream.writable.abort(reason);
    },
  });

  return {
    readable: baseStream.readable,
    writable: wrappedWritable,
  };
}

function ensureInitializeCompat(method: unknown, params: unknown): unknown {
  if (method === 'session/new' && params && typeof params === 'object') {
    const record = params as Record<string, unknown>;
    if (!Array.isArray(record.mcpServers)) {
      return { ...record, mcpServers: [] };
    }
  }
  return params;
}

function normalizeInboundMessage(
  value: unknown,
  wireToOutboundId: Map<number, string | number>,
): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  let mutated = false;
  const copy: Record<string, unknown> = { ...record };

  // Remap response id back to SDK's internal id
  if (!('method' in record) && typeof record.id === 'number') {
    const original = wireToOutboundId.get(record.id);
    if (original !== undefined) {
      wireToOutboundId.delete(record.id);
      copy.id = original;
      mutated = true;
    }
  }

  // Coerce string protocolVersion or Antigravity v2->v1 hybrid initialize response
  if (copy.result && typeof copy.result === 'object') {
    const res = copy.result as Record<string, unknown>;
    if (typeof res.protocolVersion === 'string') {
      const parsed = Number(res.protocolVersion);
      if (Number.isFinite(parsed)) {
        copy.result = { ...res, protocolVersion: parsed };
        mutated = true;
      }
    }
  }

  // Strip `name: null` on v1 `tool_call` / `tool_call_update` so v2 doesn't clear names
  if (copy.method === 'session/update' && copy.params && typeof copy.params === 'object') {
    const params = copy.params as Record<string, unknown>;
    if (params.update && typeof params.update === 'object') {
      const update = params.update as Record<string, unknown>;
      if ('name' in update && update.name === null) {
        const cleanUpdate = { ...update };
        delete cleanUpdate.name;
        copy.params = { ...params, update: cleanUpdate };
        mutated = true;
      }
    }
  }

  return mutated ? copy : value;
}
