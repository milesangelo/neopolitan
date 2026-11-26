export type AgentWireState = 'working' | 'waiting' | 'blocked' | 'done';

export interface Osc7501Status {
  readonly state: AgentWireState;
  readonly timestamp: number;
}

const OSC_7501_REGEX = /\x1b\]7501;([^\x07\x1b]+)(?:\x07|\x1b\\)/g;

/**
 * Parses Program Status Protocol (`OSC 7501`) escape sequences emitted by terminal agents.
 */
export function parseOsc7501Sequences(chunk: string, now = Date.now()): Osc7501Status[] {
  const results: Osc7501Status[] = [];
  for (const match of chunk.matchAll(OSC_7501_REGEX)) {
    const raw = (match[1] ?? '').trim().toLowerCase();
    if (raw === 'working' || raw === 'waiting' || raw === 'blocked' || raw === 'done') {
      results.push({ state: raw, timestamp: now });
    } else if (raw.startsWith('state=')) {
      const val = raw.slice('state='.length);
      if (val === 'working' || val === 'waiting' || val === 'blocked' || val === 'done') {
        results.push({ state: val, timestamp: now });
      }
    }
  }
  return results;
}
