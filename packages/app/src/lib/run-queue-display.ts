import type { EvalConfig } from '@/types/eval';

type ScenarioLabelMapByConfigPath = ReadonlyMap<string, ReadonlyMap<string, string>>;

export function buildRelativePathBySourcePath(configs: EvalConfig[]): Map<string, string> {
  const pairs = configs
    .filter(
      (cfg): cfg is EvalConfig & { sourcePath: string; relativePath: string } =>
        typeof cfg.sourcePath === 'string' &&
        cfg.sourcePath.trim().length > 0 &&
        typeof cfg.relativePath === 'string' &&
        cfg.relativePath.trim().length > 0
    )
    .map((cfg) => [cfg.sourcePath, cfg.relativePath] as const);
  return new Map<string, string>(pairs);
}

export function buildEvalNameBySourcePath(configs: EvalConfig[]): Map<string, string> {
  const pairs = configs
    .filter(
      (cfg): cfg is EvalConfig & { sourcePath: string } =>
        typeof cfg.sourcePath === 'string' && cfg.sourcePath.trim().length > 0
    )
    .map((cfg) => [cfg.sourcePath, cfg.configName?.trim() || cfg.name] as const);
  return new Map<string, string>(pairs);
}

export function buildScenarioLabelByConfigPath(
  configs: EvalConfig[],
  libraryScenarios: EvalConfig['scenarios']
): Map<string, Map<string, string>> {
  const byPath = new Map<string, Map<string, string>>();
  for (const config of configs) {
    if (!config.sourcePath) continue;
    const byScenarioId = new Map<string, string>();
    const entries =
      config.scenarioEntries && config.scenarioEntries.length > 0
        ? config.scenarioEntries
        : config.scenarios.map((scenario) => ({ kind: 'inline' as const, scenario }));

    for (const entry of entries) {
      if (entry.kind === 'inline') {
        byScenarioId.set(entry.scenario.id, entry.scenario.name?.trim() || entry.scenario.id);
        continue;
      }
      const fromLibrary = libraryScenarios.find((scenario) => scenario.id === entry.ref);
      byScenarioId.set(entry.ref, fromLibrary?.name?.trim() || entry.ref);
    }

    byPath.set(config.sourcePath, byScenarioId);
  }
  return byPath;
}

export function formatQueueConfigPath(
  configPath: string,
  relativePathBySourcePath: ReadonlyMap<string, string>
): string {
  const fromConfigCatalog = relativePathBySourcePath.get(configPath);
  if (fromConfigCatalog) return fromConfigCatalog;

  const normalized = configPath.replace(/\\/g, '/');
  const evalsMarker = '/evals/';
  const markerIndex = normalized.lastIndexOf(evalsMarker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + evalsMarker.length);
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;
  return parts.slice(-3).join('/');
}

export function formatQueueScenarioLabel(
  scenarioIds: string[] | null,
  scenarioLabelByConfigPath: ScenarioLabelMapByConfigPath,
  configPath: string
): string {
  const labelsForConfig = scenarioLabelByConfigPath.get(configPath);
  if (!scenarioIds || scenarioIds.length === 0) {
    if (labelsForConfig && labelsForConfig.size === 1) {
      const onlyScenario = labelsForConfig.values().next().value;
      if (onlyScenario) return onlyScenario;
    }
    return 'All scenarios';
  }

  if (!labelsForConfig) {
    if (scenarioIds.length === 1) return scenarioIds[0];
    return `${scenarioIds[0]} +${scenarioIds.length - 1}`;
  }

  const labels = scenarioIds.map((id) => labelsForConfig.get(id) ?? id);
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1}`;
}
