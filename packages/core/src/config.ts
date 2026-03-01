import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import type {
  AgentInlineEntry,
  AgentListEntry,
  AgentRefEntry,
  EvalConfig,
  ExecutableEvalConfig,
  Scenario,
  ScenarioListEntry,
  ScenarioRefEntry,
  SourceEvalConfig
} from './types.js';

export function loadConfig(
  path: string,
  options?: { bundleRoot?: string }
): {
  config: EvalConfig;
  sourceConfig: SourceEvalConfig;
  hash: string;
  raw: string;
  warnings: string[];
} {
  const raw = readFileSync(path, 'utf8');
  const sourceConfig = parse(raw) as SourceEvalConfig;

  if (!sourceConfig || typeof sourceConfig !== 'object') {
    throw new Error('Invalid config: expected object');
  }
  const { config: normalizedSource, warnings } = normalizeConfig(sourceConfig);
  const config = resolveReferences(normalizedSource, path, options?.bundleRoot);
  const hash = createHash('sha256').update(stableStringify(config)).digest('hex');
  return { config, sourceConfig: normalizedSource, hash, raw, warnings };
}

export function selectScenarios<T extends { scenarios: Array<{ id: string }> }>(
  config: T,
  scenarioId?: string
): T {
  if (!scenarioId) return config;
  const scenarios = config.scenarios.filter((s) => s.id === scenarioId);
  if (scenarios.length === 0) {
    throw new Error(`Scenario not found: ${scenarioId}`);
  }
  return { ...config, scenarios } as T;
}

function resolveReferences(
  sourceConfig: SourceEvalConfig,
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

  const missingAgentRefs: string[] = [];
  const resolvedAgents: Record<string, EvalConfig['agents'][string]> = {};
  const seenAgentNames = new Set<string>();
  for (const entry of sourceConfig.agents ?? []) {
    if (isAgentRefEntry(entry)) {
      const ref = String(entry.ref || '').trim();
      if (!ref) {
        missingAgentRefs.push('(empty-ref)');
        continue;
      }
      const agent = libraryAgents[ref];
      if (!agent) {
        missingAgentRefs.push(ref);
        continue;
      }
      if (seenAgentNames.has(ref)) {
        throw new Error(`Duplicate agent name detected while resolving refs: ${ref}`);
      }
      seenAgentNames.add(ref);
      resolvedAgents[ref] = agent;
      continue;
    }
    const inlineName = String((entry as { name?: unknown }).name ?? '').trim();
    if (!inlineName) {
      throw new Error('Invalid config: inline agent is missing required name');
    }
    if (seenAgentNames.has(inlineName)) {
      throw new Error(`Duplicate agent name detected: ${inlineName}`);
    }
    seenAgentNames.add(inlineName);
    resolvedAgents[inlineName] = {
      provider: entry.provider,
      model: entry.model,
      temperature: entry.temperature,
      max_tokens: entry.max_tokens,
      system: entry.system
    };
  }

  const scenarios: Scenario[] = [];
  const seenScenarioIds = new Set<string>();
  const missingScenarioRefs: string[] = [];

  for (const entry of sourceConfig.scenarios ?? []) {
    if (isScenarioRefEntry(entry)) {
      const ref = String(entry.ref || '').trim();
      if (!ref) {
        missingScenarioRefs.push('(empty-ref)');
        continue;
      }
      const scenario = libraryScenarios[ref];
      if (!scenario) {
        missingScenarioRefs.push(ref);
        continue;
      }
      if (seenScenarioIds.has(scenario.id)) {
        throw new Error(`Duplicate scenario id detected while resolving refs: ${scenario.id}`);
      }
      seenScenarioIds.add(scenario.id);
      scenarios.push(scenario);
      continue;
    }

    const inline = entry as Scenario;
    const inlineId = String(inline.id || '').trim();
    if (!inlineId) {
      throw new Error('Invalid config: inline scenario is missing required id');
    }
    if (seenScenarioIds.has(inlineId)) {
      throw new Error(`Duplicate scenario id detected: ${inlineId}`);
    }
    seenScenarioIds.add(inlineId);
    scenarios.push(inline);
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
  const defaultAgents = sourceConfig.run_defaults?.selected_agents ?? [];
  const missingDefaultAgents = defaultAgents.filter((agent) => !resolvedAgents[agent]);
  if (missingDefaultAgents.length > 0) {
    missingMessages.push(`run_defaults.selected_agents: ${missingDefaultAgents.join(', ')}`);
  }
  if (
    sourceConfig.run_defaults?.selected_agents &&
    sourceConfig.run_defaults.selected_agents.length === 0
  ) {
    missingMessages.push('run_defaults.selected_agents must include at least one valid agent');
  }
  if (missingMessages.length > 0) {
    throw new Error(`Unresolved config references (${bundleRoot}): ${missingMessages.join(' | ')}`);
  }

  return {
    ...sourceConfig,
    servers,
    agents: resolvedAgents,
    scenarios
  };
}

function normalizeConfig(
  sourceConfig: SourceEvalConfig
): { config: SourceEvalConfig; warnings: string[] } {
  const warnings: string[] = [];
  const legacyPinnedAgents = new Set<string>();
  const scenariosInput = Array.isArray(sourceConfig.scenarios) ? sourceConfig.scenarios : [];
  const rawAgents = (sourceConfig as { agents?: unknown }).agents;
  const agentsInput = Array.isArray(rawAgents) ? rawAgents : [];
  const normalizedAgents: AgentListEntry[] = [];
  if (Array.isArray(rawAgents)) {
    for (const rawAgent of agentsInput) {
      const agent = rawAgent as AgentListEntry;
      if (isAgentRefEntry(agent)) {
        const ref = String(agent.ref ?? '').trim();
        if (!ref) throw new Error('Invalid config: agent ref must be a non-empty name');
        normalizedAgents.push({ ref });
        continue;
      }
      const inlineName = String((agent as AgentInlineEntry).name ?? '').trim();
      if (!inlineName) throw new Error('Invalid config: inline agent is missing required name');
      normalizedAgents.push({
        name: inlineName,
        provider: (agent as AgentInlineEntry).provider,
        model: (agent as AgentInlineEntry).model,
        temperature: (agent as AgentInlineEntry).temperature,
        max_tokens: (agent as AgentInlineEntry).max_tokens,
        system: (agent as AgentInlineEntry).system
      });
    }
  } else {
    const legacyInlineAgents =
      rawAgents && typeof rawAgents === 'object' && !Array.isArray(rawAgents)
        ? (rawAgents as Record<string, EvalConfig['agents'][string]>)
        : {};
    for (const [name, agent] of Object.entries(legacyInlineAgents)) {
      normalizedAgents.push({
        name,
        provider: agent.provider,
        model: agent.model,
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
        system: agent.system
      });
    }
  }
  const normalizedScenarios: ScenarioListEntry[] = [];
  for (const scenario of scenariosInput) {
    if (isScenarioRefEntry(scenario)) {
      const ref = String((scenario as ScenarioRefEntry).ref ?? '').trim();
      if (!ref) throw new Error('Invalid config: scenario ref must be a non-empty id');
      normalizedScenarios.push({ ref });
      continue;
    }
    const rawScenario = scenario as Scenario & {
      agent?: unknown;
      snapshot_eval_enabled?: unknown;
    };
    const nextScenario: Scenario = {
      id: rawScenario.id,
      name: rawScenario.name,
      servers: rawScenario.servers,
      prompt: rawScenario.prompt,
      eval: rawScenario.eval,
      extract: rawScenario.extract
    };
    const legacyAgent = typeof rawScenario.agent === 'string' ? rawScenario.agent.trim() : '';
    if (legacyAgent) legacyPinnedAgents.add(legacyAgent);
    const legacySnapshotEnabled =
      typeof rawScenario.snapshot_eval_enabled === 'boolean'
        ? rawScenario.snapshot_eval_enabled
        : undefined;
    if (rawScenario.snapshot_eval || legacySnapshotEnabled !== undefined) {
      nextScenario.snapshot_eval = {
        ...(rawScenario.snapshot_eval ?? {}),
        ...(legacySnapshotEnabled !== undefined ? { enabled: legacySnapshotEnabled } : {})
      };
    }
    normalizedScenarios.push(nextScenario);
  }

  const legacyAgentRefs = Array.isArray(sourceConfig.agent_refs)
    ? sourceConfig.agent_refs.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (legacyAgentRefs.length > 0) {
    const existingRefs = new Set(
      normalizedAgents.filter(isAgentRefEntry).map((entry) => entry.ref)
    );
    for (const ref of legacyAgentRefs) {
      if (existingRefs.has(ref)) continue;
      normalizedAgents.push({ ref });
    }
    warnings.push('Legacy agent_refs was migrated into agents[{ref}] and will be removed on next save.');
  }

  const legacyScenarioRefs = Array.isArray(sourceConfig.scenario_refs)
    ? sourceConfig.scenario_refs.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (legacyScenarioRefs.length > 0) {
    const existingRefs = new Set(
      normalizedScenarios.filter(isScenarioRefEntry).map((entry) => entry.ref)
    );
    for (const ref of legacyScenarioRefs) {
      if (existingRefs.has(ref)) continue;
      normalizedScenarios.push({ ref });
    }
    warnings.push(
      'Legacy scenario_refs was migrated into scenarios[{ref}] and will be removed on next save.'
    );
  }

  const normalized: SourceEvalConfig = {
    ...sourceConfig,
    servers: sourceConfig.servers ?? {},
    server_refs: sourceConfig.server_refs ?? [],
    agents: normalizedAgents,
    agent_refs: [],
    scenarios: normalizedScenarios,
    scenario_refs: []
  };

  if (typeof normalized.servers !== 'object' || Array.isArray(normalized.servers)) {
    throw new Error('Invalid config: servers must be an object');
  }
  if (!Array.isArray(normalized.agents)) {
    throw new Error('Invalid config: agents must be an array');
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
  if (
    normalized.run_defaults &&
    (typeof normalized.run_defaults !== 'object' || Array.isArray(normalized.run_defaults))
  ) {
    throw new Error('Invalid config: run_defaults must be an object');
  }
  if (
    normalized.run_defaults?.selected_agents !== undefined &&
    !Array.isArray(normalized.run_defaults.selected_agents)
  ) {
    throw new Error('Invalid config: run_defaults.selected_agents must be an array');
  }

  if (legacyPinnedAgents.size > 0) {
    const migrated = new Set<string>(normalized.run_defaults?.selected_agents ?? []);
    for (const agent of legacyPinnedAgents) migrated.add(agent);
    normalized.run_defaults = {
      ...(normalized.run_defaults ?? {}),
      selected_agents: Array.from(migrated)
    };
    warnings.push(
      `Legacy scenario.agent was migrated to run_defaults.selected_agents (union): ${Array.from(
        legacyPinnedAgents
      ).join(', ')}`
    );
  }
  if (
    normalized.scenarios.some(
      (s) => !isScenarioRefEntry(s) && s.snapshot_eval && 'enabled' in (s.snapshot_eval ?? {})
    ) &&
    scenariosInput.some((s: any) => s?.snapshot_eval_enabled !== undefined)
  ) {
    warnings.push(
      'Legacy scenario.snapshot_eval_enabled was migrated to scenario.snapshot_eval.enabled.'
    );
  }

  if (normalized.run_defaults?.selected_agents) {
    normalized.run_defaults.selected_agents = normalized.run_defaults.selected_agents
      .map((v) => String(v).trim())
      .filter(Boolean);
  }

  return { config: normalized, warnings };
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

export function expandConfigForAgents(
  config: EvalConfig,
  requestedAgents?: string[]
): ExecutableEvalConfig {
  const selectedAgents =
    requestedAgents && requestedAgents.length > 0 ? requestedAgents : Object.keys(config.agents);
  const missing = selectedAgents.filter((agent) => !config.agents[agent]);
  if (missing.length > 0) {
    throw new Error(
      `Unknown agents: ${missing.join(', ')}. Available: ${Object.keys(config.agents).join(', ')}`
    );
  }
  const inlineScenarios = config.scenarios.filter((scenario): scenario is Scenario =>
    !isScenarioRefEntry(scenario)
  );
  if (inlineScenarios.length !== config.scenarios.length) {
    throw new Error('Config contains unresolved scenario refs; resolve config before expansion');
  }
  const scenarios = inlineScenarios.flatMap((scenario) =>
    selectedAgents.map((agent) => ({
      ...scenario,
      agent,
      scenario_exec_id: `${scenario.id}-${agent}`
    }))
  );
  return { ...config, scenarios };
}

function isScenarioRefEntry(entry: ScenarioListEntry): entry is ScenarioRefEntry {
  return Boolean(entry && typeof entry === 'object' && 'ref' in entry);
}

function isAgentRefEntry(entry: AgentListEntry): entry is AgentRefEntry {
  return Boolean(entry && typeof entry === 'object' && 'ref' in entry);
}
