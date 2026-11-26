import type { z } from 'zod';
import type { AgentEvent } from './events.js';
import type { GateMiddleware, GateResponse } from './gate.js';
import type { ExecutionRuntime } from './runtime.js';
import type {
  DispatchReceipt,
  ForkSessionInput,
  McpServerConfig,
  ModelSelection,
  OpenSessionInput,
  OptionsDiscoveryPatch,
  PermissionMode,
  ProbeContext,
  ProviderCapabilities,
  ProviderId,
  ProviderProbeResult,
  ReviewTarget,
  RollbackTarget,
  SendTurnInput,
  SessionAnchor,
  SteerTurnInput,
} from './types.js';

export interface AdapterDependencies {
  readonly runtime: ExecutionRuntime;
  readonly gateMiddleware?: GateMiddleware;
  readonly interactiveGateHandler?: (
    request: import('./gate.js').GateRequest,
    signal?: AbortSignal,
  ) => Promise<import('./gate.js').GateResolution>;
}

export interface AgentSession<TProviderOptions = Record<string, unknown>> extends AsyncDisposable {
  readonly sessionId: string;
  readonly providerSessionId?: string;
  /** Session may narrow driver capabilities (e.g. legacy format), never widen them. */
  readonly capabilities: ProviderCapabilities;

  events(options?: {
    readonly includeRaw?: boolean;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<AgentEvent>;

  sendTurn(
    input: SendTurnInput<TProviderOptions>,
    signal?: AbortSignal,
  ): Promise<DispatchReceipt>;

  steerTurn?(
    input: SteerTurnInput<TProviderOptions>,
    signal?: AbortSignal,
  ): Promise<DispatchReceipt>;

  runReview?(target: ReviewTarget, signal?: AbortSignal): Promise<DispatchReceipt>;

  interruptTurn(turnId?: string, signal?: AbortSignal): Promise<void>;
  respondToGate(response: GateResponse, signal?: AbortSignal): Promise<void>;

  setModel?(model: ModelSelection, signal?: AbortSignal): Promise<void>;
  setPermissionMode?(mode: PermissionMode, signal?: AbortSignal): Promise<void>;
  compact?(instructions?: string, signal?: AbortSignal): Promise<void>;
  fork?(input?: ForkSessionInput, signal?: AbortSignal): Promise<SessionAnchor>;
  rollback?(target: RollbackTarget, signal?: AbortSignal): Promise<void>;
  confirmIdle?(signal?: AbortSignal): Promise<'idle' | 'busy' | 'unknown'>;

  getAnchor(): SessionAnchor;
  close(reason?: string): Promise<void>;
}

export interface ProviderAdapter<TProviderOptions = Record<string, unknown>> {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  prepareWorkspace?(
    input: { readonly cwd: string; readonly mcpServers?: ReadonlyArray<McpServerConfig> },
    signal?: AbortSignal,
  ): Promise<void>;

  openSession(
    input: OpenSessionInput<TProviderOptions>,
    signal?: AbortSignal,
  ): Promise<AgentSession<TProviderOptions>>;
}

export interface ProviderDriver<
  TConfig = Record<string, unknown>,
  TProviderOptions = Record<string, unknown>,
> {
  readonly id: ProviderId;
  readonly label: string;
  readonly configSchema: z.ZodType<TConfig>;
  readonly optionsSchema?: z.ZodType<TProviderOptions>;
  readonly baseCapabilities: ProviderCapabilities;

  probe(ctx: ProbeContext, runtime: ExecutionRuntime): Promise<ProviderProbeResult>;
  discoverOptions?(
    ctx: ProbeContext & { readonly disableMcpOnProbe?: boolean },
    runtime: ExecutionRuntime,
    signal?: AbortSignal,
  ): AsyncIterable<OptionsDiscoveryPatch>;

  createAdapter(
    config: TConfig,
    deps: AdapterDependencies,
  ): Promise<ProviderAdapter<TProviderOptions>>;
}

/**
 * Registry holding ProviderDrivers keyed by ProviderId so applications can register
 * built-in and custom adapters uniformly.
 */
export class ProviderRegistry {
  private readonly drivers = new Map<ProviderId, ProviderDriver<any, any>>();

  register<TConfig, TOptions>(driver: ProviderDriver<TConfig, TOptions>): this {
    this.drivers.set(driver.id, driver);
    return this;
  }

  get(id: ProviderId): ProviderDriver | undefined {
    return this.drivers.get(id);
  }

  require(id: ProviderId): ProviderDriver {
    const driver = this.drivers.get(id);
    if (!driver) {
      throw new Error(`No provider driver registered for "${id}"`);
    }
    return driver;
  }

  list(): ReadonlyArray<ProviderDriver> {
    return [...this.drivers.values()];
  }
}
