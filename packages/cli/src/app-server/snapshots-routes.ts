import { writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, type SourceEvalConfig } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';

export type SnapshotsRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'listSnapshots'
  | 'buildSnapshotFromRun'
  | 'saveSnapshot'
  | 'loadSnapshot'
  | 'compareRunToSnapshot'
  | 'getRunResults'
  | 'decodeEvalId'
  | 'readConfigRecord'
>;

export async function handleSnapshotsRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  deps: SnapshotsRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, deps } = params;
  const {
    parseBody,
    asJson,
    listSnapshots,
    buildSnapshotFromRun,
    saveSnapshot,
    loadSnapshot,
    compareRunToSnapshot,
    getRunResults,
    decodeEvalId,
    readConfigRecord
  } = deps;

  if (pathname === '/api/snapshots' && method === 'GET') {
    asJson(res, 200, listSnapshots(settings.snapshotsDir));
    return true;
  }

  if (pathname === '/api/snapshots' && method === 'POST') {
    const body = await parseBody(req);
    const runId = String(body.runId ?? '').trim();
    const name = body.name ? String(body.name) : undefined;
    if (!runId) {
      asJson(res, 400, { error: 'runId is required' });
      return true;
    }
    const results = getRunResults(runId, settings.runsDir);
    const snapshot = buildSnapshotFromRun(results, name);
    saveSnapshot(snapshot, settings.snapshotsDir);
    asJson(res, 201, snapshot);
    return true;
  }

  if (pathname === '/api/snapshots/generate-eval' && method === 'POST') {
    const body = await parseBody(req);
    const runId = String(body.runId ?? '').trim();
    const configId = String(body.configId ?? '').trim();
    const name = body.name ? String(body.name) : undefined;
    if (!runId) {
      asJson(res, 400, { error: 'runId is required' });
      return true;
    }
    if (!configId) {
      asJson(res, 400, { error: 'configId is required' });
      return true;
    }
    const results = getRunResults(runId, settings.runsDir);
    const snapshot = buildSnapshotFromRun(results, name);
    saveSnapshot(snapshot, settings.snapshotsDir);

    const configPath = decodeEvalId(configId, settings.evalsDir);
    const { sourceConfig } = loadConfig(configPath, { bundleRoot: settings.librariesDir });
    const nextConfig: SourceEvalConfig = {
      ...sourceConfig,
      snapshot_eval: {
        enabled: true,
        mode: sourceConfig.snapshot_eval?.mode ?? 'warn',
        baseline_snapshot_id: snapshot.id,
        baseline_source_run_id: runId,
        last_updated_at: new Date().toISOString()
      }
    };
    writeFileSync(configPath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
    asJson(res, 201, {
      snapshot,
      config: readConfigRecord(configPath, settings.evalsDir, settings.librariesDir)
    });
    return true;
  }

  if (pathname.startsWith('/api/snapshots/') && method === 'GET') {
    const snapshotId = pathname.replace('/api/snapshots/', '');
    asJson(res, 200, loadSnapshot(snapshotId, settings.snapshotsDir));
    return true;
  }

  if (
    pathname.startsWith('/api/snapshots/') &&
    pathname.endsWith('/compare') &&
    method === 'POST'
  ) {
    const snapshotId = pathname.split('/')[3];
    const body = await parseBody(req);
    const runId = String(body.runId ?? '').trim();
    if (!runId) {
      asJson(res, 400, { error: 'runId is required' });
      return true;
    }
    const snapshot = loadSnapshot(snapshotId, settings.snapshotsDir);
    const run = getRunResults(runId, settings.runsDir);
    asJson(res, 200, compareRunToSnapshot(run, snapshot));
    return true;
  }

  return false;
}
