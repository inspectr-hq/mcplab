import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { EvalConfig } from './types.js';

export function loadConfig(
  path: string,
  options?: { bundleRoot?: string }
): {
  config: EvalConfig;
  sourceConfig: EvalConfig;
  hash: string;
  raw: string;
} {
  const raw = readFileSync(path, 'utf8');
  const sourceConfig = parse(raw) as EvalConfig;

  if (!sourceConfig || typeof sourceConfig !== 'object') {
    throw new Error('Invalid config: expected object');
  }
  const normalizedSource = normalizeConfig(sourceConfig);
  const config = resolveReferences(normalizedSource, path, options?.bundleRoot);
  const hash = createHash('sha256').update(stableStringify(config)).digest('hex');
  return { config, sourceConfig: normalizedSource, hash, raw };
}

export function selectScenarios(config: EvalConfig, scenarioId?: string): EvalConfig {
  if (!scenarioId) return config;
  const scenarios = config.scenarios.filter((s) => s.id === scenarioId);
  if (scenarios.length === 0) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }
  return { ...config, scenarios };
}

function resolveReferences(
  sourceConfig: EvalConfig,
  configPath: string,
  bundleRootOverride?: string
): EvalConfig {
  const bundleRoot = bundleRootOverride
    ? resolve(bundleRootOverride)
    : detectBundleRoot(configPath);
  const libraryServers = readYaml<Record<string, EvalConfig['servers'][string]>>(
    join(bundleRoot, 'servers.yaml'),
    {}
  );
  const libraryAgents = readYaml<Record<string, EvalConfig['agents'][string]>>(
    join(bundleRoot, 'agents.yaml'),
    {}
  );
  const libraryScenarios = readScenarioLibrary(join(bundleRoot, 'scenarios'));

  const servers = { ...(sourceConfig.servers ?? {}) };
  const missingServerRefs: string[] = [];
  for (const ref of sourceConfig.server_refs ?? []) {
    if (!servers[ref] && libraryServers[ref]) {
      servers[ref] = libraryServers[ref];
      continue;
    }
    if (!servers[ref]) missingServerRefs.push(ref);
  }

  const agents = { ...(sourceConfig.agents ?? {}) };
  const missingAgentRefs: string[] = [];
  for (const ref of sourceConfig.agent_refs ?? []) {
    if (!agents[ref] && libraryAgents[ref]) {
      agents[ref] = libraryAgents[ref];
      continue;
    }
    if (!agents[ref]) missingAgentRefs.push(ref);
  }

  const existingScenarioIds = new Set(
    (sourceConfig.scenarios ?? []).map((scenario) => scenario.id)
  );
  const scenarios = [...(sourceConfig.scenarios ?? [])];
  const missingScenarioRefs: string[] = [];
  for (const ref of sourceConfig.scenario_refs ?? []) {
    if (existingScenarioIds.has(ref)) continue;
    const scenario = libraryScenarios[ref];
    if (!scenario) {
      missingScenarioRefs.push(ref);
      continue;
    }
    scenarios.push(scenario);
  }

  const missingMessages: string[] = [];
  if (missingServerRefs.length > 0) {
    missingMessages.push(`server_refs: ${missingServerRefs.join(', ')}`);
  }
  if (missingAgentRefs.length > 0) {
    missingMessages.push(`agent_refs: ${missingAgentRefs.join(', ')}`);
  }
  if (missingScenarioRefs.length > 0) {
    missingMessages.push(`scenario_refs: ${missingScenarioRefs.join(', ')}`);
  }
  if (missingMessages.length > 0) {
    throw new Error(`Unresolved config references (${bundleRoot}): ${missingMessages.join(' | ')}`);
  }

  return {
    ...sourceConfig,
    servers,
    agents,
    scenarios
  };
}

function normalizeConfig(sourceConfig: EvalConfig): EvalConfig {
  const normalized: EvalConfig = {
    ...sourceConfig,
    servers: sourceConfig.servers ?? {},
    server_refs: sourceConfig.server_refs ?? [],
    agents: sourceConfig.agents ?? {},
    agent_refs: sourceConfig.agent_refs ?? [],
    scenarios: sourceConfig.scenarios ?? [],
    scenario_refs: sourceConfig.scenario_refs ?? []
  };

  if (typeof normalized.servers !== 'object' || Array.isArray(normalized.servers)) {
    throw new Error('Invalid config: servers must be an object');
  }
  if (typeof normalized.agents !== 'object' || Array.isArray(normalized.agents)) {
    throw new Error('Invalid config: agents must be an object');
  }
  if (!Array.isArray(normalized.scenarios)) {
    throw new Error('Invalid config: scenarios must be an array');
  }
  if (!Array.isArray(normalized.server_refs)) {
    throw new Error('Invalid config: server_refs must be an array');
  }
  if (!Array.isArray(normalized.agent_refs)) {
    throw new Error('Invalid config: agent_refs must be an array');
  }
  if (!Array.isArray(normalized.scenario_refs)) {
    throw new Error('Invalid config: scenario_refs must be an array');
  }

  return normalized;
}

function readYaml<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, 'utf8');
    return (parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function readScenarioLibrary(
  scenariosDir: string
): Record<string, EvalConfig['scenarios'][number]> {
  if (!existsSync(scenariosDir)) return {};
  const out: Record<string, EvalConfig['scenarios'][number]> = {};
  const files = readdirSync(scenariosDir).filter(
    (name) => name.endsWith('.yaml') || name.endsWith('.yml')
  );
  for (const file of files) {
    const scenario = readYaml<EvalConfig['scenarios'][number] | null>(
      join(scenariosDir, file),
      null
    );
    if (!scenario || !scenario.id) continue;
    out[scenario.id] = scenario;
  }
  return out;
}

function detectBundleRoot(configPath: string): string {
  const abs = resolve(configPath);
  const configDir = dirname(abs);
  if (configDir.endsWith('/configs') || configDir.endsWith('\\configs')) {
    return dirname(configDir);
  }
  return configDir;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}
