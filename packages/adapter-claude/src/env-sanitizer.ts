export const CLAUDE_AUTH_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const;

export interface ClaudeJsonConfig {
  readonly customApiKeyResponses?: {
    readonly approved?: ReadonlyArray<string>;
    readonly rejected?: ReadonlyArray<string>;
  };
}

/**
 * Splices `prefixArgs` at index 1 when `executablePath` is a JS/TS script (because the SDK
 * prepends Node and places the script at `argv[0]`), or at index 0 for native binaries.
 */
export function splicePrefixArgsForScript(
  executablePath: string,
  args: ReadonlyArray<string>,
  prefixArgs?: ReadonlyArray<string>,
): string[] {
  if (!prefixArgs || prefixArgs.length === 0) return [...args];
  const isScript = /\.(?:js|mjs|cjs|ts|tsx|jsx)$/i.test(executablePath);
  if (isScript && args.length > 0) {
    return [args[0]!, ...prefixArgs, ...args.slice(1)];
  }
  return [...prefixArgs, ...args];
}

/**
 * Strips auth variables & sensitive custom headers (`Authorization`, `x-api-key`) while
 * preserving proxy/base-URL routing (`ANTHROPIC_BASE_URL`, `HTTPS_PROXY`, etc.).
 */
export function scrubClaudeAuthEnv(
  env: Readonly<Record<string, string | undefined>>,
  options?: {
    readonly stripAuthEnv?: boolean;
    readonly configDir?: string;
    readonly platform?: string;
  },
): Record<string, string> {
  const result: Record<string, string> = {};
  const isWin = (options?.platform ?? process.platform) === 'win32';
  const authSet = new Set(CLAUDE_AUTH_ENV_VARS.map((k) => (isWin ? k.toLowerCase() : k)));

  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    const lowerKey = k.toLowerCase();
    const cmpKey = isWin ? lowerKey : k;
    if (lowerKey === 'claude_config_dir') continue; // never leak ambient CLAUDE_CONFIG_DIR
    if (options?.stripAuthEnv && authSet.has(cmpKey)) continue;
    if (
      options?.stripAuthEnv &&
      lowerKey === 'anthropic_custom_headers' &&
      /authorization|x-api-key|api-key|bearer/i.test(v)
    ) {
      continue;
    }
    result[k] = v;
  }

  if (options?.configDir) {
    result.CLAUDE_CONFIG_DIR = options.configDir;
  }
  result.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
  return result;
}

/**
 * Prevents non-interactive Claude (`-p` / SDK) from billing an ambient `ANTHROPIC_API_KEY`
 * that the user explicitly rejected in `~/.claude.json` (`customApiKeyResponses.rejected`).
 */
export function withoutRejectedClaudeApiKey(
  env: Record<string, string>,
  claudeJson?: ClaudeJsonConfig,
): Record<string, string> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || !claudeJson?.customApiKeyResponses) return env;
  const suffix = apiKey.slice(-20);
  const approved = claudeJson.customApiKeyResponses.approved ?? [];
  const rejected = claudeJson.customApiKeyResponses.rejected ?? [];
  if (rejected.includes(suffix) && !approved.includes(suffix)) {
    const copy = { ...env };
    delete copy.ANTHROPIC_API_KEY;
    return copy;
  }
  return env;
}
