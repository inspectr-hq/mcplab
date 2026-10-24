import type { EvalResult } from '@/types/eval';
import { toServerSets, type EvalDataSource } from '@/lib/data-sources/types';

export async function rerunWithSameSettings(source: EvalDataSource, run: EvalResult) {
  const configPath = run.configPath?.trim();
  if (!configPath) throw new Error('This run has no config path in metadata.');
  const detailed = await source.getResult(run.id);
  const sourceRun = detailed ?? run;
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
