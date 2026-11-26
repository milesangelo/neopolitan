# Security, Auth Isolation & Approval Gating

## GateMiddleware & Disguised Elicitations
`createPolicyGateMiddleware` enforces declarative `PolicyRule` matching (`allow`, `deny`, `ask`), permission presets (`supervised`, `auto_accept_edits`, `auto`, `full_access`), and optional `autoJudge` callbacks while upholding strict safety invariants:
- `kind: 'elicitation'` is **never** auto-approved.
- `isDisguisedElicitation: true` (e.g., Antigravity ACP `interaction_*` permission requests) is **never** auto-approved — even in `full_access` mode.
- `ruleForced: true` requests bypass auto-allow rules and modes and require explicit confirmation.

## Subprocess Environment Scrubbing & Credential Storage
- `LocalExecutionRuntime` strips ambient parent orchestrator session tokens before spawning child CLIs (`stripAgentSessionEnv`).
- `@neopolitan-ai/adapter-claude` scrubs rejected `~/.claude.json` API keys and leaks unless isolated by explicit `AuthProfile` configuration.
- `@neopolitan-ai/auth` provides `EncryptedHostFileSecretStore` (AES-256-GCM host-key sealing) and fail-open auth status checks.

## Failure Sanitization
`redactSecrets()` and `classifyProviderFailure()` scrub `Bearer` tokens, API keys (`sk-ant-*`, `sk-proj-*`, `ghp_*`, `AIza*`, `xai-*`), auth headers, and URL query credentials before surfacing errors to RPC clients or session handoffs.
