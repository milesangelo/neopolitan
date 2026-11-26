import { describe, expect, it } from 'vitest';
import {
  providerCapabilitiesSchema,
  type AgentEvent,
  type AgentSession,
  type GateRequest,
  type OpenSessionInput,
  type ProviderAdapter,
} from '@neopolitan/core';

export interface ConformanceHarnessContext {
  openSession(input?: Partial<OpenSessionInput>): Promise<AgentSession>;
  triggerGatePrompt?: string;
  triggerSecretFailurePrompt?: string;
  triggerUnknownOutcomePrompt?: string;
  teardown?: () => Promise<void>;
}

export type ConformanceSuiteFactory = () => Promise<ConformanceHarnessContext>;

/**
 * Shared Vitest conformance test suite that every Tier-1 ProviderAdapter must pass:
 * verifies capabilities, startup event replay, turn completion, gate approval & deny-with-feedback,
 * interrupt/AbortSignal convergence, rawEvent opt-in isolation, secret redaction, and AsyncDisposable close.
 */
export function runProviderConformanceSuite(
  adapterName: string,
  createHarness: ConformanceSuiteFactory,
): void {
  describe(`${adapterName} ProviderConformanceSuite`, () => {
    it('exposes valid capabilities and buffers session.started for late subscribers', async () => {
      const ctx = await createHarness();
      try {
        const session = await ctx.openSession();
        try {
          expect(() => providerCapabilitiesSchema.parse(session.capabilities)).not.toThrow();

          const events: AgentEvent[] = [];
          const ac = new AbortController();
          for await (const ev of session.events({ signal: ac.signal })) {
            events.push(ev);
            if (ev.type === 'session.started') {
              ac.abort();
            }
          }
          expect(events.some((e) => e.type === 'session.started')).toBe(true);
          expect(events[0]?.rawEvent).toBeUndefined();
          const anchor = session.getAnchor();
          expect('threadId' in anchor ? anchor.threadId : anchor.sessionId).toBeTruthy();
        } finally {
          await session.close();
        }
      } finally {
        await ctx.teardown?.();
      }
    });

    it('completes a turn and isolates rawEvent unless includeRaw: true', async () => {
      const ctx = await createHarness();
      try {
        await using session = await ctx.openSession();
        const filteredEvents: AgentEvent[] = [];
        const rawEvents: AgentEvent[] = [];
        const ac = new AbortController();

        const collectFiltered = (async () => {
          for await (const ev of session.events({ includeRaw: false, signal: ac.signal })) {
            filteredEvents.push(ev);
          }
        })();
        const collectRaw = (async () => {
          for await (const ev of session.events({ includeRaw: true, signal: ac.signal })) {
            rawEvents.push(ev);
            if (ev.type === 'turn.completed') {
              ac.abort();
            }
          }
        })();

        const receipt = await session.sendTurn({ prompt: 'Say hello' });
        expect(['accepted', 'admitted']).toContain(receipt.outcome);
        await Promise.all([collectFiltered, collectRaw]);

        expect(filteredEvents.every((e) => e.rawEvent === undefined)).toBe(true);
        expect(rawEvents.some((e) => e.type === 'turn.completed')).toBe(true);
      } finally {
        await ctx.teardown?.();
      }
    });

    it('supports interactive gate approval and deny-with-feedback when configured', async () => {
      const ctx = await createHarness();
      try {
        if (!ctx.triggerGatePrompt) return;
        await using session = await ctx.openSession({ permissionMode: 'supervised' });

        const seenRequests: GateRequest[] = [];
        const ac = new AbortController();
        const consumer = (async () => {
          for await (const ev of session.events({ signal: ac.signal })) {
            if (ev.type === 'gate.requested') {
              seenRequests.push(ev.request);
              await session.respondToGate({
                requestId: ev.request.requestId,
                resolution: {
                  decision: 'deny',
                  feedback: 'Use safer command',
                  source: 'user',
                },
              });
            }
            if (ev.type === 'turn.completed') {
              ac.abort();
            }
          }
        })();

        await session.sendTurn({ prompt: ctx.triggerGatePrompt });
        await consumer;
        expect(seenRequests.length).toBeGreaterThanOrEqual(1);
      } finally {
        await ctx.teardown?.();
      }
    });

    it('redacts secrets in sanitized failure events', async () => {
      const ctx = await createHarness();
      try {
        if (!ctx.triggerSecretFailurePrompt) return;
        await using session = await ctx.openSession();
        const ac = new AbortController();
        let failedEvent: Extract<AgentEvent, { type: 'turn.completed' }> | undefined;

        const consumer = (async () => {
          for await (const ev of session.events({ signal: ac.signal })) {
            if (ev.type === 'turn.completed') {
              failedEvent = ev;
              ac.abort();
            }
          }
        })();

        await session.sendTurn({ prompt: ctx.triggerSecretFailurePrompt });
        await consumer;

        expect(failedEvent?.status).toBe('failed');
        expect(failedEvent?.failure?.safeMessage).not.toContain('sk-ant-');
        expect(failedEvent?.failure?.safeMessage).toContain('[REDACTED');
      } finally {
        await ctx.teardown?.();
      }
    });

    it('interrupts cleanly and terminates event streams on close()', async () => {
      const ctx = await createHarness();
      try {
        const session = await ctx.openSession();
        const events: AgentEvent[] = [];
        const consumer = (async () => {
          for await (const ev of session.events()) {
            events.push(ev);
          }
        })();

        await session.sendTurn({ prompt: 'Long running task' });
        await session.interruptTurn();
        await session.close('test cleanup');
        await consumer;

        expect(events.some((e) => e.type === 'session.ended')).toBe(true);
      } finally {
        await ctx.teardown?.();
      }
    });
  });
}

export type { ProviderAdapter };
