import type { EvalResult, ScenarioResult } from '@/types/eval';

export type ComparisonDimension = 'agents' | 'servers';

export function withinRunOptions(run: EvalResult | undefined, dimension: ComparisonDimension) {
  if (!run) return [];
  const options = new Map<string, string>();
  if (dimension === 'agents') for (const agent of run.rerunAgents ?? []) options.set(agent, agent);
  if (dimension === 'servers') {
    for (const variant of run.server_variants ?? [])
      options.set(variant.id, variant.label || variant.id);
  }
  for (const scenario of run.scenarios) {
    if (dimension === 'servers') {
      if (scenario.server_variant)
        options.set(
          scenario.server_variant,
          options.get(scenario.server_variant) ??
            scenario.servers?.join(' + ') ??
            scenario.server_variant
        );
    } else options.set(scenario.agentId, scenario.agentName || scenario.agentId);
  }
  return Array.from(options, ([id, name]) => ({ id, name }));
}

export function buildWithinRunRows(
  run: EvalResult,
  dimension: ComparisonDimension,
  heldId?: string
) {
  const rows = new Map<
    string,
    {
      scenarioId: string;
      scenarioName: string;
      displayLabel: string;
      byColumn: Record<string, ScenarioResult>;
    }
  >();
  for (const scenario of run.scenarios) {
    const otherId = dimension === 'servers' ? scenario.agentId : scenario.server_variant;
    if (heldId !== undefined && otherId !== heldId) continue;
    const column = dimension === 'servers' ? scenario.server_variant : scenario.agentId;
    if (!column) continue;
    const row = rows.get(scenario.scenarioId) ?? {
      scenarioId: scenario.scenarioId,
      scenarioName: scenario.scenarioName,
      displayLabel: scenario.scenarioName || scenario.scenarioId,
      byColumn: {}
    };
    row.byColumn[column] = scenario;
    rows.set(scenario.scenarioId, row);
  }
  return [...rows.values()].sort((a, b) => a.displayLabel.localeCompare(b.displayLabel));
}
