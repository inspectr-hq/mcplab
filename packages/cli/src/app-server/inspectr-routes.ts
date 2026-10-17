import type { IncomingMessage, ServerResponse } from 'node:http';
import type { asJson as asJsonResponse, parseBody as parseRequestBody } from './http.js';
import type { InspectrSessionManager } from './inspectr-session-manager.js';
import { getRunResults } from './runs-store.js';
import { respondWithRunStoreError } from './runs-routes.js';

export async function handleInspectrRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  runsDir: string;
  inspectrSessionManager: Pick<InspectrSessionManager, 'acquire'>;
  parseBody: typeof parseRequestBody;
  asJson: typeof asJsonResponse;
}): Promise<boolean> {
  const { req, res, pathname, method, runsDir, inspectrSessionManager, parseBody, asJson } = params;
  const match = pathname.match(/^\/api\/runs\/([^/]+)\/inspectr$/);
  if (!match || method !== 'POST') return false;

  let recordedOrigins: Set<string>;
  try {
    const results = getRunResults(decodeURIComponent(match[1]), runsDir);
    recordedOrigins = new Set(
      results.scenarios.flatMap((scenario) => scenario.inspectr_origins ?? [])
    );
  } catch (error) {
    if (!respondWithRunStoreError(res, asJson, error)) throw error;
    return true;
  }
  const body = (await parseBody(req)) as { origin?: unknown };
  const origin = typeof body.origin === 'string' ? body.origin : '';
  // Only origins recorded on the run can be started, never arbitrary URLs from the client.
  if (!recordedOrigins.has(origin)) {
    asJson(res, 400, { error: 'origin was not inspected with Inspectr in this run' });
    return true;
  }
  try {
    const { upstreamOrigin, dashboardUrl } = await inspectrSessionManager.acquire(origin);
    asJson(res, 200, { session: { upstreamOrigin, dashboardUrl } });
  } catch (error) {
    asJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
