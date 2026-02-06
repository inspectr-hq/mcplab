import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { EvalConfig } from './types.js';

export function loadConfig(path: string): { config: EvalConfig; hash: string; raw: string } {
  const raw = readFileSync(path, 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex');
  const config = parse(raw) as EvalConfig;

  if (!config || typeof config !== 'object') {
    throw new Error('Invalid config: expected object');
  }
  if (!config.servers || typeof config.servers !== 'object') {
    throw new Error('Invalid config: missing servers');
  }
  if (!config.agents || typeof config.agents !== 'object') {
    throw new Error('Invalid config: missing agents');
  }
  if (!Array.isArray(config.scenarios)) {
    throw new Error('Invalid config: scenarios must be an array');
  }

  return { config, hash, raw };
}

export function selectScenarios(config: EvalConfig, scenarioId?: string): EvalConfig {
  if (!scenarioId) return config;
  const scenarios = config.scenarios.filter((s) => s.id === scenarioId);
  if (scenarios.length === 0) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }
  return { ...config, scenarios };
}
