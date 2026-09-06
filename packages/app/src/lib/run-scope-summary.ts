import type { EvalResult } from '@/types/eval';

export type RunScopeSummary = {
  scenarioCount: number;
  agentCount: number;
  scopePreview: string;
  modelSummary: string;
};

export function getScenarioLabels(run: EvalResult): string[] {
  return Array.from(
    new Map(
      run.scenarios
        .map((scenario) => {
          const id = String(scenario.scenarioId ?? '').trim();
          const name = String(scenario.scenarioName ?? '').trim();
          if (!id && !name) return null;
          return [id || name, name || id] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry))
    ).values()
  );
}

export function buildRunScopeSummary(run: EvalResult): RunScopeSummary {
  const scenarioLabels = getScenarioLabels(run);
  const perScenarioAgents = run.scenarios
    .map((scenario) => scenario.agentName || scenario.agentId)
    .filter(Boolean);
  const agentNames = Array.from(
    new Set(perScenarioAgents.length > 0 ? perScenarioAgents : run.rerunAgents ?? [])
  );
  const models = Array.from(
    new Set(run.scenarios.map((scenario) => scenario.model).filter((m): m is string => Boolean(m)))
  );

  const scenarioPreview = scenarioLabels.slice(0, 2).join(', ');
  const scenarioRemainder = scenarioLabels.length > 2 ? ` +${scenarioLabels.length - 2}` : '';
  const modelPreview = models.slice(0, 2).join(', ');
  const modelRemainder = models.length > 2 ? ` +${models.length - 2}` : '';
  const evalName = run.configName?.trim() || '';
  const configPath = run.configPath?.trim() || '';
  const evalLabel = evalName || configPath;

  return {
    scenarioCount: scenarioLabels.length,
    agentCount: agentNames.length,
    scopePreview: evalLabel || (scenarioPreview ? `${scenarioPreview}${scenarioRemainder}` : 'n/a'),
    modelSummary: modelPreview ? `${modelPreview}${modelRemainder}` : ''
  };
}
