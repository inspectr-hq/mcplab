import type {
  EvalConfig,
  ServerVariant,
  ServerSet,
  ServerComparisonMetadata,
  ResultsJson,
  ScenarioRunTraceRecord
} from './types.js';

export function toServerSets(variants: ServerVariant[]): ServerSet[] {
  return variants.map(({ serverIds, ...set }) => ({
    ...set,
    ...(serverIds === undefined ? {} : { servers: serverIds })
  }));
}

/** Normalize public runtime names once, preserving the stored execution format. */
export function normalizeRuntimeServerSelection(input: {
  server_sets?: unknown;
  servers?: unknown;
  [key: string]: unknown;
}): { serverVariants?: unknown; serverOverrideAll?: string[] } {
  for (const [field, replacement] of [
    ['serverVariants', 'server_sets'],
    ['server_variants', 'server_sets'],
    ['serverOverrideAll', 'servers'],
    ['server_override_all', 'servers']
  ] as const) {
    if (Object.hasOwn(input, field)) throw new Error(`Use ${replacement}`);
  }
  let serverVariants: unknown;
  if (input.server_sets !== undefined) {
    if (!Array.isArray(input.server_sets) || !input.server_sets.length)
      throw new Error('server_sets must be a nonempty array');
    serverVariants = input.server_sets.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid server set');
      const { servers, serverIds, ...set } = raw as Record<string, unknown>;
      if (serverIds !== undefined) throw new Error('Use servers inside server_sets');
      return { ...set, serverIds: servers };
    });
  }
  const selected = input.servers;
  let serverOverrideAll: string[] | undefined;
  if (selected !== undefined) {
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.some((id) => typeof id !== 'string' || !id.trim())
    )
      throw new Error('servers must be a nonempty array of server ids');
    serverOverrideAll = selected.map((id: string) => id.trim());
  }
  if (serverVariants !== undefined && serverOverrideAll !== undefined)
    throw new Error('server_sets and servers are mutually exclusive');
  return { serverVariants, serverOverrideAll };
}

export function scenarioExecutionKey(scenarioId: string, agent: string, variant?: string): string {
  return JSON.stringify([scenarioId, agent, variant ?? '']);
}

export function parseServerVariant(value: string): ServerVariant {
  const separator = value.indexOf('=');
  const id = value.slice(0, separator).trim();
  const selection = value.slice(separator + 1).trim();
  if (separator < 1 || !id || !selection) {
    throw new Error('Expected --server-set <id=default|serverId[,serverId...]>');
  }
  if (selection === 'default') return { id };
  const serverIds = selection
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (!serverIds.length) throw new Error('A server set must include at least one server');
  return { id, serverIds };
}

export function planServerVariants(
  config: EvalConfig,
  input: unknown,
  overrides?: { serverOverrideAll?: unknown; scenarioServerOverrides?: unknown }
): ServerVariant[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length < 1)
    throw new Error('serverVariants must be a nonempty array');
  if (overrides?.serverOverrideAll != null || overrides?.scenarioServerOverrides != null) {
    throw new Error('Server comparisons cannot be combined with runtime server overrides');
  }
  const ids = new Set<string>();
  const scenarioIds = new Set(config.scenarios.map((scenario) => scenario.id));
  const servers = (value: unknown, allowEmpty = false): string[] => {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error('Server set selections must be arrays of server ids');
    }
    const selected = [...new Set(value.map((id: string) => id.trim()))];
    if (!allowEmpty && !selected.length)
      throw new Error('A server set must include at least one server');
    for (const id of selected) {
      if (!Object.hasOwn(config.servers, id))
        throw new Error(`Unknown server in server set: ${id}`);
    }
    return selected;
  };
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid server set');
    const value = raw as ServerVariant;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) throw new Error('Server set id is required');
    if (ids.has(id)) throw new Error('Server set ids must be unique');
    ids.add(id);
    if (value.label !== undefined && typeof value.label !== 'string')
      throw new Error('Invalid server set label');
    const serverIds = value.serverIds === undefined ? undefined : servers(value.serverIds);
    const frozen = value.scenarioServerOverrides;
    if (frozen !== undefined && (!frozen || typeof frozen !== 'object' || Array.isArray(frozen))) {
      throw new Error('Invalid server set scenario bindings');
    }
    for (const [scenarioId, binding] of Object.entries(frozen ?? {})) {
      servers(binding, true);
      if (!scenarioIds.has(scenarioId))
        throw new Error(`Unknown scenario in server set: ${scenarioId}`);
    }
    const scenarioServerOverrides = Object.fromEntries(
      config.scenarios.map((scenario) => [
        scenario.id,
        servers(frozen?.[scenario.id] ?? serverIds ?? scenario.servers, true)
      ])
    );
    const label =
      value.label?.trim() ||
      serverIds?.map((serverId) => config.servers[serverId].name?.trim() || serverId).join(' + ') ||
      'Scenario defaults';
    return { id, label, ...(serverIds ? { serverIds } : {}), scenarioServerOverrides };
  });
}

export function serverComparisonMetadata(
  metadata: ServerComparisonMetadata
): ServerComparisonMetadata {
  return {
    server_variants: metadata.server_variants,
    rerun_server_variants: metadata.rerun_server_variants,
    rerun_runs_per_scenario: metadata.rerun_runs_per_scenario,
    server_variant_errors: metadata.server_variant_errors
  };
}

export function annotateServerVariant(
  results: ResultsJson,
  traceRecords: ScenarioRunTraceRecord[],
  variant: ServerVariant
) {
  const bindings = (scenarioId: string) => [
    ...(variant.scenarioServerOverrides?.[scenarioId] ?? variant.serverIds ?? [])
  ];
  return {
    results: {
      ...results,
      scenarios: results.scenarios.map((scenario) => ({
        ...scenario,
        server_variant: variant.id,
        servers: bindings(scenario.scenario_id)
      }))
    },
    traceRecords: traceRecords.map((record) => ({
      ...record,
      server_variant: variant.id,
      servers: bindings(record.scenario_id)
    }))
  };
}
