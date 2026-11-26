import { MockExecutionRuntime, createMockDriver } from '@neopolitan-ai/testing';
import { runProviderConformanceSuite } from '@neopolitan-ai/testing/conformance';
import { describe, expect, it } from 'vitest';
import {
  EventHub,
  type GateRequest,
  ProviderAuthRequiredError,
  ProviderRegistry,
  SandboxDestroyedError,
  ThreadInUseError,
  classifyProviderFailure,
  createLfNdjsonFramer,
  createPolicyGateMiddleware,
  formatReviewTargetPrompt,
  redactSecrets,
  sanitizeProviderFailureMessage,
} from './index.js';

describe('@neopolitan-ai/core', () => {
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

  it('evaluates allow/deny/ask rules, autoJudge, ruleForced, and elicitation gates cleanly', async () => {
    const mw = createPolicyGateMiddleware({
      rules: [
        {
          id: 'deny-rm',
          match: { category: 'command', commandPattern: 'rm -rf*' },
          action: 'deny',
          reason: 'Dangerous command',
        },
        { id: 'allow-src', match: { category: 'file_write', pathGlob: 'src/**' }, action: 'allow' },
        { id: 'ask-mcp', match: { category: 'mcp_tool' }, action: 'ask' },
      ],
      autoJudge: async (req) =>
        req.command === 'git status' ? 'allow' : req.command === 'curl bad' ? 'deny' : 'escalate',
    });

    const ctx = { mode: 'supervised' as const, cwd: '/workspace', sessionId: 's-gate' };
    const interactive = async () => ({ decision: 'allow_once' as const, source: 'user' as const });

    expect(
      (
        await mw.evaluate(
          {
            kind: 'approval',
            requestId: 'g1',
            category: 'command',
            title: 'bash',
            command: 'rm -rf /tmp/x',
          },
          ctx,
          interactive,
        )
      ).decision,
    ).toBe('deny');

    expect(
      (
        await mw.evaluate(
          {
            kind: 'approval',
            requestId: 'g2',
            category: 'file_write',
            title: 'edit',
            paths: ['src/app.ts'],
          },
          ctx,
          interactive,
        )
      ).source,
    ).toBe('policy');

    expect(
      (
        await mw.evaluate(
          {
            kind: 'approval',
            requestId: 'g3',
            category: 'file_write',
            title: 'edit',
            paths: ['src/app.ts'],
            ruleForced: true,
          },
          { ...ctx, mode: 'full_access' },
          async () => ({ decision: 'deny', source: 'user' }),
        )
      ).decision,
    ).toBe('deny');

    expect(
      (
        await mw.evaluate(
          { kind: 'approval', requestId: 'g4', category: 'patch', title: 'apply patch' },
          { ...ctx, mode: 'auto_accept_edits' },
          interactive,
        )
      ).source,
    ).toBe('policy');

    expect(
      (
        await mw.evaluate(
          {
            kind: 'approval',
            requestId: 'g5',
            category: 'command',
            title: 'bash',
            command: 'git status',
          },
          { ...ctx, mode: 'auto' },
          interactive,
        )
      ).source,
    ).toBe('auto_judge');

    expect(
      (
        await mw.evaluate(
          {
            kind: 'approval',
            requestId: 'g6',
            category: 'command',
            title: 'bash',
            command: 'curl bad',
          },
          { ...ctx, mode: 'auto' },
          interactive,
        )
      ).decision,
    ).toBe('deny');

    expect(
      (
        await mw.evaluate(
          { kind: 'elicitation', requestId: 'g7', mode: 'form', prompt: 'Enter tag' },
          { ...ctx, mode: 'full_access' },
          async () => ({ decision: 'answered', answers: { tag: 'v1' }, source: 'user' }),
        )
      ).decision,
    ).toBe('answered');
  });

  it('classifies all failure modes, constructs typed SDK errors, formats review prompts, and guards registry lookups', () => {
    expect(redactSecrets('token=abc123 Authorization: Bearer abcdef123456')).not.toContain(
      'abcdef123456',
    );
    expect(classifyProviderFailure('Auth required', { code: -32000 }).failureClass).toBe('auth');
    expect(
      classifyProviderFailure('Billing quota payment required', { statusCode: 402 }).failureClass,
    ).toBe('billing');
    expect(classifyProviderFailure('maximum context length exceeded').failureClass).toBe(
      'context_exhausted',
    );
    expect(classifyProviderFailure('unknown model xyz').failureClass).toBe('model_unavailable');
    expect(classifyProviderFailure('permission denied', { statusCode: 403 }).failureClass).toBe(
      'permission_denied',
    );
    expect(classifyProviderFailure('broken pipe', { code: 'ENOENT' }).failureClass).toBe(
      'transport_error',
    );

    const sErr = new SandboxDestroyedError('sb-1');
    const aErr = new ProviderAuthRequiredError('codex', { signInUrl: 'https://auth.example.com' });
    const tErr = new ThreadInUseError('th-1');
    expect(sErr.runtimeId).toBe('sb-1');
    expect(aErr.signInUrl).toBe('https://auth.example.com');
    expect(tErr.retryable).toBe(true);

    const reviewText = formatReviewTargetPrompt({
      repos: [{ repoId: 'api', name: 'api-repo', baseCommit: 'abc1234' }],
      instructions: 'Check null guards',
    });
    expect(reviewText).toContain('- api-repo (base: abc1234)');
    expect(reviewText).toContain('Instructions:\nCheck null guards');

    const reg = new ProviderRegistry();
    expect(() => reg.require('missing')).toThrow(/No provider driver registered/);
  });
});

runProviderConformanceSuite('MockDriver', async () => {
  const runtime = new MockExecutionRuntime();
  const driver = createMockDriver({
    requireGateOnPrompt: /gate/i,
    failWithSecretOnPrompt: /secret/i,
    unknownOutcomeOnPrompt: /unknown-outcome/i,
  });
  const adapter = await driver.createAdapter({}, { runtime });
  return {
    openSession: (input) => adapter.openSession({ cwd: '/workspace', ...input }),
    triggerGatePrompt: 'Run gate check',
    triggerSecretFailurePrompt: 'Trigger secret error',
    triggerUnknownOutcomePrompt: 'Trigger unknown-outcome',
  };
});
