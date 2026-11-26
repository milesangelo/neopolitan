# Capabilities & Execution Runtimes

Applications can query every capability up front through a Zod-validated manifest (`providerCapabilitiesSchema`), while keeping subprocess spawning abstracted behind `ExecutionRuntime`.

## `ProviderCapabilities` Manifest

Every `ProviderDriver` declares `baseCapabilities`, and each `AgentSession` exposes its effective `capabilities` (`sessions` may narrow driver capabilities when falling back to legacy CLI versions, never widen them):

| Group | Fields |
|---|---|
| **`transport`** | `'acp'` \| `'native-sdk'` \| `'json-rpc'` \| `'http-sse'` \| `'pty-hooks'` |
| **`sessions`** | `resume`, `fork` (`'none'` \| `'tip'` \| `'checkpoint'`), `rollback`, `switchModelInSession`, `switchPermissionModeInSession`, `survivesProcessRestart` |
| **`turns`** | `interrupt`, `steering` (`'none'` \| `'inject'` \| `'queue'` \| `'cancel-and-resend'`), `queuedMessages`, `terminalStatusQuality` (`'strong'` \| `'weak'` \| `'none'`) |
| **`streaming`** | `assistantDeltas`, `reasoningDeltas`, `toolLifecycle`, `toolOutputDeltas`, `planUpdates`, `fileDiffs` |
| **`gating`** | `commandApproval`, `fileChangeApproval`, `structuredElicitation`, `urlElicitation`, `enforcement` (`'provider'` \| `'client-boundary'` \| `'coarse-flags'`) |
| **`context`** | `systemPrompt`, `contextPrelude`, `compact`, `mcpServers` (`'stdio'`, `'http'`, `'acp-bridge'`), `imageAttachments` |
| **`subagents`** | `supported`, `lifecycleEvents`, `stoppable` |

## `ExecutionRuntime` Abstraction

Adapters never call `node:child_process` or `node:fs` directly. They call `deps.runtime`, enabling identical adapter code to run across local hosts, WSL2, SSH tunnels, Docker containers, cloud sandboxes, or deterministic in-memory mocks:

```ts
export interface ExecutionRuntime {
  readonly id: string;
  readonly platform: 'darwin' | 'linux' | 'win32';
  readonly kind: 'local' | 'wsl' | 'ssh' | 'container' | 'cloud-sandbox';
  readonly defaultCwd: string;
  readonly lifecycle?: SandboxLifecycle; // connect(), ensureAlive(), suspend(), destroy()

  spawn(spec: SpawnSpec, signal?: AbortSignal): Promise<ManagedProcess>;
  spawnPty?(spec: PtySpawnSpec, signal?: AbortSignal): Promise<ManagedPty>;
  which(command: string, env?: Readonly<Record<string, string>>): Promise<string | null>;
  realpath(targetPath: string): Promise<string>;
  // plus exists, mkdir, readdir, readFile, writeFile, stat, mapHostPathToRuntime?
}
```

## Built-In Runtimes (`@neopolitan-ai/runtime-local`)

### `LocalExecutionRuntime`
- **Process-tree cleanup:** `killProcessTree` terminates detached process groups (and Windows trees via `/T`), ensuring aborted turns leave zero orphaned child binaries.
- **Bounded redacted stderr tail:** `ManagedProcess.getStderrTail()` continuously taps `stderr` in a 8 KiB ring buffer scrubbed of secrets, even if no stream consumer reads `stderr`.
- **Timeout & `AbortSignal` wiring:** Pre-aborted signals reject before spawning; `spec.timeoutMs` automatically kills stalled commands.

### `WslExecutionRuntime`
Built for Windows desktop/server hosts driving Linux CLIs inside WSL2:
- Converts Windows drive paths (`C:\Users\dev\repo` -> `/mnt/c/Users/dev/repo`) via `windowsPathToWsl()`.
- Builds isolated `buildWslEnv()` forcing `WSL_UTF8=1` and explicitly excluding Windows `PATH`, `HOME`, `TMP`, and `TEMP` from `WSLENV` so host paths do not pollute Linux tools.
- Invokes `wsl.exe -d <distro> --cd <cwd>` cleanly inside `WSL_MAX_COMMAND_LINE_CHARS` bounds.
