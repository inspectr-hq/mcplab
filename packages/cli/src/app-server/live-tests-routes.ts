import type { IncomingMessage, ServerResponse } from 'node:http';
import type { asJson, parseBody } from './http.js';
import { LiveTestError, type LiveTestService, type LiveTestSession } from './live-tests.js';

export interface LiveTestRouteDeps {
  parseBody: typeof parseBody;
  asJson: typeof asJson;
}

function sessionView(session: LiveTestSession) {
  return {
    id: session.id,
    testCaseId: session.testCase.id,
    testCaseName: session.testCase.name ?? session.testCase.id,
    prompt: session.testCase.prompt,
    client: session.client,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    completion: session.completion
  };
}

export async function handleLiveTestRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  service: LiveTestService;
  deps: LiveTestRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, service, deps } = params;
  if (!pathname.startsWith('/api/live-tests/')) return false;

  try {
    if (pathname === '/api/live-tests/test-cases' && method === 'GET') {
      deps.asJson(res, 200, { testCases: service.list() });
      return true;
    }
    if (pathname === '/api/live-tests/sessions' && method === 'POST') {
      const body = await deps.parseBody(req);
      const testCaseId = String(body.testCaseId ?? '').trim();
      if (!testCaseId) throw new LiveTestError('testCaseId is required.', 400);
      const session = service.start({
        testCaseId,
        client: String(body.client ?? 'unknown')
      });
      deps.asJson(res, 201, sessionView(session));
      return true;
    }

    const match = pathname.match(/^\/api\/live-tests\/sessions\/([^/]+)(?:\/(complete|cancel))?$/);
    if (!match) return false;
    const sessionId = decodeURIComponent(match[1]);
    const action = match[2];
    if (!action && method === 'GET') {
      deps.asJson(res, 200, sessionView(service.get(sessionId)));
      return true;
    }
    if (action === 'complete' && method === 'POST') {
      const body = await deps.parseBody(req);
      const completion = await service.complete(sessionId, {
        finalText: String(body.finalText ?? ''),
        startedAt: String(body.startedAt ?? ''),
        completedAt: String(body.completedAt ?? '')
      });
      deps.asJson(res, 200, completion);
      return true;
    }
    if (action === 'cancel' && method === 'POST') {
      deps.asJson(res, 200, sessionView(service.cancel(sessionId)));
      return true;
    }
    return false;
  } catch (error) {
    if (!(error instanceof LiveTestError)) throw error;
    deps.asJson(res, error.statusCode, { error: error.message });
    return true;
  }
}
