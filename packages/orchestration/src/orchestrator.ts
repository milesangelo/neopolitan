import { randomUUID } from 'node:crypto';
import type { AgentSession, ModelSelection, ProviderId } from '@neopolitan-ai/core';
import type { SessionManager } from '@neopolitan-ai/sessions';

export interface AgentSpawnSpec {
  readonly agentId?: string;
  readonly parentAgentId?: string;
  readonly providerId: ProviderId;
  readonly cwd: string;
  readonly model?: ModelSelection;
  readonly systemPrompt?: string;
  readonly driverConfig?: Record<string, unknown>;
}

export interface AgentHandle {
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly providerId: ProviderId;
  readonly session: AgentSession;
}

export interface AgentMessageEnvelope {
  readonly messageId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly body: string;
  readonly expectReply?: boolean;
  readonly responseId?: string;
  readonly timestamp: number;
}

export interface RoleClaim {
  readonly agentId: string;
  readonly role: string;
  readonly scope: string;
  readonly normalizedKey: string;
}

export interface PeerReviewResult {
  readonly rounds: number;
  readonly approved: boolean;
  readonly authorSummary: string;
  readonly reviewerNotes: string;
}

function normalizeRoleText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Multi-agent orchestrator & A2A broker synthesizing Traycer's A2A control plane
 * (`spawn`, `sendMessage`, `inbox`, `role-claims`, cascade `stop`) and peer-review loops.
 */
export class Orchestrator {
  private readonly agents = new Map<string, AgentHandle>();
  private readonly inboxes = new Map<string, AgentMessageEnvelope[]>();
  private readonly inboxListeners = new Map<string, Set<(msg: AgentMessageEnvelope) => void>>();
  private readonly roleClaims = new Map<string, RoleClaim>();

  constructor(private readonly sessionManager: SessionManager) {}

  async spawnAgent(spec: AgentSpawnSpec, signal?: AbortSignal): Promise<AgentHandle> {
    const agentId = spec.agentId ?? randomUUID();
    const session = await this.sessionManager.open(
      spec.providerId,
      {
        sessionId: agentId,
        cwd: spec.cwd,
        model: spec.model,
        systemPrompt: spec.systemPrompt,
        driverConfig: spec.driverConfig,
      },
      signal,
    );
    const handle: AgentHandle = {
      agentId,
      parentAgentId: spec.parentAgentId,
      providerId: spec.providerId,
      session,
    };
    this.agents.set(agentId, handle);
    return handle;
  }

  listAgents(): ReadonlyArray<AgentHandle> {
    return [...this.agents.values()];
  }

  async sendAgentMessage(input: {
    readonly fromAgentId: string;
    readonly toAgentId: string;
    readonly body: string;
    readonly expectReply?: boolean;
    readonly responseId?: string;
    readonly deliverToSession?: boolean;
  }): Promise<AgentMessageEnvelope> {
    const envelope: AgentMessageEnvelope = {
      messageId: randomUUID(),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      body: input.body,
      expectReply: input.expectReply,
      responseId: input.responseId ?? (input.expectReply ? randomUUID() : undefined),
      timestamp: Date.now(),
    };

    let list = this.inboxes.get(input.toAgentId);
    if (!list) {
      list = [];
      this.inboxes.set(input.toAgentId, list);
    }
    list.push(envelope);
    for (const cb of this.inboxListeners.get(input.toAgentId) ?? []) {
      cb(envelope);
    }

    if (input.deliverToSession) {
      const target = this.agents.get(input.toAgentId);
      if (target) {
        const prompt = envelope.expectReply
          ? `[Message from ${envelope.fromAgentId}, responseId=${envelope.responseId}]\n${envelope.body}`
          : `[Message from ${envelope.fromAgentId}]\n${envelope.body}`;
        await target.session.sendTurn({ prompt });
      }
    }

    return envelope;
  }

  getInbox(agentId: string): ReadonlyArray<AgentMessageEnvelope> {
    return this.inboxes.get(agentId) ?? [];
  }

  subscribeInbox(agentId: string, listener: (msg: AgentMessageEnvelope) => void): () => void {
    let set = this.inboxListeners.get(agentId);
    if (!set) {
      set = new Set();
      this.inboxListeners.set(agentId, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  claimRole(claim: {
    readonly agentId: string;
    readonly role: string;
    readonly scope: string;
  }): { readonly claim: RoleClaim; readonly overlapping: ReadonlyArray<RoleClaim> } {
    const normalizedKey = `${normalizeRoleText(claim.role)}::${normalizeRoleText(claim.scope)}`;
    const overlapping = [...this.roleClaims.values()].filter(
      (c) => c.agentId !== claim.agentId && c.normalizedKey === normalizedKey,
    );
    const full: RoleClaim = {
      agentId: claim.agentId,
      role: claim.role,
      scope: claim.scope,
      normalizedKey,
    };
    this.roleClaims.set(`${claim.agentId}:${normalizedKey}`, full);
    return { claim: full, overlapping };
  }

  async stopAgent(agentId: string, options?: { readonly cascade?: boolean }): Promise<void> {
    const toStop = [agentId];
    if (options?.cascade) {
      for (let i = 0; i < toStop.length; i++) {
        const cur = toStop[i]!;
        for (const agent of this.agents.values()) {
          if (agent.parentAgentId === cur && !toStop.includes(agent.agentId)) {
            toStop.push(agent.agentId);
          }
        }
      }
    }
    for (const id of toStop) {
      const handle = this.agents.get(id);
      if (handle) {
        await handle.session.close();
        this.agents.delete(id);
      }
    }
  }

  async runPeerReviewLoop(input: {
    readonly author: AgentSpawnSpec;
    readonly reviewer: AgentSpawnSpec;
    readonly task: string;
    readonly maxRounds: number;
  }): Promise<PeerReviewResult> {
    const author = await this.spawnAgent(input.author);
    const reviewer = await this.spawnAgent(input.reviewer);

    let lastAuthorText = '';
    let lastReviewerText = '';
    let approved = false;
    let rounds = 0;

    try {
      for (let round = 1; round <= input.maxRounds; round++) {
        rounds = round;
        const authorPrompt =
          round === 1
            ? input.task
            : `Address this review feedback and revise:\n${lastReviewerText}`;

        lastAuthorText = await runSingleTurnText(author.session, authorPrompt);

        const reviewPrompt = `Review the author's output below. Reply starting with "APPROVED:" if acceptable, or list changes needed:\n\n${lastAuthorText}`;
        lastReviewerText = await runSingleTurnText(reviewer.session, reviewPrompt);

        if (/^\s*APPROVED\b/i.test(lastReviewerText)) {
          approved = true;
          break;
        }
      }
    } finally {
      await this.stopAgent(author.agentId);
      await this.stopAgent(reviewer.agentId);
    }

    return {
      rounds,
      approved,
      authorSummary: lastAuthorText,
      reviewerNotes: lastReviewerText,
    };
  }
}

async function runSingleTurnText(session: AgentSession, prompt: string): Promise<string> {
  const ac = new AbortController();
  let text = '';
  const collect = (async () => {
    for await (const ev of session.events({ signal: ac.signal })) {
      if (ev.type === 'assistant.completed') {
        text = ev.text;
      } else if (ev.type === 'assistant.delta') {
        text += ev.text;
      } else if (ev.type === 'turn.completed') {
        ac.abort();
      }
    }
  })();
  await session.sendTurn({ prompt });
  await collect;
  return text;
}
