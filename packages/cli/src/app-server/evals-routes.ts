import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, type SourceEvalConfig } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';

function normalizeSourceConfigForWrite(config: SourceEvalConfig): SourceEvalConfig {
  const rawAgents = (config as { agents?: unknown }).agents;
  const agents = Array.isArray(rawAgents)
    ? [...rawAgents]
    : rawAgents && typeof rawAgents === 'object'
      ? Object.entries(rawAgents as Record<string, Record<string, unknown>>).map(([name, agent]) => ({
          name,
          provider: String(agent.provider ?? 'openai') as 'openai' | 'anthropic' | 'azure_openai',
          model: String(agent.model ?? ''),
          temperature: typeof agent.temperature === 'number' ? agent.temperature : undefined,
          max_tokens: typeof agent.max_tokens === 'number' ? agent.max_tokens : undefined,
          system: typeof agent.system === 'string' ? agent.system : undefined
        }))
      : [];
  const legacyAgentRefs = Array.isArray(config.agent_refs)
    ? config.agent_refs.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const existingAgentRefs = new Set(
    agents
      .filter((entry): entry is { ref: string } => Boolean(entry && typeof entry === 'object' && 'ref' in entry))
      .map((entry) => String(entry.ref).trim())
      .filter(Boolean)
  );
  for (const ref of legacyAgentRefs) {
    if (existingAgentRefs.has(ref)) continue;
    agents.push({ ref });
  }

  const scenarios = Array.isArray(config.scenarios) ? [...config.scenarios] : [];
  const legacyRefs = Array.isArray(config.scenario_refs)
    ? config.scenario_refs.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const existingRefs = new Set(
    scenarios
      .filter((entry): entry is { ref: string } => Boolean(entry && typeof entry === 'object' && 'ref' in entry))
      .map((entry) => String(entry.ref).trim())
      .filter(Boolean)
  );
  for (const ref of legacyRefs) {
    if (existingRefs.has(ref)) continue;
    scenarios.push({ ref });
  }
  return {
    ...config,
    agents,
    agent_refs: undefined,
    scenarios,
    scenario_refs: undefined
  };
}

export type EvalsRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'listConfigs'
  | 'safeFileName'
  | 'ensureInsideRoot'
  | 'decodeEvalId'
  | 'readConfigRecord'
  | 'readConfigRecordOrInvalid'
>;

export async function handleEvalsRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  deps: EvalsRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, deps } = params;
  const {
    parseBody,
    asJson,
    listConfigs,
    safeFileName,
    ensureInsideRoot,
    decodeEvalId,
    readConfigRecord,
    readConfigRecordOrInvalid
  } = deps;

  if (pathname === '/api/evals' && method === 'GET') {
    asJson(res, 200, listConfigs(settings.evalsDir, settings.librariesDir));
    return true;
  }

  if (pathname === '/api/evals' && method === 'POST') {
    const body = await parseBody(req);
    const config = body.config as SourceEvalConfig | undefined;
    if (!config || typeof config !== 'object') {
      asJson(res, 400, { error: 'Missing config object' });
      return true;
    }
    const baseName = safeFileName(body.fileName ?? `config-${Date.now()}`);
    let filePath = ensureInsideRoot(settings.evalsDir, join(settings.evalsDir, `${baseName}.yaml`));
    let suffix = 1;
    while (existsSync(filePath)) {
      filePath = ensureInsideRoot(
        settings.evalsDir,
        join(settings.evalsDir, `${baseName}-${suffix}.yaml`)
      );
      suffix += 1;
    }
    writeFileSync(filePath, `${stringifyYaml(normalizeSourceConfigForWrite(config))}\n`, 'utf8');
    asJson(res, 201, readConfigRecord(filePath, settings.evalsDir, settings.librariesDir));
    return true;
  }

  if (pathname.startsWith('/api/evals/') && method === 'GET') {
    const id = pathname.replace('/api/evals/', '');
    const filePath = decodeEvalId(id, settings.evalsDir);
    asJson(res, 200, readConfigRecordOrInvalid(filePath, settings.evalsDir, settings.librariesDir));
    return true;
  }

  if (
    pathname.startsWith('/api/evals/') &&
    pathname.endsWith('/snapshot-policy') &&
    method === 'POST'
  ) {
    const id = pathname.replace('/api/evals/', '').replace('/snapshot-policy', '');
    const filePath = decodeEvalId(id, settings.evalsDir);
    if (!existsSync(filePath)) {
      asJson(res, 404, { error: 'Config not found' });
      return true;
    }
    const body = await parseBody(req);
    const enabled = Boolean(body.enabled);
    const mode = String(body.mode ?? 'warn');
    if (mode !== 'warn' && mode !== 'fail_on_drift') {
      asJson(res, 400, { error: 'mode must be warn or fail_on_drift' });
      return true;
    }
    const { sourceConfig } = loadConfig(filePath, { bundleRoot: settings.librariesDir });
    const nextSnapshotEval: NonNullable<SourceEvalConfig['snapshot_eval']> = {
      enabled,
      mode,
      baseline_snapshot_id:
        body.baselineSnapshotId !== undefined
          ? String(body.baselineSnapshotId || '')
          : sourceConfig.snapshot_eval?.baseline_snapshot_id,
      baseline_source_run_id:
        body.baselineSourceRunId !== undefined
          ? String(body.baselineSourceRunId || '')
          : sourceConfig.snapshot_eval?.baseline_source_run_id,
      last_updated_at: new Date().toISOString()
    };
    if (!nextSnapshotEval.baseline_snapshot_id) delete nextSnapshotEval.baseline_snapshot_id;
    if (!nextSnapshotEval.baseline_source_run_id) delete nextSnapshotEval.baseline_source_run_id;
    const nextConfig: SourceEvalConfig = { ...sourceConfig, snapshot_eval: nextSnapshotEval };
    writeFileSync(filePath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
    asJson(res, 200, readConfigRecord(filePath, settings.evalsDir, settings.librariesDir));
    return true;
  }

  if (pathname.startsWith('/api/evals/') && method === 'PUT') {
    const id = pathname.replace('/api/evals/', '');
    const currentPath = decodeEvalId(id, settings.evalsDir);
    if (!existsSync(currentPath)) {
      asJson(res, 404, { error: 'Config not found' });
      return true;
    }
    const body = await parseBody(req);
    const config = body.config as SourceEvalConfig | undefined;
    if (!config || typeof config !== 'object') {
      asJson(res, 400, { error: 'Missing config object' });
      return true;
    }
    let targetPath = currentPath;
    const nextFileName = String(body.fileName ?? '').trim();
    if (nextFileName) {
      const baseName = safeFileName(nextFileName);
      const desiredPath = ensureInsideRoot(
        settings.evalsDir,
        join(settings.evalsDir, `${baseName}.yaml`)
      );
      if (desiredPath !== currentPath) {
        let uniquePath = desiredPath;
        let suffix = 1;
        while (existsSync(uniquePath)) {
          uniquePath = ensureInsideRoot(
            settings.evalsDir,
            join(settings.evalsDir, `${baseName}-${suffix}.yaml`)
          );
          suffix += 1;
        }
        renameSync(currentPath, uniquePath);
        targetPath = uniquePath;
      }
    }
    writeFileSync(targetPath, `${stringifyYaml(normalizeSourceConfigForWrite(config))}\n`, 'utf8');
    asJson(res, 200, readConfigRecord(targetPath, settings.evalsDir, settings.librariesDir));
    return true;
  }

  if (pathname.startsWith('/api/evals/') && method === 'DELETE') {
    const id = pathname.replace('/api/evals/', '');
    const filePath = decodeEvalId(id, settings.evalsDir);
    if (!existsSync(filePath)) {
      asJson(res, 404, { error: 'Config not found' });
      return true;
    }
    unlinkSync(filePath);
    asJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
