import type { ServerResponse } from 'node:http';
import type { asJson as asJsonResponse } from './http.js';
import type { InspectrSessionManager } from './inspectr-session-manager.js';
import { getRunResults } from './runs-store.js';
import { respondWithRunStoreError } from './runs-routes.js';

export async function handleInspectrRoutes(params: {
  res: ServerResponse;
  pathname: string;
  method: string;
  runsDir: string;
  inspectrSessionManager: Pick<InspectrSessionManager, 'acquire'>;
  asJson: typeof asJsonResponse;
}): Promise<boolean> {
  const { res, pathname, method, runsDir, inspectrSessionManager, asJson } = params;
  const match = pathname.match(/^\/api\/runs\/([^/]+)\/inspectr$/);
  if (!match || method !== 'POST') return false;

  // Only origins recorded on the run can be started, never arbitrary URLs from the client.
  let origins: string[];
  try {
    origins = getRunResults(decodeURIComponent(match[1]), runsDir).metadata.inspectr_origins ?? [];
  } catch (error) {
    if (!respondWithRunStoreError(res, asJson, error)) throw error;
    return true;
  }
  try {
    const sessions = await Promise.all(
      origins.map((origin) => inspectrSessionManager.acquire(origin))
    );
    asJson(res, 200, {
      sessions: sessions.map(({ upstreamOrigin, dashboardUrl }) => ({
        upstreamOrigin,
        dashboardUrl
      }))
    });
  } catch (error) {
    asJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
