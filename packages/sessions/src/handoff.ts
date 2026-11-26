import { randomUUID } from 'node:crypto';
import type {
  AdapterDependencies,
  AgentEvent,
  AgentSession,
  ModelSelection,
  OpenSessionInput,
  ProviderId,
  ProviderRegistry,
  SessionAnchor,
} from '@neopolitan/core';
import type { EventStore, SessionSnapshot } from './event-store.js';

export const DEFAULT_HANDOFF_TOKEN_CAP = 16_000;

export interface HandoffBundle {
  readonly sourceSessionId: string;
  readonly sourceProvider: ProviderId;
  readonly targetProvider: ProviderId;
  readonly strategy: 'native-resume' | 'native-fork' | 'compiled-prelude';
  readonly nativeAnchor?: SessionAnchor;
  readonly compiledPrelude?: {
    readonly coveredUntilSeq: number;
    readonly summaryMarkdown: string;
    readonly recentTurnsMarkdown: string;
    readonly gitStatusSummary?: string;
    readonly estimatedTokens: number;
  };
}

export interface HandoffSummarizer {
  summarize(
    input: {
      readonly events: ReadonlyArray<AgentEvent>;
      readonly gitDiff?: string;
      readonly maxTokens: number;
    },
    signal?: AbortSignal,
  ): Promise<string>;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compiles a hybrid handoff bundle (`t3code` handoffBudget + `traycer` coveredUntilMessageId/contextPrelude):
 * - Same provider + same workspace/profile uses native resume/fork (`native-resume`).
 * - Cross-provider / changed workspace/profile compiles canonical events + git diff within `tokenBudget`.
 */
export async function compileHandoffBundle(input: {
  readonly sourceSnapshot: SessionSnapshot;
  readonly events: ReadonlyArray<AgentEvent>;
  readonly targetProvider: ProviderId;
  readonly targetCwd: string;
  readonly targetProfileId?: string;
  readonly tokenBudget?: number;
  readonly gitDiff?: string;
  readonly summarizer?: HandoffSummarizer;
  readonly signal?: AbortSignal;
}): Promise<HandoffBundle> {
  const sameProvider = input.sourceSnapshot.providerId === input.targetProvider;
  const sameWorkspace = input.sourceSnapshot.cwd === input.targetCwd;
  const sameProfile = input.sourceSnapshot.profileId === input.targetProfileId;

  if (sameProvider && sameWorkspace && sameProfile) {
    return {
      sourceSessionId: input.sourceSnapshot.sessionId,
      sourceProvider: input.sourceSnapshot.providerId,
      targetProvider: input.targetProvider,
      strategy: 'native-resume',
      nativeAnchor: input.sourceSnapshot.anchor,
    };
  }

  const maxTokens = input.tokenBudget ?? DEFAULT_HANDOFF_TOKEN_CAP;
  const maxChars = maxTokens * 4;
  const coveredUntilSeq = input.events.reduce((m, e) => Math.max(m, e.seq), 0);

  let summaryMarkdown = '';
  if (input.summarizer) {
    summaryMarkdown = await input.summarizer.summarize(
      { events: input.events, gitDiff: input.gitDiff, maxTokens: Math.floor(maxTokens * 0.5) },
      input.signal,
    );
  }

  const turnLines: string[] = [];
  for (const ev of input.events) {
    if (ev.type === 'assistant.completed') {
      turnLines.push(`[Assistant] ${ev.text}`);
    } else if (ev.type === 'tool.completed') {
      turnLines.push(`[Tool:${ev.callId}] status=${ev.status}`);
    } else if (ev.type === 'plan.updated') {
      turnLines.push(
        `[Plan]\n${ev.todos.map((t) => `- [${t.status}] ${t.title}`).join('\n')}`,
      );
    }
  }

  let recentTurnsMarkdown = turnLines.join('\n\n');
  if (recentTurnsMarkdown.length > Math.floor(maxChars * 0.6)) {
    recentTurnsMarkdown = recentTurnsMarkdown.slice(-Math.floor(maxChars * 0.6));
  }

  const gitStatusSummary = input.gitDiff
    ? input.gitDiff.slice(0, Math.floor(maxChars * 0.25))
    : undefined;

  const combined = [summaryMarkdown, recentTurnsMarkdown, gitStatusSummary]
    .filter(Boolean)
    .join('\n\n');

  return {
    sourceSessionId: input.sourceSnapshot.sessionId,
    sourceProvider: input.sourceSnapshot.providerId,
    targetProvider: input.targetProvider,
    strategy: 'compiled-prelude',
    compiledPrelude: {
      coveredUntilSeq,
      summaryMarkdown: summaryMarkdown || `Handoff from ${input.sourceSnapshot.providerId} (seq <= ${coveredUntilSeq})`,
      recentTurnsMarkdown,
      gitStatusSummary,
      estimatedTokens: estimateTokens(combined),
    },
  };
}

export class SessionManager {
  private readonly activeSessions = new Map<string, AgentSession>();
  private readonly pumpPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly store: EventStore,
    private readonly deps: AdapterDependencies,
  ) {}

  async open(
    providerId: ProviderId,
    input: OpenSessionInput & { readonly driverConfig?: Record<string, unknown>; readonly profileId?: string },
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    const driver = this.registry.require(providerId);
    const adapter = await driver.createAdapter(input.driverConfig ?? {}, this.deps);
    const sessionId = input.sessionId ?? randomUUID();
    const session = await adapter.openSession({ ...input, sessionId }, signal);
    this.activeSessions.set(sessionId, session);

    await this.store.saveSnapshot({
      sessionId,
      providerId,
      cwd: input.cwd,
      anchor: session.getAnchor(),
      profileId: input.profileId,
      lastSeq: 0,
      updatedAt: Date.now(),
    });

    const pump = this.pumpEvents(sessionId, providerId, input.cwd, input.profileId, session).finally(
      () => {
        this.pumpPromises.delete(sessionId);
      },
    );
    this.pumpPromises.set(sessionId, pump);
    return session;
  }

  async waitForFlush(sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.pumpPromises.get(sessionId);
      return;
    }
    await Promise.all([...this.pumpPromises.values()]);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.activeSessions.values()].map((s) => s.close()));
    await this.waitForFlush();
  }

  private async pumpEvents(
    sessionId: string,
    providerId: ProviderId,
    cwd: string,
    profileId: string | undefined,
    session: AgentSession,
  ): Promise<void> {
    let lastSeq = 0;
    for await (const ev of session.events()) {
      lastSeq = Math.max(lastSeq, ev.seq);
      await this.store.append(sessionId, [ev]);
      if (ev.type === 'turn.completed' || ev.type === 'session.started') {
        await this.store.saveSnapshot({
          sessionId,
          providerId,
          cwd,
          anchor: session.getAnchor(),
          profileId,
          lastSeq,
          updatedAt: Date.now(),
        });
      }
    }
    this.activeSessions.delete(sessionId);
  }

  async resume(sessionId: string, signal?: AbortSignal): Promise<AgentSession> {
    const active = this.activeSessions.get(sessionId);
    if (active) return active;

    const snap = await this.store.loadSnapshot(sessionId);
    if (!snap) throw new Error(`Session "${sessionId}" not found in EventStore`);

    return this.open(
      snap.providerId,
      {
        sessionId: snap.sessionId,
        cwd: snap.cwd,
        resumeAnchor: snap.anchor,
        profileId: snap.profileId,
      },
      signal,
    );
  }

  async handoff(
    sourceSessionId: string,
    target: {
      readonly providerId: ProviderId;
      readonly model?: ModelSelection;
      readonly profileId?: string;
      readonly cwd?: string;
      readonly driverConfig?: Record<string, unknown>;
    },
    options?: {
      readonly tokenBudget?: number;
      readonly summarizer?: HandoffSummarizer;
      readonly gitDiff?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ readonly session: AgentSession; readonly bundle: HandoffBundle }> {
    const snap = await this.store.loadSnapshot(sourceSessionId);
    if (!snap) throw new Error(`Source session "${sourceSessionId}" not found`);
    const events = await this.store.read(sourceSessionId);
    const targetCwd = target.cwd ?? snap.cwd;

    const bundle = await compileHandoffBundle({
      sourceSnapshot: snap,
      events,
      targetProvider: target.providerId,
      targetCwd,
      targetProfileId: target.profileId,
      tokenBudget: options?.tokenBudget,
      gitDiff: options?.gitDiff,
      summarizer: options?.summarizer,
      signal,
    });

    const contextPrelude = bundle.compiledPrelude
      ? [
          `# Cross-Provider Context Handoff (${bundle.sourceProvider} -> ${bundle.targetProvider})`,
          bundle.compiledPrelude.summaryMarkdown,
          bundle.compiledPrelude.recentTurnsMarkdown,
          bundle.compiledPrelude.gitStatusSummary
            ? `## Git Diff\n\`\`\`diff\n${bundle.compiledPrelude.gitStatusSummary}\n\`\`\``
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : undefined;

    const session = await this.open(
      target.providerId,
      {
        cwd: targetCwd,
        model: target.model,
        profileId: target.profileId,
        driverConfig: target.driverConfig,
        resumeAnchor: bundle.nativeAnchor,
        contextPrelude,
      },
      signal,
    );

    return { session, bundle };
  }
}
