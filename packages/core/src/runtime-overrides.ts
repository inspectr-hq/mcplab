import type { EvalConfig } from './types.js';

export interface RuntimeServerOverrides {
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
}

function normalizeServerIds(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => String(id).trim()).filter(Boolean);
}

function ensureKnownServerIds(config: EvalConfig, ids: string[], context: string): void {
  const missing = ids.filter((id) => !config.servers[id]);
  if (missing.length > 0) {
    throw new Error(`Unknown server refs in ${context}: ${missing.join(', ')}`);
  }
}

export function applyRuntimeServerOverrides(
  config: EvalConfig,
  overrides?: RuntimeServerOverrides
): EvalConfig {
  if (!overrides) return config;
  const rawGlobal = overrides.serverOverrideAll;
  const globalIds = normalizeServerIds(rawGlobal);
  const hasGlobal = Array.isArray(rawGlobal);
  if (hasGlobal && globalIds.length === 0) {
    throw new Error('serverOverrideAll must include at least one server id');
  }
  if (hasGlobal) {
    ensureKnownServerIds(config, globalIds, 'serverOverrideAll');
  }

  const overrideMapRaw = overrides.scenarioServerOverrides ?? {};
  const overrideEntries = Object.entries(overrideMapRaw).filter(
    ([scenarioId]) => String(scenarioId).trim().length > 0
  );
  if (!hasGlobal && overrideEntries.length === 0) return config;

  const scenarioIds = new Set(config.scenarios.map((scenario) => scenario.id));
  const unknownScenarios = overrideEntries
    .map(([scenarioId]) => scenarioId)
    .filter((scenarioId) => !scenarioIds.has(scenarioId));
  if (unknownScenarios.length > 0) {
    throw new Error(
      `Unknown scenarios in scenarioServerOverrides: ${unknownScenarios.join(
        ', '
      )}. Available: ${config.scenarios.map((scenario) => scenario.id).join(', ')}`
    );
  }

  const normalizedOverrides = new Map<string, string[]>();
  for (const [scenarioId, serverIds] of overrideEntries) {
    const normalizedIds = normalizeServerIds(serverIds);
    ensureKnownServerIds(config, normalizedIds, `scenarioServerOverrides.${scenarioId}`);
    normalizedOverrides.set(scenarioId, normalizedIds);
  }

  const scenarios = config.scenarios.map((scenario) => {
    const nextServers = hasGlobal ? [...globalIds] : [...scenario.servers];
    if (normalizedOverrides.has(scenario.id)) {
      return { ...scenario, servers: [...(normalizedOverrides.get(scenario.id) ?? [])] };
    }
    return { ...scenario, servers: nextServers };
  });
  return { ...config, scenarios };
}
