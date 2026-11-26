import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AuthProfile,
  EncryptedHostFileSecretStore,
  InMemorySecretStore,
  computeClaudeKeychainServiceName,
  resolveInheritedProfile,
  resolveProviderEnv,
  shouldBlockSendForAuthStatus,
} from './index.js';

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('@neopolitan-ai/auth', () => {
  it('seals and unseals secrets with AES-256-GCM host-key store', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-auth-'));
    tempDirs.push(dir);
    const store = new EncryptedHostFileSecretStore(path.join(dir, 'master.key'));

    const sealed = await store.seal('sk-ant-super-secret');
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain('sk-ant-super-secret');
    expect(await store.unseal(sealed)).toBe('sk-ant-super-secret');

    // Compute deterministic NFC keychain name
    const nameA = computeClaudeKeychainServiceName('/Users/dev/.claude-work');
    const nameB = computeClaudeKeychainServiceName('/Users/dev/.claude-work');
    expect(nameA).toMatch(/^Claude Code-credentials-[a-f0-9]{8}$/);
    expect(nameA).toBe(nameB);
  });

  it('routes Bedrock/Vertex/proxy env, matches SpendScopeKey, and fails open on unknown auth', async () => {
    expect(shouldBlockSendForAuthStatus('unauthenticated')).toBe(true);
    expect(shouldBlockSendForAuthStatus('unknown')).toBe(false);
    expect(shouldBlockSendForAuthStatus('unavailable')).toBe(false);

    const store = new EncryptedHostFileSecretStore(
      path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-auth2-')), 'key'),
    );
    const sealed = await store.seal('bedrock-token-xyz');

    const profile: AuthProfile = {
      profileId: 'p1',
      providerId: 'claude-code',
      authKind: 'bedrock',
      runtimeScope: 'host',
      spendScopeKey: { accountId: 'acc-1', orgId: 'org-1' },
      homeOrConfigDir: '/tmp/claude-prof-1',
      sealedSecret: sealed,
      proxyUrl: 'socks5://127.0.0.1:1080',
      noProxy: 'localhost,127.0.0.1',
    };

    const env = await resolveProviderEnv(profile, store);
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(env.AWS_BEARER_TOKEN_BEDROCK).toBe('bedrock-token-xyz');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/claude-prof-1');
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(env.no_proxy).toBe('localhost,127.0.0.1');

    // Go-based glab CLI skips socks proxy vars
    const glabEnv = await resolveProviderEnv(profile, store, { targetBinary: 'glab' });
    expect(glabEnv.HTTP_PROXY).toBeUndefined();

    const matched = resolveInheritedProfile([profile], 'claude-code', {
      accountId: 'acc-1',
      orgId: 'org-1',
    });
    expect(matched?.profileId).toBe('p1');
  });

  it('supports InMemorySecretStore plus OAuth, Vertex, and Codex profile env mapping', async () => {
    const mem = new InMemorySecretStore();
    const sealed = await mem.seal('oauth-tok');
    expect(await mem.unseal(sealed)).toBe('oauth-tok');

    const codexEnv = await resolveProviderEnv(
      {
        profileId: 'cx',
        providerId: 'codex',
        authKind: 'api_key',
        runtimeScope: 'host',
        homeOrConfigDir: '/tmp/codex-home',
        sealedSecret: await mem.seal('sk-proj-test123'),
        baseUrl: 'https://api.example.com/v1',
      },
      mem,
    );
    expect(codexEnv.CODEX_HOME).toBe('/tmp/codex-home');
    expect(codexEnv.OPENAI_API_KEY).toBe('sk-proj-test123');
    expect(codexEnv.OPENAI_BASE_URL).toBe('https://api.example.com/v1');

    const vertexEnv = await resolveProviderEnv(
      {
        profileId: 'vx',
        providerId: 'claude-code',
        authKind: 'vertex',
        runtimeScope: 'host',
      },
      mem,
    );
    expect(vertexEnv.CLAUDE_CODE_USE_VERTEX).toBe('1');
  });
});
