import { basename, extname, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { SourceEvalConfig } from '@inspectr/mcplab-core';
import { loadConfig } from '@inspectr/mcplab-core';
import { encodeEvalId, ensureInsideRoot } from './store-utils.js';

export interface ConfigRecord {
  id: string;
  name: string;
  path: string;
  mtime: string;
  hash: string;
  config: SourceEvalConfig;
  error?: string;
  warnings?: string[];
}

export function readConfigRecord(
  absPath: string,
  evalsDir: string,
  bundleRoot?: string
): ConfigRecord {
  const {
    config: _resolvedConfig,
    sourceConfig,
    hash,
    warnings
  } = loadConfig(absPath, { bundleRoot });
  const stat = statSync(absPath);
  const name = basename(absPath, extname(absPath));
  return {
    id: encodeEvalId(absPath, evalsDir),
    name,
    path: absPath,
    mtime: stat.mtime.toISOString(),
    hash,
    config: sourceConfig,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

function emptySourceConfig(): SourceEvalConfig {
  return {
    name: undefined,
    servers: [],
    agents: [],
    scenarios: []
  };
}

function parseSourceConfigForInvalidRecord(absPath: string): SourceEvalConfig {
  try {
    const raw = readFileSync(absPath, 'utf8');
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptySourceConfig();
    const obj = parsed as Record<string, unknown>;
    return {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      servers:
        Array.isArray(obj.servers)
          ? (obj.servers as SourceEvalConfig['servers'])
          : obj.servers && typeof obj.servers === 'object'
            ? Object.entries(obj.servers as Record<string, Record<string, unknown>>).map(
                ([name, server]) => ({
                  id: name,
                  transport: String(server.transport ?? 'http') as 'http',
                  url: String(server.url ?? ''),
                  auth:
                    server.auth && typeof server.auth === 'object'
                      ? (server.auth as SourceEvalConfig['servers'][number] extends infer S
                          ? S extends { auth?: infer A }
                            ? A
                            : never
                          : never)
                      : undefined
                })
              )
            : [],
      agents:
        Array.isArray(obj.agents)
          ? (obj.agents as SourceEvalConfig['agents'])
          : obj.agents && typeof obj.agents === 'object'
            ? Object.entries(obj.agents as Record<string, Record<string, unknown>>).map(
                ([name, agent]) => ({
                  id: name,
                  provider: String(agent.provider ?? 'openai') as 'openai' | 'anthropic' | 'azure_openai',
                  model: String(agent.model ?? ''),
                  temperature:
                    typeof agent.temperature === 'number' ? agent.temperature : undefined,
                  max_tokens:
                    typeof agent.max_tokens === 'number' ? agent.max_tokens : undefined,
                  system: typeof agent.system === 'string' ? agent.system : undefined
                })
              )
            : [],
      scenarios: Array.isArray(obj.scenarios) ? (obj.scenarios as SourceEvalConfig['scenarios']) : [],
      run_defaults:
        obj.run_defaults && typeof obj.run_defaults === 'object' && !Array.isArray(obj.run_defaults)
          ? (obj.run_defaults as SourceEvalConfig['run_defaults'])
          : undefined,
      snapshot_eval:
        obj.snapshot_eval &&
        typeof obj.snapshot_eval === 'object' &&
        !Array.isArray(obj.snapshot_eval)
          ? (obj.snapshot_eval as SourceEvalConfig['snapshot_eval'])
          : undefined
    };
  } catch {
    return emptySourceConfig();
  }
}

export function readConfigRecordOrInvalid(
  absPath: string,
  evalsDir: string,
  bundleRoot?: string
): ConfigRecord {
  try {
    return readConfigRecord(absPath, evalsDir, bundleRoot);
  } catch (error) {
    const stat = statSync(absPath);
    const name = basename(absPath, extname(absPath));
    return {
      id: encodeEvalId(absPath, evalsDir),
      name,
      path: absPath,
      mtime: stat.mtime.toISOString(),
      hash: '',
      config: parseSourceConfigForInvalidRecord(absPath),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function listConfigs(evalsDir: string, bundleRoot?: string): ConfigRecord[] {
  if (!existsSync(evalsDir)) return [];
  const files = readdirSync(evalsDir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .map((name) => ensureInsideRoot(evalsDir, join(evalsDir, name)));
  const records = files.map((path) => readConfigRecordOrInvalid(path, evalsDir, bundleRoot));
  return records.sort((a, b) => a.name.localeCompare(b.name));
}
