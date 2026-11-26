/**
 * Replaces lone UTF-16 surrogates with U+FFFD so `codex app-server` never hangs
 * silently on `turn/start` (discovered in `t3code: packages/effect-codex-app-server`).
 */
export function sanitizeLoneSurrogates(input: string): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!;
        i++;
      } else {
        out += '\ufffd';
        changed = true;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\ufffd';
      changed = true;
    } else {
      out += input[i]!;
    }
  }
  return changed ? out : input;
}

export interface RateLimitWindow {
  readonly windowId: string;
  readonly remainingPercent: number;
  readonly resetsAt?: number;
}

/**
 * Deduplicates identical Codex rate-limit snapshots repeated on every token delta.
 */
export function createRateLimitDeduplicator(): (
  windows: ReadonlyArray<RateLimitWindow>,
) => ReadonlyArray<RateLimitWindow> | null {
  let lastKey = '';
  return (windows) => {
    const key = JSON.stringify(windows);
    if (key === lastKey) return null;
    lastKey = key;
    return windows;
  };
}
