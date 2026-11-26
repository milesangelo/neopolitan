import type { PermissionMode } from './types.js';

export interface ElicitationField {
  readonly key: string;
  readonly label: string;
  readonly type: 'string' | 'boolean' | 'select' | 'multiselect';
  readonly required?: boolean;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly defaultValue?: unknown;
}

export type ApprovalCategory =
  | 'command'
  | 'file_write'
  | 'file_read'
  | 'patch'
  | 'mcp_tool'
  | 'network'
  | 'other';

export type GateRequest =
  | {
      readonly kind: 'approval';
      readonly requestId: string;
      readonly category: ApprovalCategory;
      readonly title: string;
      readonly command?: string;
      readonly paths?: ReadonlyArray<string>;
      readonly rawInput?: unknown;
      /**
       * True when a provider (e.g. Antigravity formless ACP) disguises a user question
       * inside `session/request_permission`. Must NEVER be auto-approved.
       */
      readonly isDisguisedElicitation?: boolean;
      readonly cautious?: boolean;
      readonly ruleForced?: boolean;
      readonly originatingSubagentId?: string;
    }
  | {
      readonly kind: 'elicitation';
      readonly requestId: string;
      readonly mode: 'form' | 'url';
      readonly prompt: string;
      readonly fields?: ReadonlyArray<ElicitationField>;
      readonly url?: string;
      /** URL consents and sensitive prompts cannot be delegated to another agent. */
      readonly personOnly?: boolean;
    };

export type GateResolution =
  | {
      readonly decision: 'allow_once' | 'allow_session' | 'deny' | 'cancelled';
      readonly feedback?: string;
      readonly source: 'policy' | 'auto_judge' | 'user' | 'timeout';
    }
  | {
      readonly decision: 'answered';
      readonly answers: Readonly<Record<string, unknown>>;
      readonly source: 'user';
    }
  | {
      readonly decision: 'skipped';
      readonly source: 'user' | 'timeout';
    };

export interface GateResponse {
  readonly requestId: string;
  readonly resolution: GateResolution;
}

export interface PolicyRule {
  readonly id: string;
  readonly match: {
    readonly category?: GateRequest['kind'] | ApprovalCategory;
    readonly toolPattern?: string;
    readonly commandPattern?: string;
    readonly pathGlob?: string;
  };
  readonly action: 'allow' | 'deny' | 'ask';
  readonly reason?: string;
}

export interface GateEvaluationContext {
  readonly mode: PermissionMode;
  readonly cwd: string;
  readonly sessionId: string;
}

export interface GateMiddleware {
  evaluate(
    request: GateRequest,
    context: GateEvaluationContext,
    interactiveHandler: (req: GateRequest, signal?: AbortSignal) => Promise<GateResolution>,
    signal?: AbortSignal,
  ): Promise<GateResolution>;
}

function globToRegex(pattern: string, pathAware = false): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = pathAware
    ? escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
    : escaped.replace(/\*/g, '.*');
  return new RegExp(`^${body}$`);
}

function matchesRule(rule: PolicyRule, request: GateRequest): boolean {
  const { match } = rule;
  if (request.kind === 'elicitation') {
    return match.category === 'elicitation';
  }
  if (match.category && match.category !== 'approval' && match.category !== request.category) {
    return false;
  }
  if (match.toolPattern && !globToRegex(match.toolPattern, false).test(request.title)) {
    return false;
  }
  if (match.commandPattern) {
    if (!request.command || !globToRegex(match.commandPattern, false).test(request.command)) {
      return false;
    }
  }
  if (match.pathGlob) {
    const regex = globToRegex(match.pathGlob, true);
    if (!request.paths || !request.paths.some((p) => regex.test(p))) {
      return false;
    }
  }
  return true;
}

export interface PolicyGateOptions {
  readonly rules?: ReadonlyArray<PolicyRule>;
  readonly autoJudge?: (
    request: Extract<GateRequest, { readonly kind: 'approval' }>,
    context: GateEvaluationContext,
    signal?: AbortSignal,
  ) => Promise<'allow' | 'deny' | 'escalate'>;
}

/**
 * Evaluates declarative allow/deny/ask rules, mode presets (`full_access`, `auto_accept_edits`,
 * `auto`, `supervised`), and optional auto-judge classifiers before delegating to the
 * interactive handler. Never auto-approves `isDisguisedElicitation`, `ruleForced`, or `elicitation`.
 */
export function createPolicyGateMiddleware(options?: PolicyGateOptions): GateMiddleware {
  const rules = options?.rules ?? [];

  return {
    async evaluate(request, context, interactiveHandler, signal) {
      if (request.kind === 'elicitation') {
        return interactiveHandler(request, signal);
      }

      if (request.isDisguisedElicitation) {
        return interactiveHandler(request, signal);
      }

      for (const rule of rules) {
        if (!matchesRule(rule, request)) continue;
        if (rule.action === 'allow' && !request.ruleForced) {
          return { decision: 'allow_once', source: 'policy' };
        }
        if (rule.action === 'deny') {
          return { decision: 'deny', feedback: rule.reason, source: 'policy' };
        }
        if (rule.action === 'ask') {
          return interactiveHandler(request, signal);
        }
      }

      if (context.mode === 'full_access' && !request.ruleForced) {
        return { decision: 'allow_once', source: 'policy' };
      }

      if (
        context.mode === 'auto_accept_edits' &&
        !request.ruleForced &&
        (request.category === 'file_write' || request.category === 'file_read' || request.category === 'patch')
      ) {
        return { decision: 'allow_once', source: 'policy' };
      }

      if (context.mode === 'auto' && !request.ruleForced && options?.autoJudge) {
        const verdict = await options.autoJudge(request, context, signal);
        if (verdict === 'allow') {
          return { decision: 'allow_once', source: 'auto_judge' };
        }
        if (verdict === 'deny') {
          return { decision: 'deny', source: 'auto_judge' };
        }
      }

      return interactiveHandler(request, signal);
    },
  };
}
