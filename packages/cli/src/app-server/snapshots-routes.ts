import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';

export type SnapshotsRouteDeps = AppRouteDeps;

export async function handleSnapshotsRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  deps: SnapshotsRouteDeps;
}): Promise<boolean> {
  const { res, pathname } = params;
  if (!pathname.startsWith('/api/snapshots')) return false;
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      error:
        'Snapshot feature removed. Use Auto Checks for empty-state check generation and Ask Assistant for refinement.'
    })
  );
  return true;
}
