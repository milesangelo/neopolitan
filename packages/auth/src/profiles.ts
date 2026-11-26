import type { ProviderId } from '@neopolitan/core';
import type { SecretStore } from './secret-store.js';

export type AuthStatus =
  | 'authenticated'
  | 'configured'
  | 'unauthenticated'
  | 'unknown'
  | 'unavailable';

/**
 * Traycer's fail-open send gating rule: only definitive `'unauthenticated'` blocks send;
 * `'unknown'` and `'unavailable'` fail open so transient probe glitches don't lock the composer.
 */
export function shouldBlockSendForAuthStatus(status: AuthStatus): boolean {
  return status === 'unauthenticated';
}

export interface SpendScopeKey {
  readonly accountId?: string;
  readonly orgId?: string;
  readonly email?: string;
}

export interface AuthProfile {
  readonly profileId: string;
  readonly providerId: ProviderId;
  readonly authKind: 'oauth' | 'api_key' | 'bedrock' | 'vertex' | 'azure' | 'custom_proxy';
  readonly runtimeScope: 'host' | `wsl:${string}`;
  readonly spendScopeKey?: SpendScopeKey;
  readonly homeOrConfigDir?: string;
  readonly sealedSecret?: string;
  readonly baseUrl?: string;
  readonly proxyUrl?: string;
  readonly noProxy?: string;
  readonly envOverrides?: Readonly<Record<string, string>>;
}

/**
 * Matches profiles across machines by provider-stated `SpendScopeKey` (`accountId` + `orgId` or `email`),
 * rather than host-local `profileId` (Traycer `resolveInheritedProfile` pattern).
 */
export function resolveInheritedProfile(
  profiles: ReadonlyArray<AuthProfile>,
  providerId: ProviderId,
  scope?: SpendScopeKey,
): AuthProfile | undefined {
  if (!scope) return undefined;
  return profiles.find((p) => {
    if (p.providerId !== providerId || !p.spendScopeKey) return false;
    if (scope.accountId && p.spendScopeKey.accountId === scope.accountId) {
      return !scope.orgId || p.spendScopeKey.orgId === scope.orgId;
    }
    if (scope.email && p.spendScopeKey.email === scope.email) {
      return true;
    }
    return false;
  });
}

export async function resolveProviderEnv(
  profile: AuthProfile,
  secretStore?: SecretStore,
  options?: { readonly targetBinary?: string },
): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...(profile.envOverrides ?? {}) };

  const secret =
    profile.sealedSecret && secretStore
      ? await secretStore.unseal(profile.sealedSecret)
      : profile.sealedSecret;

  if (profile.providerId === 'claude-code') {
    if (profile.homeOrConfigDir) env.CLAUDE_CONFIG_DIR = profile.homeOrConfigDir;
    if (profile.authKind === 'bedrock') {
      env.CLAUDE_CODE_USE_BEDROCK = '1';
      if (secret) env.AWS_BEARER_TOKEN_BEDROCK = secret;
    } else if (profile.authKind === 'vertex') {
      env.CLAUDE_CODE_USE_VERTEX = '1';
    } else if (profile.authKind === 'oauth' && secret) {
      env.CLAUDE_CODE_OAUTH_TOKEN = secret;
    } else if (secret) {
      env.ANTHROPIC_API_KEY = secret;
    }
    if (profile.baseUrl) env.ANTHROPIC_BASE_URL = profile.baseUrl;
  } else if (profile.providerId === 'codex') {
    if (profile.homeOrConfigDir) env.CODEX_HOME = profile.homeOrConfigDir;
    if (secret) env.OPENAI_API_KEY = secret;
    if (profile.baseUrl) env.OPENAI_BASE_URL = profile.baseUrl;
  } else if (secret) {
    env.API_KEY = secret;
  }

  if (profile.proxyUrl) {
    const isGoSocksIncompatible =
      options?.targetBinary === 'glab' && /^socks(?:4|4a|5)?:/i.test(profile.proxyUrl);
    if (!isGoSocksIncompatible) {
      env.HTTP_PROXY = profile.proxyUrl;
      env.HTTPS_PROXY = profile.proxyUrl;
      env.http_proxy = profile.proxyUrl;
      env.https_proxy = profile.proxyUrl;
    }
  }
  if (profile.noProxy) {
    env.NO_PROXY = profile.noProxy;
    env.no_proxy = profile.noProxy;
  }

  return env;
}
