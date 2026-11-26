# Auth, Credential Sealing & Env Isolation

Multi-provider coding applications routinely juggle OAuth logins, API keys, Bedrock/Vertex configs, corporate proxies, and concurrent subprocesses. Ambient credential leakage between accounts or parent orchestrators is one of the sharpest production bugs.

`@neopolitan-ai/auth` and `@neopolitan-ai/runtime-local` isolate every subprocess deterministically.

## Encrypted & In-Memory `SecretStore`

```ts
import { EncryptedHostFileSecretStore, InMemorySecretStore } from '@neopolitan-ai/auth';

// Ephemeral tests / stateless workers
const mem = new InMemorySecretStore();

// Host-persisted AES-256-GCM sealing backed by a master key file
const hostStore = new EncryptedHostFileSecretStore('/var/lib/my-app/master.key');
const sealed = await hostStore.seal('sk-ant-...');
const plaintext = await hostStore.unseal(sealed);
```

- `computeClaudeKeychainServiceName(configDir?)` computes the deterministic NFC SHA-256 macOS keychain suffix (`Claude Code-credentials-<hash>`) when isolating per-profile Claude config directories.

## `AuthProfile`, `SpendScopeKey` & Cross-Machine Inheritance

An `AuthProfile` captures `authKind` (`oauth`, `api_key`, `bedrock`, `vertex`, `azure`, `custom_proxy`), `runtimeScope` (`host` or `wsl:<distro>`), optional `homeOrConfigDir`, `baseUrl`, `proxyUrl`/`noProxy`, and `spendScopeKey` (`{ accountId?, orgId?, email? }`).

- **`resolveInheritedProfile(profiles, providerId, scope)`** matches profiles across machines by provider-stated `SpendScopeKey` (`accountId` + `orgId`, or `email`) instead of fragile host-local IDs.
- **`resolveProviderEnv(profile, secretStore, { targetBinary })`** resolves target environment variables:
  - Maps Claude `bedrock` (`CLAUDE_CODE_USE_BEDROCK=1`, `AWS_BEARER_TOKEN_BEDROCK`), `vertex` (`CLAUDE_CODE_USE_VERTEX=1`), `oauth` (`CLAUDE_CODE_OAUTH_TOKEN`), `api_key` (`ANTHROPIC_API_KEY`), `CLAUDE_CONFIG_DIR`, and `ANTHROPIC_BASE_URL`.
  - Maps Codex `CODEX_HOME`, `OPENAI_API_KEY`, and `OPENAI_BASE_URL`.
  - Sets `HTTP_PROXY`/`HTTPS_PROXY` and `NO_PROXY`/`no_proxy` — **automatically skipping `socks*` proxy vars when `targetBinary === 'glab'`** because Go's HTTP stack rejects SOCKS env schemes in `glab`.

## Fail-Open Auth Gating (`shouldBlockSendForAuthStatus`)

Probing external CLIs can occasionally return `'unknown'` or `'unavailable'` due to transient shell timeouts. Neopolitan follows a strict **fail-open** UX rule:

- Only definitive `'unauthenticated'` returns `true` (blocking turn dispatch).
- `'authenticated'`, `'configured'`, `'unknown'`, and `'unavailable'` return `false` so transient probe glitches never lock up your user's composer.

## Subprocess Environment Scrubbing

- **`stripAgentSessionEnv()` (`@neopolitan-ai/runtime-local`):** Automatically strips nested parent orchestrator/token variables (e.g., `ORCA_TOKEN`, `T3_SESSION`, `CLAUDECODE`) before spawning any child process.
- **`scrubClaudeAuthEnv()` & `withoutRejectedClaudeApiKey()` (`@neopolitan-ai/adapter-claude`):** Strips ambient `ANTHROPIC_API_KEY` / `ANTHROPIC_CUSTOM_HEADERS` (case-insensitively on macOS/Windows) unless explicitly opted into, and filters keys whose trailing 20 characters appear in `~/.claude.json`'s `customApiKeyResponses.rejected` list.
