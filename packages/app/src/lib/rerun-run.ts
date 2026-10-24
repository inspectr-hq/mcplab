import type { EvalConfig, EvalResult } from '@/types/eval';
import { toServerSets, type EvalDataSource } from '@/lib/data-sources/types';

function normalizeConfigPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
}

// Length of the shared path, or 0 when neither path ends with the other on a segment boundary.
function configPathMatchLength(configuredPath: string, candidatePath: string): number {
  const configured = normalizeConfigPath(configuredPath);
  const candidate = normalizeConfigPath(candidatePath);
  if (configured === candidate) return configured.length;
  if (configured.endsWith(`/${candidate}`)) return candidate.length;
  if (candidate.endsWith(`/${configured}`)) return configured.length;
  return 0;
}

function configPaths(config: EvalConfig): string[] {
  return [config.relativePath, config.sourcePath].filter((path): path is string => Boolean(path));
}

function bestSuffixMatch(configs: EvalConfig[], configuredPath: string): EvalConfig | undefined {
  const scored = configs
    .map((config) => ({
      config,
      length: Math.max(
        0,
        ...configPaths(config).map((path) => configPathMatchLength(configuredPath, path))
      )
    }))
    .filter((entry) => entry.length > 0);
  const longest = Math.max(0, ...scored.map((entry) => entry.length));
  const best = scored.filter((entry) => entry.length === longest);
  return best.length === 1 ? best[0].config : undefined;
}

async function resolveConfigPath(source: EvalDataSource, run: EvalResult): Promise<string> {
  const configuredPath = run.configPath?.trim();
  if (!configuredPath) throw new Error('This run has no config path in metadata.');

  let configs;
  try {
    configs = await source.listConfigs();
  } catch {
    return configuredPath;
  }

  const normalizedPath = normalizeConfigPath(configuredPath);
  const exactMatch = configs.find((config) =>
    configPaths(config).some((path) => normalizeConfigPath(path) === normalizedPath)
  );
  const hashMatches = run.configHash
    ? configs.filter((config) => config.configHash === run.configHash)
    : [];
  const hashMatch = hashMatches.length === 1 ? hashMatches[0] : undefined;
  const configName = run.configName?.trim();
  const nameMatches = configName
    ? configs.filter(
        (config) => config.name.trim() === configName || config.configName?.trim() === configName
      )
    : [];
  const suffixMatch = bestSuffixMatch(configs, configuredPath);
  if (!exactMatch && !hashMatch && !suffixMatch && nameMatches.length > 1) {
    throw new Error(
      `Cannot re-run: ${nameMatches.length} configs are named "${configName}" and none matches the stored path ${configuredPath}.`
    );
  }
  const nameMatch = nameMatches.length === 1 ? nameMatches[0] : undefined;
  const resolved = exactMatch ?? hashMatch ?? suffixMatch ?? nameMatch;
  return resolved?.relativePath?.trim() || resolved?.sourcePath?.trim() || configuredPath;
}

export async function rerunWithSameSettings(source: EvalDataSource, run: EvalResult) {
  const detailed = await source.getResult(run.id);
  const sourceRun = detailed
    ? {
        ...run,
        ...detailed,
        configPath: detailed.configPath?.trim() || run.configPath,
        configName: detailed.configName?.trim() || run.configName
      }
    : run;
  const configPath = await resolveConfigPath(source, sourceRun);
  const agents =
    sourceRun.rerunAgents && sourceRun.rerunAgents.length > 0
      ? sourceRun.rerunAgents
      : Array.from(
          new Set(sourceRun.scenarios.map((scenario) => scenario.agentId).filter(Boolean))
        );
  await source.startRun({
    configPath,
    runsPerScenario: sourceRun.rerun_runs_per_scenario ?? 1,
    server_sets: sourceRun.rerun_server_variants
      ? toServerSets(sourceRun.rerun_server_variants)
      : undefined,
    scenarioIds: sourceRun.rerunScenarioIds,
    agents: agents.length > 0 ? agents : undefined,
    runNote: sourceRun.runNote,
    servers: sourceRun.rerun_server_variants?.length ? undefined : sourceRun.rerunServerOverrideAll,
    scenarioServerOverrides: sourceRun.rerun_server_variants?.length
      ? undefined
      : sourceRun.rerunScenarioServerOverrides,
    newConversationBeforeStart: sourceRun.rerunNewConversationBeforeStart,
    newConversationBetweenScenarios: sourceRun.rerunNewConversationBetweenScenarios
  });
}
