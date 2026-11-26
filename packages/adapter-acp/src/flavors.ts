import type { ProviderFailureClass } from '@neopolitan-ai/core';

export interface AcpFlavor {
  readonly id: string;
  readonly promptMeta?: (input: { readonly cwd: string }) => Record<string, unknown>;
  readonly cancelMeta?: () => Record<string, unknown>;
  /** True when `session/request_permission` represents a disguised question (never auto-approve). */
  readonly isDisguisedElicitation?: (params: {
    readonly toolCallId?: string;
    readonly title?: string;
  }) => boolean;
  /** Idle ms after replay notifications for servers like Grok whose `session/load` never replies. */
  readonly sessionLoadIdleMs?: number;
  readonly classifyError?: (code: number, message: string) => ProviderFailureClass | undefined;
  readonly alwaysSetModelOnNewSession?: boolean;
  readonly stripToolEchoPrefix?: boolean;
}

export const defaultAcpFlavor: AcpFlavor = {
  id: 'default',
};

export const antigravityFlavor: AcpFlavor = {
  id: 'antigravity',
  isDisguisedElicitation: ({ toolCallId }) => Boolean(toolCallId?.startsWith('interaction_')),
};

export const grokFlavor: AcpFlavor = {
  id: 'grok',
  sessionLoadIdleMs: 2_000,
  promptMeta: () => ({ clientType: 'extension' }),
  cancelMeta: () => ({ cancelTrigger: 'ctrl_c' }),
  classifyError: (code) => (code === -32003 ? 'rate_limit' : undefined),
};

export const kiroFlavor: AcpFlavor = {
  id: 'kiro',
};

export const opencodeFlavor: AcpFlavor = {
  id: 'opencode',
  classifyError: (code, msg) => {
    if (code === 402 || /billing|credit/i.test(msg)) return 'billing';
    return undefined;
  },
};

export const copilotFlavor: AcpFlavor = {
  id: 'copilot',
  alwaysSetModelOnNewSession: true,
};

export const ompFlavor: AcpFlavor = {
  id: 'omp',
  stripToolEchoPrefix: true,
};

export const piFlavor: AcpFlavor = {
  id: 'pi',
};

const FLAVOR_MAP: Record<string, AcpFlavor> = {
  antigravity: antigravityFlavor,
  agy: antigravityFlavor,
  grok: grokFlavor,
  kiro: kiroFlavor,
  opencode: opencodeFlavor,
  copilot: copilotFlavor,
  omp: ompFlavor,
  pi: piFlavor,
};

export function resolveAcpFlavor(idOrBinary?: string): AcpFlavor {
  if (!idOrBinary) return defaultAcpFlavor;
  const lower = idOrBinary.toLowerCase();
  for (const [key, flavor] of Object.entries(FLAVOR_MAP)) {
    if (lower === key || lower.includes(key)) {
      return flavor;
    }
  }
  return defaultAcpFlavor;
}
