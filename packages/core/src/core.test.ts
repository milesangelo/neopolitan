import { describe, expect, it } from 'vitest';
import {
  EventHub,
  classifyProviderFailure,
  createLfNdjsonFramer,
  createPolicyGateMiddleware,
  sanitizeProviderFailureMessage,
  type GateRequest,
} from './index.js';
import { createMockDriver, MockExecutionRuntime } from '@neopolitan/testing';
import { runProviderConformanceSuite } from '@neopolitan/testing/conformance';

describe('@neopolitan/core', () => {
  it('buffers startup events in EventHub for late subscribers and respects includeRaw', async () => {
    const hub = new EventHub({ sessionId: 's1' });
    hub.emit({
      type: 'session.started',
      anchor: { providerId: 'mock', sessionId: 's1' },
      capabilities: (await createMockDriver().probe({} as never, new MockExecutionRuntime()))
        ? createMockDriver().baseCapabilities
        : createMockDriver().baseCapabilities,
      rawEvent: { protocol: 'test', payload: { secret: 1 } },
    });
    hub.emit({ type: 'assistant.delta', blockId: 'b1', text: 'hi' });
    hub.close();

    const filtered: unknown[] = [];
    for await (const ev of hub.subscribe({ includeRaw: false })) {
      filtered.push(ev);
    }
    expect(filtered).toHaveLength(2);
    expect((filtered[0] as { rawEvent?: unknown }).rawEvent).toBeUndefined();

    const raw: unknown[] = [];
    for await (const ev of hub.subscribe({ includeRaw: true, afterSeq: 0 })) {
      raw.push(ev);
    }
    expect((raw[0] as { rawEvent?: unknown }).rawEvent).toEqual({
      protocol: 'test',
      payload: { secret: 1 },
    });
  });

  it('frames strict LF-only NDJSON without splitting on U+2028 or U+2029', () => {
    const parsed: unknown[] = [];
    const nonJson: string[] = [];
    const framer = createLfNdjsonFramer({
      onJson: (v) => parsed.push(v),
      onNonJsonLine: (l) => nonJson.push(l),
    });

    framer.push('{"text":"hello\u2028world\u2029!"}\nnoise line\n{"ok":true}');
    framer.flush();

    expect(parsed).toEqual([{ text: 'hello\u2028world\u2029!' }, { ok: true }]);
    expect(nonJson).toEqual(['noise line']);
  });

  it('sanitizes Bearer tokens, API keys, and query secrets and classifies failures', () => {
    const cleaned = sanitizeProviderFailureMessage(
      'Failed Authorization: Bearer eyJhbGciOi.1234567890 with key sk-ant-abc1234567890 and https://x.test?token=mysecret',
    );
    expect(cleaned).not.toContain('eyJhbGciOi');
    expect(cleaned).not.toContain('sk-ant-');
    expect(cleaned).not.toContain('mysecret');

    const rate = classifyProviderFailure('Too many requests', { statusCode: 429 });
    expect(rate.failureClass).toBe('rate_limit');
    expect(rate.retryable).toBe(true);
  });

  it('never auto-approves disguised elicitations even in full_access mode', async () => {
    const mw = createPolicyGateMiddleware({
      rules: [{ id: 'allow-all', match: { category: 'command' }, action: 'allow' }],
    });

    const disguised: GateRequest = {
      kind: 'approval',
      requestId: 'r1',
      category: 'command',
      title: 'Which database?',
      isDisguisedElicitation: true,
    };

    let interactiveCalled = false;
    const res = await mw.evaluate(
      disguised,
      { mode: 'full_access', cwd: '/tmp', sessionId: 's1' },
      async () => {
        interactiveCalled = true;
        return { decision: 'deny', feedback: 'Asked user', source: 'user' };
      },
    );

    expect(interactiveCalled).toBe(true);
    expect(res.decision).toBe('deny');
  });
});

runProviderConformanceSuite('MockDriver', async () => {
  const runtime = new MockExecutionRuntime();
  const driver = createMockDriver({
    requireGateOnPrompt: /gate/i,
    failWithSecretOnPrompt: /secret/i,
  });
  const adapter = await driver.createAdapter({}, { runtime });
  return {
    openSession: (input) => adapter.openSession({ cwd: '/workspace', ...input }),
    triggerGatePrompt: 'Run gate check',
    triggerSecretFailurePrompt: 'Trigger secret error',
  };
});
