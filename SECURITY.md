# Security Policy

## Supported Versions

Security fixes are released on the active `0.x` minor line (`neopolitan` and `@neopolitan-ai/*`).

## Reporting a Vulnerability

Please report suspected vulnerabilities privately using [GitHub Security Advisories](https://github.com/milesangelo/neopolitan/security/advisories/new) rather than opening a public issue. Include reproduction steps, affected package versions, and potential impact.

## Security Model & Threat Boundaries

- **Subprocess Env Isolation:** `LocalExecutionRuntime` strips inherited parent agent/session tokens before spawning child CLIs (`stripAgentSessionEnv`). `@neopolitan-ai/adapter-claude` scrubs ambient/rejected API keys unless configured through an explicit `AuthProfile`.
- **Approval & Elicitation Gating:** `GateMiddleware` never auto-approves `kind: 'elicitation'`, `isDisguisedElicitation: true`, or `ruleForced: true` requests—even under `permissionMode: 'full_access'`.
- **Secret Redaction:** `redactSecrets()` and `classifyProviderFailure()` strip `Bearer` tokens, API keys (`sk-ant-*`, `sk-proj-*`, `ghp_*`, `AIza*`, `xai-*`), auth headers, and query credentials before surfacing failure diagnostics or compiling `HandoffBundle` context preludes.
- **Headless Server Auth:** `AgentRpcServer` enforces Bearer token authentication (`401` HTTP / `4401` WebSocket close) when `authToken` is configured.
- **Automated Supply-Chain Controls:** Pull requests run Biome, CodeQL (`javascript-typescript`), and npm OIDC Trusted Publishing provenance (`--provenance`).
