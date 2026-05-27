import type { EvalResult } from '@/types/eval';
import type { EvalDataSource } from '@/lib/data-sources/types';

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
    runsPerScenario: 1,
    scenarioIds: sourceRun.rerunScenarioIds,
    agents: agents.length > 0 ? agents : undefined,
    runNote: sourceRun.runNote,
    serverOverrideAll: sourceRun.rerunServerOverrideAll,
    scenarioServerOverrides: sourceRun.rerunScenarioServerOverrides
  });
}
