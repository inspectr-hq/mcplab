import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('./agent.js', () => ({ chatWithAgent: chat }));
import { testAgentConnection } from './agent-connection.js';
import { AgentConnectionError } from './agent-errors.js';
const agent = { provider: 'azure_foundry', model: 'my-deployment' };
beforeEach(() => {
  chat.mockReset().mockResolvedValue({ content: 'Ready', raw: { model: 'underlying-model' } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe('agent inference connection test', () => {
  it('tests the configured deployment without tools, saving, or evaluating an assertion', async () => {
    expect(await testAgentConnection(agent)).toMatchObject({
      ok: true,
      provider: 'azure_foundry',
      requestedModel: 'my-deployment',
      model: 'underlying-model'
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          provider: 'azure_foundry',
          model: 'my-deployment',
          max_tokens: 64
        }),
        signal: expect.any(AbortSignal),
        messages: [{ role: 'user', content: 'Reply with Ready.' }]
      })
    );
    expect(chat.mock.calls[0][0].tools).toBeUndefined();
  });
  it.each([
    { provider: 'azure_foundry', model: '' },
    { provider: 'azure_foundry', model: 123 },
    { provider: 'invalid', model: 'x' },
    { type: 'browser', provider: 'polo', model: 'x' },
    null
  ])('rejects invalid input %j before a request', async (raw) => {
    await expect(testAgentConnection(raw)).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'authentication'],
    [403, 'authentication'],
    [404, 'deployment'],
    [400, 'capability'],
    [422, 'capability'],
    [429, 'rate_limit']
  ])('reports HTTP %s as %s', async (status, failure) => {
    chat.mockRejectedValue(Object.assign(new Error('Provider rejected request'), { status }));
    expect(await testAgentConnection(agent)).toMatchObject({
      ok: false,
      failure,
      message: expect.stringMatching(/deployment|credentials|access|limit|capabilities/i)
    });
  });
  it('reports missing credentials without claiming connectivity', async () => {
    chat.mockRejectedValue(
      new AgentConnectionError('missing_credentials', 'Missing AZURE_FOUNDRY_ENDPOINT')
    );
    expect(await testAgentConnection(agent)).toMatchObject({
      ok: false,
      failure: 'missing_credentials',
      message: expect.stringContaining('AZURE_FOUNDRY_ENDPOINT')
    });
  });
  it('reports the configured legacy Azure deployment, not the form model', async () => {
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'actual-deployment');
    expect(
      await testAgentConnection({ provider: 'azure_openai', model: 'form-model' })
    ).toMatchObject({ ok: true, requestedModel: 'actual-deployment' });
  });
  it('times out a hung inference request', async () => {
    vi.useFakeTimers();
    chat.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        )
    );
    const pending = testAgentConnection(agent);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({ ok: false, failure: 'timeout' });
  });
  it('propagates user cancellation instead of showing a provider failure', async () => {
    const controller = new AbortController();
    chat.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        )
    );
    const pending = testAgentConnection(agent, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
  });
});
