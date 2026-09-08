import { describe, expect, it } from 'vitest';
import { LiveTestService } from './live-tests.js';
import { handleLiveTestRoutes } from './live-tests-routes.js';

function fixture() {
  let body: Record<string, unknown> = {};
  let response: { status: number; payload: unknown } | undefined;
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
        }
      }
    });
    return response!;
  };
  return { call };
}

describe('Live Test routes', () => {
  it('lists the safe catalog', async () => {
    const { call } = fixture();
    const response = await call('/api/live-tests/test-cases', 'GET');
    expect(response).toEqual({
      status: 200,
      payload: { testCases: [expect.objectContaining({ id: 'case-1', eligible: true })] }
    });
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
});
