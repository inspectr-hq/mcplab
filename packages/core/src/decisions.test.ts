import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { normalizeEvaluationDecisionConfig } from './decision-config.js';
import { evaluateSemanticAssertions, requestDecisionAnswers } from './decisions.js';
import type { LlmAgentConfig, SemanticEvaluationParams } from './types.js';

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock('./agent.js', async (original) => ({
  ...(await original<typeof import('./agent.js')>()),
  chatWithAgent: chatMock
}));
const config = {
  provider: 'openai' as const,
  model: 'gpt-6-luna',
  passThreshold: 0.9,
  failThreshold: 0.1
};
const checks = [1, 2, 3].map((n) => ({
  id: `agent-check-${n}`,
  prompt: `Check ${n}`,
  label: `Check ${n}`
}));
const fetchMock = vi.fn();
const response = (answers: unknown, extra = {}) =>
  new Response(JSON.stringify({ model: 'resolved-model', answers, ...extra }));
const input = { config, evidence: { final_answer: 'answer' }, checks };
const semanticInput = {
  assertions: checks.map(({ label, prompt }) => ({ label, prompt })),
  finalText: 'answer',
  judge: { name: 'judge', agent: { provider: 'openai' as const, model: 'judge-model' } },
  evaluationDecision: config
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
  vi.stubEnv('CLOUDFLARE_AUTH_TOKEN', 'test-key');
  fetchMock.mockReset();
  chatMock.mockReset();
  chatMock.mockImplementation(async ({ messages }) => ({
    content: JSON.stringify({
      results: JSON.parse(messages[0].content).checks.map((c: { id: string }) => ({
        id: c.id,
        pass: true,
        reason: 'Judge explanation'
      }))
    })
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('decision configuration', () => {
  it('normalizes an Ollama URL and default thresholds', () => {
    expect(normalizeEvaluationDecisionConfig({ provider: 'ollama', model: 'clef-flash' })).toEqual({
      provider: 'ollama',
      model: 'clef-flash',
      baseUrl: 'http://localhost:11434',
      passThreshold: 0.9,
      failThreshold: 0.1
    });
  });
  it.each([
    { passThreshold: 0.1, failThreshold: 0.1 },
    { passThreshold: Infinity },
    { failThreshold: -1 },
    { passThreshold: 1.1 },
    { passThreshold: '0.9' },
    { provider: 'unknown' },
    { baseUrl: 'http://localhost' },
    { model: 'chat-model' }
  ])('rejects invalid configuration %j', (patch) => {
    expect(() => normalizeEvaluationDecisionConfig({ ...config, ...patch })).toThrow();
  });
});

describe('decision providers', () => {
  it('respects the Cloudflare 64-question request limit', async () => {
    const many = Array.from({ length: 65 }, (_, n) => ({ id: String(n), prompt: 'Check' }));
    fetchMock.mockImplementation(async (_url, request) =>
      response(
        Object.fromEntries(
          Object.keys(JSON.parse(request.body).questions).map((id) => [
            id,
            { type: 'noul', noul: 0.95 }
          ])
        )
      )
    );
    const result = await requestDecisionAnswers({
      ...input,
      checks: many,
      config: { ...config, provider: 'cloudflare', model: 'clef-flash' }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.every((answer) => answer.probability === 0.95)).toBe(true);
  });
  it('sends OpenAI predicates and matches reordered answers by name', async () => {
    fetchMock.mockResolvedValue(
      response([
        { type: 'predicate', name: checks[1].id, probability: 0.4 },
        { type: 'predicate', name: checks[0].id, probability: 0.95 }
      ])
    );
    const answers = await requestDecisionAnswers(input);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    const body = JSON.parse(request.body);
    expect(body.input).toBe(JSON.stringify(input.evidence));
    expect(body.questions[0]).toMatchObject({ type: 'predicate', name: checks[0].id });
    expect(answers[0]).toMatchObject({
      id: checks[0].id,
      probability: 0.95,
      model: 'resolved-model'
    });
    expect(answers[2]).toMatchObject({ id: checks[2].id, fallback: 'missing_answer' });
  });
  it.each(['typesafe', 'cloudflare', 'ollama'] as const)(
    'uses shared System One questions for %s',
    async (provider) => {
      const answers = { [checks[0].id]: { type: 'noul', noul: 0.96 } };
      fetchMock.mockResolvedValue(
        provider === 'cloudflare'
          ? new Response(
              JSON.stringify({ success: true, result: { model: 'clef-flash', answers } })
            )
          : response(answers)
      );
      const c = normalizeEvaluationDecisionConfig({
        ...config,
        provider,
        model: provider === 'typesafe' ? 'jev-1.13.0' : 'clef-flash',
        ...(provider === 'ollama' ? { baseUrl: 'http://127.0.0.1:1234' } : {})
      });
      const result = await requestDecisionAnswers({ ...input, config: c });
      expect(result[0].probability).toBe(0.96);
      const [url, request] = fetchMock.mock.calls[0];
      expect(url).toBe(
        provider === 'typesafe'
          ? 'https://api.typesafe.ai/v1/systemone'
          : provider === 'cloudflare'
            ? 'https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/cloudflare/clef-flash'
            : 'http://127.0.0.1:1234/v1/systemone'
      );
      expect(JSON.parse(request.body).questions[checks[0].id]).toMatchObject({
        type: 'noul',
        criteria: { true: expect.any(String), false: expect.any(String) }
      });
      if (provider === 'ollama') expect(request.headers.Authorization).toBeUndefined();
    }
  );
  it('splits Ollama batches without losing completed answers when a later batch fails', async () => {
    const many = Array.from({ length: 65 }, (_, n) => ({ id: String(n), prompt: 'Check' }));
    fetchMock
      .mockResolvedValueOnce(
        response(
          Object.fromEntries(many.slice(0, 64).map((c) => [c.id, { type: 'noul', noul: 0.95 }]))
        )
      )
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const result = await requestDecisionAnswers({
      ...input,
      checks: many,
      config: normalizeEvaluationDecisionConfig({
        ...config,
        provider: 'ollama',
        model: 'clef-flash'
      })
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(JSON.parse(fetchMock.mock.calls[0][1].body).questions)).toHaveLength(64);
    expect(result[0].probability).toBe(0.95);
    expect(result[64].fallback).toBe('http_error');
  });
  it('starts limited batches together and preserves input order when they finish out of order', async () => {
    const many = Array.from({ length: 65 }, (_, n) => ({ id: String(n), prompt: 'Check' }));
    const finish: Array<(value: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => finish.push(resolve)));
    const pending = requestDecisionAnswers({
      ...input,
      checks: many,
      config: normalizeEvaluationDecisionConfig({ provider: 'ollama', model: 'clef-flash' })
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish[1](response({ '64': { type: 'noul', noul: 0.05 } }));
    finish[0](
      response(
        Object.fromEntries(many.slice(0, 64).map(({ id }) => [id, { type: 'noul', noul: 0.95 }]))
      )
    );
    const result = await pending;
    expect(result.map(({ id }) => id)).toEqual(many.map(({ id }) => id));
    expect(result.slice(0, 64).every(({ probability }) => probability === 0.95)).toBe(true);
    expect(result[64].probability).toBe(0.05);
  });
  it('preserves completed batch answers when a concurrent batch times out', async () => {
    vi.useFakeTimers();
    const many = Array.from({ length: 65 }, (_, n) => ({ id: String(n), prompt: 'Check' }));
    fetchMock
      .mockResolvedValueOnce(
        response(
          Object.fromEntries(many.slice(0, 64).map(({ id }) => [id, { type: 'noul', noul: 0.95 }]))
        )
      )
      .mockImplementationOnce(
        (_url, request) =>
          new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      );
    const pending = requestDecisionAnswers({
      ...input,
      checks: many,
      config: normalizeEvaluationDecisionConfig({ provider: 'ollama', model: 'clef-flash' })
    });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;
    expect(result[0].probability).toBe(0.95);
    expect(result[64].fallback).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('cancels every concurrent batch without fallback results', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(
      (_url, request) =>
        new Promise((_resolve, reject) => {
          signals.push(request.signal);
          request.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    const pending = requestDecisionAnswers({
      ...input,
      checks: Array.from({ length: 65 }, (_, n) => ({ id: String(n), prompt: 'Check' })),
      config: normalizeEvaluationDecisionConfig({ provider: 'ollama', model: 'clef-flash' }),
      signal: controller.signal
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it('rejects duplicates, refusals, and invalid probabilities per answer', async () => {
    fetchMock.mockResolvedValue(
      response([
        { type: 'predicate', name: checks[0].id, probability: 0.99 },
        { type: 'predicate', name: checks[0].id, probability: 0.99 },
        { type: 'refusal', name: checks[1].id },
        { type: 'predicate', name: checks[2].id, probability: 2 }
      ])
    );
    const result = await requestDecisionAnswers(input);
    expect(result.map((a) => a.fallback)).toEqual([
      'duplicate_answer',
      'refusal',
      'invalid_answer'
    ]);
  });
  it.each([401, 429, 500])('does not retry HTTP %s', async (status) => {
    fetchMock.mockResolvedValue(new Response('secret error body', { status }));
    expect((await requestDecisionAnswers(input)).every((a) => a.fallback === 'http_error')).toBe(
      true
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('falls back without a network request when credentials are missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await requestDecisionAnswers(input))[0].fallback).toBe('missing_credentials');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('times out hosted requests and returns unavailable answers', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        )
    );
    const pending = requestDecisionAnswers(input);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending)[0].fallback).toBe('timeout');
  });
  it('uses the longer Ollama loading timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        )
    );
    const pending = requestDecisionAnswers({
      ...input,
      config: normalizeEvaluationDecisionConfig({
        ...config,
        provider: 'ollama',
        model: 'clef-flash'
      })
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await pending)[0].fallback).toBe('timeout');
  });
});

describe('semantic decision routing', () => {
  it('requires an LLM judge at the typed evaluation boundary', () => {
    expectTypeOf<SemanticEvaluationParams['judge']['agent']>().toEqualTypeOf<LlmAgentConfig>();
  });
  it('keeps completed chunk verdicts and judges only an unavailable concurrent chunk', async () => {
    const assertions = Array.from({ length: 65 }, (_, n) => ({
      label: `Check ${n + 1}`,
      prompt: 'Valid?'
    }));
    fetchMock
      .mockImplementationOnce(async (_url, request) =>
        response(
          Object.fromEntries(
            Object.keys(JSON.parse(request.body).questions).map((id, n) => [
              id,
              { type: 'noul', noul: n === 0 ? 0.05 : 0.95 }
            ])
          )
        )
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const result = await evaluateSemanticAssertions({
      ...semanticInput,
      assertions,
      evaluationDecision: normalizeEvaluationDecisionConfig({
        provider: 'ollama',
        model: 'clef-flash'
      })
    });
    expect(result[0]).toMatchObject({ pass: false, metadata: { evaluator: 'decision' } });
    expect(result[63]).toMatchObject({ pass: true, metadata: { evaluator: 'decision' } });
    expect(result[64]).toMatchObject({
      pass: true,
      metadata: { evaluator: 'judge', decision_fallback: 'http_error' }
    });
    expect(result.map(({ label }) => label)).toEqual(assertions.map(({ label }) => label));
    const judged = JSON.parse(chatMock.mock.calls[0][0].messages[0].content);
    expect(judged.checks.map(({ label }: { label: string }) => label)).toEqual(['Check 65']);
  });
  it('retains definite verdicts when the fallback judge fails', async () => {
    fetchMock.mockResolvedValue(
      response(
        checks.map((c, i) => ({ name: c.id, type: 'predicate', probability: [0.95, 0.05, 0.5][i] }))
      )
    );
    chatMock.mockRejectedValue(new Error('Judge unavailable'));
    const result = await evaluateSemanticAssertions(semanticInput);
    expect(result.map((r) => r.pass)).toEqual([true, false, false]);
    expect(result[0].metadata?.evaluator).toBe('decision');
    expect(result[2].reason).toContain('Judge unavailable');
  });
  it('routes connection failures and malformed JSON to the judge', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(new Response('not-json'));
    const connection = await evaluateSemanticAssertions(semanticInput);
    const malformed = await evaluateSemanticAssertions(semanticInput);
    expect(connection[0].metadata?.decision_fallback).toBe('connection_error');
    expect(malformed[0].metadata?.decision_fallback).toBe('invalid_response');
  });
  it('retains clear pass/fail results and sends only uncertain assertions to the judge', async () => {
    fetchMock.mockResolvedValue(
      response(
        checks.map((c, i) => ({ name: c.id, type: 'predicate', probability: [0.9, 0.1, 0.5][i] }))
      )
    );
    const result = await evaluateSemanticAssertions(semanticInput);
    expect(result.map((r) => r.pass)).toEqual([true, false, true]);
    expect(result[0].metadata).toMatchObject({ evaluator: 'decision', decision_probability: 0.9 });
    expect(result[1].metadata).toMatchObject({ evaluator: 'decision', decision_probability: 0.1 });
    expect(result[2].metadata).toMatchObject({
      evaluator: 'judge',
      check_id: checks[2].id,
      decision_fallback: 'uncertain'
    });
    const judged = JSON.parse(chatMock.mock.calls[0][0].messages[0].content);
    expect(judged.checks.map((c: { label: string }) => c.label)).toEqual(['Check 3']);
  });
  it('uses configured thresholds rather than fixed defaults', async () => {
    fetchMock.mockResolvedValue(
      response(
        checks.map((c, i) => ({ name: c.id, type: 'predicate', probability: [0.8, 0.2, 0.5][i] }))
      )
    );
    const result = await evaluateSemanticAssertions({
      ...semanticInput,
      evaluationDecision: { ...config, passThreshold: 0.8, failThreshold: 0.2 }
    });
    expect(result.map((r) => r.pass)).toEqual([true, false, true]);
  });
  it('preserves judge-only behavior when no decision engine is selected', async () => {
    const result = await evaluateSemanticAssertions({
      ...semanticInput,
      evaluationDecision: undefined
    });
    expect(result.every((r) => r.pass)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
  it('falls back for invalid persisted configuration', async () => {
    const result = await evaluateSemanticAssertions({
      ...semanticInput,
      evaluationDecision: { ...config, passThreshold: -1 }
    });
    expect(result[0].metadata).toMatchObject({
      evaluator: 'judge',
      decision_fallback: 'invalid_configuration'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('propagates cancellation without calling the judge', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Abort', 'AbortError');
    });
    await expect(
      evaluateSemanticAssertions({ ...semanticInput, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(chatMock).not.toHaveBeenCalled();
  });
});
