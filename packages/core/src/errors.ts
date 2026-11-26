export const MAX_FAILURE_MESSAGE_LENGTH = 4_096;
export const DEFAULT_PROVIDER_RETRY_BUDGET_MS = 600_000;

export type ProviderFailureClass =
  | 'auth'
  | 'rate_limit'
  | 'billing'
  | 'model_unavailable'
  | 'provider_unavailable'
  | 'context_exhausted'
  | 'permission_denied'
  | 'validation_error'
  | 'transport_error'
  | 'unknown';

export interface SanitizedProviderFailure {
  readonly failureClass: ProviderFailureClass;
  readonly retryable: boolean;
  /** Redacted of Bearer tokens, API keys, URL query secrets, and capped at 4096 chars. */
  readonly safeMessage: string;
  readonly guidance?: string;
  readonly retryAfterMs?: number;
}

const SECRET_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly replacement: string }> = [
  { pattern: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\b(?:sk-ant-|sk-proj-|sk-|ghp_|gho_|ghu_|github_pat_|AIza|xai-)[A-Za-z0-9_\-]{10,}\b/g, replacement: '[REDACTED_KEY]' },
  { pattern: /([?&](?:api_key|apikey|token|access_token|secret|key|auth)=)[^&\s]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /(?:x-api-key|authorization)\s*[:=]\s*[^\s,;]+/gi, replacement: '[REDACTED_HEADER]' },
];

/**
 * Scrubs Bearer tokens, API keys, auth headers, and URL query credentials before
 * surfacing provider diagnostics to UIs, logs, or RPC clients.
 */
export function sanitizeProviderFailureMessage(rawMessage: string): string {
  let sanitized = rawMessage;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.trim();
  if (sanitized.length > MAX_FAILURE_MESSAGE_LENGTH) {
    return `${sanitized.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 3)}...`;
  }
  return sanitized;
}

export function classifyProviderFailure(
  rawMessage: string,
  options?: { readonly code?: number | string; readonly statusCode?: number },
): SanitizedProviderFailure {
  const safeMessage = sanitizeProviderFailureMessage(rawMessage);
  const lower = safeMessage.toLowerCase();
  const code = options?.code;
  const status = options?.statusCode;

  if (
    code === -32000 ||
    status === 401 ||
    /\b(unauthorized|unauthenticated|invalid api key|auth required|not logged in|token expired)\b/.test(lower)
  ) {
    return {
      failureClass: 'auth',
      retryable: false,
      safeMessage,
      guidance: 'Re-authenticate or verify your provider credentials.',
    };
  }

  if (
    status === 402 ||
    /\b(insufficient[_\s]quota|billing|payment required|credit balance|out of credits)\b/.test(lower)
  ) {
    return {
      failureClass: 'billing',
      retryable: false,
      safeMessage,
      guidance: 'Check account billing status or switch to an alternate profile.',
    };
  }

  if (
    code === -32003 ||
    code === -31001 ||
    status === 429 ||
    /\b(rate limit|too many requests|quota exceeded|retry after)\b/.test(lower)
  ) {
    return {
      failureClass: 'rate_limit',
      retryable: true,
      safeMessage,
      guidance: 'Wait for rate-limit reset or fail over to another profile/tier.',
    };
  }

  if (/\b(context length|maximum context|token limit|prompt is too long)\b/.test(lower)) {
    return {
      failureClass: 'context_exhausted',
      retryable: false,
      safeMessage,
      guidance: 'Compact the session or start a fresh handoff.',
    };
  }

  if (/\b(model not found|unknown model|unsupported model|model unavailable)\b/.test(lower)) {
    return {
      failureClass: 'model_unavailable',
      retryable: false,
      safeMessage,
    };
  }

  if (
    status === 403 ||
    /\b(permission denied|dangerously-skip-permissions.*root|cannot be used with root)\b/.test(lower)
  ) {
    return {
      failureClass: 'permission_denied',
      retryable: false,
      safeMessage,
    };
  }

  if (code === -32602 || status === 400 || /\b(invalid params|validation error)\b/.test(lower)) {
    return {
      failureClass: 'validation_error',
      retryable: false,
      safeMessage,
    };
  }

  if (
    status === 503 ||
    code === 'ENOENT' ||
    code === 'ECONNREFUSED' ||
    /\b(enoent|econnrefused|epipe|broken pipe|connection closed|process exited|service unavailable)\b/.test(lower)
  ) {
    return {
      failureClass: 'transport_error',
      retryable: true,
      safeMessage,
      guidance: code === 'ENOENT' ? 'Verify the provider CLI binary is installed and on PATH.' : undefined,
    };
  }

  return {
    failureClass: 'unknown',
    retryable: false,
    safeMessage,
  };
}

export class AgentSdkError extends Error {
  readonly code: string;
  readonly failureClass: ProviderFailureClass;
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: {
      readonly code?: string;
      readonly failureClass?: ProviderFailureClass;
      readonly retryable?: boolean;
      readonly cause?: unknown;
    },
  ) {
    super(sanitizeProviderFailureMessage(message), { cause: options?.cause });
    this.name = new.target.name;
    this.code = options?.code ?? 'AGENT_SDK_ERROR';
    this.failureClass = options?.failureClass ?? 'unknown';
    this.retryable = options?.retryable ?? false;
  }
}

export class SandboxDestroyedError extends AgentSdkError {
  readonly runtimeId: string;

  constructor(runtimeId: string, message = `Sandbox runtime "${runtimeId}" has been destroyed`) {
    super(message, { code: 'SANDBOX_DESTROYED', failureClass: 'transport_error', retryable: false });
    this.runtimeId = runtimeId;
  }
}

export class ProviderAuthRequiredError extends AgentSdkError {
  readonly providerId: string;
  readonly signInUrl?: string;

  constructor(
    providerId: string,
    options?: { readonly message?: string; readonly signInUrl?: string; readonly cause?: unknown },
  ) {
    super(options?.message ?? `Authentication required for provider "${providerId}"`, {
      code: 'AUTH_REQUIRED',
      failureClass: 'auth',
      retryable: false,
      cause: options?.cause,
    });
    this.providerId = providerId;
    this.signInUrl = options?.signInUrl;
  }
}

export class ThreadInUseError extends AgentSdkError {
  readonly threadId: string;

  constructor(threadId: string, message = `Thread "${threadId}" already has an active writer`) {
    super(message, { code: 'THREAD_IN_USE', failureClass: 'validation_error', retryable: true });
    this.threadId = threadId;
  }
}
