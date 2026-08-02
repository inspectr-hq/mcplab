import type { AgentConfig, EvalConfig, Scenario, ServerConfig } from '@/types/eval';
import type { EvalDataSource, StartRunResponse } from './data-sources/types';

export interface WorkspaceEvaluationRunInput {
  config: EvalConfig;
  availableAgents: AgentConfig[];
  availableScenarios: Scenario[];
  libraryServers: ServerConfig[];
  selectedAgentIds: string[];
  selectedScenarioIds: string[];
  runsPerScenario: number;
  globalServerOverrideEnabled?: boolean;
  globalServerOverrideIds?: string[];
  scenarioServerOverrideEnabledMap?: Record<string, boolean>;
  scenarioServerOverrides?: Record<string, string[]>;
  runNote?: string;
}

export interface PreparedWorkspaceEvaluationRun {
  selectedAgents: AgentConfig[];
  selectedScenarios: Scenario[];
  oauthServerNames: string[];
  effectiveScenarioServerSummary: string;
  runtimeOverridesEnabled: boolean;
  submission: Parameters<EvalDataSource['startRun']>[0];
}

function assertKnownIds(kind: string, requestedIds: string[], knownIds: string[]): void {
  const known = new Set(knownIds);
  const unknown = requestedIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${kind}: ${unknown.join(', ')}.`);
  }
}

/**
 * Produces the exact queued-run payload used by both the Run page and Global Copilot.
 * OAuth authorization and queue submission are deliberately handled by
 * submitWorkspaceEvaluationRun so they cannot diverge between callers.
 */
export function prepareWorkspaceEvaluationRun(
  input: WorkspaceEvaluationRunInput
): PreparedWorkspaceEvaluationRun {
  const configPath = input.config.sourcePath?.trim();
  if (!configPath) throw new Error('Missing source path for selected config.');
  if (!Number.isFinite(input.runsPerScenario) || input.runsPerScenario < 1) {
    throw new Error('Runs per scenario must be at least 1.');
  }
  assertKnownIds('agents', input.selectedAgentIds, input.availableAgents.map((agent) => agent.id));
  assertKnownIds(
    'test cases',
    input.selectedScenarioIds,
    input.availableScenarios.map((scenario) => scenario.id)
  );
  const selectedAgents = input.availableAgents.filter((agent) =>
    input.selectedAgentIds.includes(agent.id)
  );
  if (selectedAgents.length === 0) throw new Error('Select at least one agent.');
  const selectedScenarios = input.availableScenarios.filter((scenario) =>
    input.selectedScenarioIds.includes(scenario.id)
  );
  if (selectedScenarios.length === 0) throw new Error('Select at least one test case.');

  const globalServerOverrideEnabled = input.globalServerOverrideEnabled ?? false;
  const globalServerOverrideIds = input.globalServerOverrideIds ?? [];
  const scenarioServerOverrideEnabledMap = input.scenarioServerOverrideEnabledMap ?? {};
  const scenarioServerOverrides = input.scenarioServerOverrides ?? {};
  if (globalServerOverrideEnabled && globalServerOverrideIds.length === 0) {
    throw new Error(
      'Select at least one server for "Override MCP Servers for Selected Tests", or turn that override off.'
    );
  }

  const selectedScenarioSet = new Set(selectedScenarios.map((scenario) => scenario.id));
  const filteredScenarioServerOverrides = Object.fromEntries(
    Object.entries(scenarioServerOverrides).filter(
      ([scenarioId]) =>
        selectedScenarioSet.has(scenarioId) && scenarioServerOverrideEnabledMap[scenarioId]
    )
  );
  const emptyPerScenarioOverrides = Object.entries(filteredScenarioServerOverrides)
    .filter(([, serverIds]) => !Array.isArray(serverIds) || serverIds.length === 0)
    .map(([scenarioId]) => scenarioId);
  if (emptyPerScenarioOverrides.length > 0) {
    throw new Error(
      `Select at least one server for per-test-case overrides on: ${emptyPerScenarioOverrides.join(
        ', '
      )}, or turn those overrides off.`
    );
  }

  const runtimeOverridesEnabled =
    globalServerOverrideEnabled || Object.values(scenarioServerOverrideEnabledMap).some(Boolean);
  const knownServers = new Map<string, ServerConfig>();
  for (const server of input.libraryServers) knownServers.set(server.id, server);
  for (const server of input.config.servers ?? []) knownServers.set(server.id, server);
  const overriddenServerIds = [
    ...(globalServerOverrideEnabled ? globalServerOverrideIds : []),
    ...Object.values(filteredScenarioServerOverrides).flat()
  ];
  assertKnownIds('MCP servers', overriddenServerIds, [...knownServers.keys()]);

  const effectiveScenarioServerSummary = selectedScenarios
    .map((scenario) => {
      const serverIds =
        filteredScenarioServerOverrides[scenario.id] ??
        (globalServerOverrideEnabled ? globalServerOverrideIds : scenario.serverIds || []);
      return `${scenario.id}=[${serverIds.join(', ')}]`;
    })
    .join('; ');
  const oauthServerNames = Array.from(
    new Set(
      selectedScenarios
        .flatMap((scenario) => {
          if (!runtimeOverridesEnabled) return scenario.serverIds || [];
          if (filteredScenarioServerOverrides[scenario.id]) {
            return filteredScenarioServerOverrides[scenario.id] ?? [];
          }
          if (globalServerOverrideEnabled) return globalServerOverrideIds;
          return scenario.serverIds || [];
        })
        .filter((serverId) => knownServers.get(serverId)?.authType === 'oauth2')
    )
  );
  const note = input.runNote?.trim();
  return {
    selectedAgents,
    selectedScenarios,
    oauthServerNames,
    effectiveScenarioServerSummary,
    runtimeOverridesEnabled,
    submission: {
      configPath,
      runsPerScenario: input.runsPerScenario,
      agents: selectedAgents.map((agent) => agent.id),
      scenarioIds: selectedScenarios.map((scenario) => scenario.id),
      ...(runtimeOverridesEnabled && globalServerOverrideEnabled
        ? { serverOverrideAll: globalServerOverrideIds }
        : {}),
      ...(runtimeOverridesEnabled && Object.keys(filteredScenarioServerOverrides).length > 0
        ? { scenarioServerOverrides: filteredScenarioServerOverrides }
        : {}),
      runNote: note || undefined
    }
  };
}

export async function submitWorkspaceEvaluationRun(params: {
  prepared: PreparedWorkspaceEvaluationRun;
  source: Pick<EvalDataSource, 'startRun'>;
  ensureOAuth: (serverNames: string[]) => Promise<void>;
}): Promise<StartRunResponse> {
  if (params.prepared.oauthServerNames.length > 0) {
    await params.ensureOAuth(params.prepared.oauthServerNames);
  }
  return params.source.startRun(params.prepared.submission);
}
