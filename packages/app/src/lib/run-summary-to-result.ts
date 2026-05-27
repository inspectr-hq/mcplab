import type { WorkspaceRunSummary } from '@/lib/data-sources/types';
import type { EvalResult } from '@/types/eval';

export function summaryToResult(summary: WorkspaceRunSummary): EvalResult {
  const toolTokensTotal =
    typeof summary.toolTokensTotal === 'number' ? summary.toolTokensTotal : null;
  return {
    id: summary.runId,
    configId: '',
    configHash: summary.configHash,
    configPath: summary.configPath,
    configName: summary.configName,
    rerunAgents: summary.rerunAgents,
    rerunScenarioIds: summary.rerunScenarioIds,
    rerunServerOverrideAll: summary.rerunServerOverrideAll,
    rerunScenarioServerOverrides: summary.rerunScenarioServerOverrides,
    timestamp: summary.timestamp,
    runNote: summary.runNote,
    mcpServerVersions: {},
    scenarios: (summary.scenarioIds ?? []).map((scenarioId, index) => ({
      scenarioId,
      scenarioName: summary.scenarioNames?.[index] ?? scenarioId,
      agentId: '',
      agentName: '',
      runs: [],
      passRate: 0,
      avgToolCalls: 0,
      avgDuration: 0
    })),
    assistantTokenUsage: null,
    toolTokenUsage:
      toolTokensTotal === null
        ? null
        : {
            inputTokens: null,
            outputTokens: null,
            totalTokens: toolTokensTotal
          },
    overallPassRate: summary.passRate,
    totalScenarios: summary.totalScenarios,
    totalRuns: summary.totalRuns,
    avgToolCalls: summary.avgToolCalls,
    avgLatency: Math.round(summary.avgLatencyMs ?? 0)
  };
}
