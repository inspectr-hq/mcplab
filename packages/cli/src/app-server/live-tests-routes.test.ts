import { describe, expect, it } from 'vitest';
import { LiveTestService } from './live-tests.js';
import { handleLiveTestRoutes } from './live-tests-routes.js';

function fixture() {
  let body: Record<string, unknown> = {};
  let response: { status: number; payload: unknown } | undefined;
  const logs: string[] = [];
  const service = new LiveTestService({
    runsDir: '/tmp',
    cliVersion: 'test',
    readScenarios: () => [{ id: 'case-1', name: 'Case 1', servers: [], prompt: 'Say hello' }],
    persist: () => undefined
  });
  const call = async (pathname: string, method: string, nextBody: Record<string, unknown> = {}) => {
    body = nextBody;
    response = undefined;
    await handleLiveTestRoutes({
      req: {} as never,
      res: {} as never,
      pathname,
      method,
      service,
      deps: {
        parseBody: async () => body,
        asJson: (_res, status, payload) => {
          response = { status, payload };
        },
        log: (message) => logs.push(message)
      }
    });
    return response!;
  };
  return { call, logs };
}

describe('Live Test routes', () => {
  it('lists the safe catalog', async () => {
    const { call, logs } = fixture();
    const response = await call('/api/live-tests/test-cases', 'GET');
    expect(response).toEqual({
      status: 200,
      payload: { testCases: [expect.objectContaining({ id: 'case-1', eligible: true })] }
    });
    expect(logs).toContain('[mcplab-app] Rover connected, catalog requested');
  });

  it('starts and reads a session', async () => {
    const { call } = fixture();
    const started = await call('/api/live-tests/sessions', 'POST', {
      testCaseId: 'case-1',
      client: 'claude'
    });
    expect(started.status).toBe(201);
    const id = (started.payload as { id: string }).id;
    const fetched = await call(`/api/live-tests/sessions/${id}`, 'GET');
    expect(fetched).toEqual({
      status: 200,
      payload: expect.objectContaining({ id, prompt: 'Say hello', status: 'ready' })
    });
  });

  it('completes a prepared response through the API contract', async () => {
    const { call, logs } = fixture();
    const started = await call('/api/live-tests/sessions', 'POST', {
      testCaseId: 'case-1',
      client: 'trendminer'
    });
    const id = (started.payload as { id: string }).id;
    const completed = await call(`/api/live-tests/sessions/${id}/complete`, 'POST', {
      finalText: 'Hello',
      startedAt: '2026-09-08T10:00:00.000Z',
      completedAt: '2026-09-08T10:00:01.000Z'
    });
    expect(completed).toEqual({
      status: 200,
      payload: expect.objectContaining({ outcome: 'passed', resultUrl: expect.stringContaining('/results/') })
    });
    expect(logs.some((line) => line.includes('Rover Live Test completed') && line.includes('passed'))).toBe(true);
  });
});
