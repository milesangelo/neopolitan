import { type AcpDriverConfig, createAcpDriver } from '@neopolitan-ai/adapter-acp';
import { type ClaudeDriverConfig, createClaudeDriver } from '@neopolitan-ai/adapter-claude';
import { type CodexDriverConfig, createCodexDriver } from '@neopolitan-ai/adapter-codex';
import { type PtyDriverConfig, createPtyDriver } from '@neopolitan-ai/adapter-pty';
import { ProviderRegistry } from '@neopolitan-ai/core';

export * from '@neopolitan-ai/core';
export * from '@neopolitan-ai/runtime-local';
export * from '@neopolitan-ai/adapter-acp';
export * from '@neopolitan-ai/adapter-claude';
export * from '@neopolitan-ai/adapter-codex';
export * from '@neopolitan-ai/adapter-pty';
export * from '@neopolitan-ai/auth';
export * from '@neopolitan-ai/sessions';
export * from '@neopolitan-ai/workspace';
export * from '@neopolitan-ai/orchestration';
export {
  AgentRpcClient,
  AgentRpcServer,
  type AgentRpcClientOptions,
  type AgentRpcServerOptions,
  type RpcMethod,
  type RpcRequestEnvelope,
  type RpcResponseEnvelope,
} from '@neopolitan-ai/server';

export interface DefaultRegistryOptions {
  readonly claude?: ClaudeDriverConfig;
  readonly codex?: CodexDriverConfig;
  readonly acp?: AcpDriverConfig;
  readonly opencode?: AcpDriverConfig;
  readonly antigravity?: AcpDriverConfig;
  readonly gemini?: AcpDriverConfig;
  readonly pty?: PtyDriverConfig;
}

/**
 * Creates a `ProviderRegistry` pre-populated with Neopolitan's built-in adapters
 * (Claude Code, OpenAI Codex, ACP variants for OpenCode/Antigravity/Gemini/generic ACP, and PTY).
 */
export function createDefaultRegistry(options: DefaultRegistryOptions = {}): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry
    .register(createClaudeDriver(options.claude))
    .register(createCodexDriver(options.codex))
    .register(
      createAcpDriver({
        id: 'opencode',
        label: 'OpenCode (ACP)',
        command: 'opencode',
        args: ['acp'],
        flavor: 'opencode',
        ...options.opencode,
      }),
    )
    .register(
      createAcpDriver({
        id: 'antigravity',
        label: 'Antigravity (ACP)',
        command: 'agy',
        args: ['acp'],
        flavor: 'antigravity',
        ...options.antigravity,
      }),
    )
    .register(
      createAcpDriver({
        id: 'gemini',
        label: 'Gemini CLI (ACP)',
        command: 'gemini',
        args: ['--experimental-acp'],
        ...options.gemini,
      }),
    )
    .register(
      createAcpDriver({
        id: 'acp',
        label: 'Generic ACP',
        command: 'acp',
        ...options.acp,
      }),
    )
    .register(
      createPtyDriver(
        options.pty ?? {
          command: 'amp',
        },
      ),
    );
  return registry;
}

/**
 * Convenience alias for `createDefaultRegistry()` to register all built-in drivers.
 */
export const registerBuiltInAdapters = createDefaultRegistry;
