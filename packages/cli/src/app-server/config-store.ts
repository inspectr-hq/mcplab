import { basename, extname, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { SourceEvalConfig } from '@inspectr/mcplab-core';
import { loadConfig, normalizeSourceConfig } from '@inspectr/mcplab-core';
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
    return normalizeSourceConfig(parsed as SourceEvalConfig).config;
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
  return records.sort((a, b) => {
    const nameA = (typeof a.config.name === 'string' && a.config.name.trim()) || a.name;
    const nameB = (typeof b.config.name === 'string' && b.config.name.trim()) || b.name;
    return nameA.localeCompare(nameB);
  });
}
