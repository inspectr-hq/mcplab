import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { normalizeSourceConfig, type SourceEvalConfig } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';

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
    let normalizedConfig: SourceEvalConfig;
    try {
      normalizedConfig = normalizeSourceConfig(config).config;
    } catch (error) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    writeFileSync(filePath, `${stringifyYaml(normalizedConfig)}\n`, 'utf8');
    asJson(res, 201, readConfigRecord(filePath, settings.evalsDir, settings.librariesDir));
    return true;
  }

  if (pathname.startsWith('/api/evals/') && method === 'GET') {
    const id = pathname.replace('/api/evals/', '');
    const filePath = decodeEvalId(id, settings.evalsDir);
    asJson(res, 200, readConfigRecordOrInvalid(filePath, settings.evalsDir, settings.librariesDir));
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
      const currentDir = dirname(currentPath);
      const desiredPath = ensureInsideRoot(settings.evalsDir, join(currentDir, `${baseName}.yaml`));
      if (desiredPath !== currentPath) {
        let uniquePath = desiredPath;
        let suffix = 1;
        while (existsSync(uniquePath)) {
          uniquePath = ensureInsideRoot(
            settings.evalsDir,
            join(currentDir, `${baseName}-${suffix}.yaml`)
          );
          suffix += 1;
        }
        renameSync(currentPath, uniquePath);
        targetPath = uniquePath;
      }
    }
    let normalizedConfig: SourceEvalConfig;
    try {
      normalizedConfig = normalizeSourceConfig(config).config;
    } catch (error) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    writeFileSync(targetPath, `${stringifyYaml(normalizedConfig)}\n`, 'utf8');
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
