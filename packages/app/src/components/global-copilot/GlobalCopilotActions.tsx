import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { registerGlobalCopilotAction } from '@/lib/global-copilot-actions';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import {
  prepareWorkspaceEvaluationRun,
  submitWorkspaceEvaluationRun
} from '@/lib/workspace-evaluation-run';
import type { useDataSource } from '@/contexts/DataSourceContext';
import type { useConfigs } from '@/contexts/ConfigContext';
import type { useLibraries } from '@/contexts/LibraryContext';

export function useGlobalCopilotActions({
  source,
  configs,
  libraryServers
}: {
  source: ReturnType<typeof useDataSource>['source'];
  configs: ReturnType<typeof useConfigs>['configs'];
  libraryServers: ReturnType<typeof useLibraries>['servers'];
}) {
  const navigate = useNavigate();

  useEffect(
    () =>
      registerGlobalCopilotAction('queue_evaluation_by_config', async (arguments_) => {
        const configId = typeof arguments_.configId === 'string' ? arguments_.configId : '';
        const config = configs.find((item) => item.id === configId);
        if (!config) throw new Error(`Evaluation configuration '${configId}' was not found.`);
        const selectedAgentIds = Array.isArray(arguments_.agentIds)
          ? arguments_.agentIds.filter((item): item is string => typeof item === 'string')
          : config.agents.map((agent) => agent.id);
        const selectedScenarioIds = Array.isArray(arguments_.scenarioIds)
          ? arguments_.scenarioIds.filter((item): item is string => typeof item === 'string')
          : config.scenarios.map((scenario) => scenario.id);
        const serverOverrideAll = Array.isArray(arguments_.serverOverrideAll)
          ? arguments_.serverOverrideAll.filter((item): item is string => typeof item === 'string')
          : undefined;
        const scenarioServerOverrides =
          arguments_.scenarioServerOverrides &&
          typeof arguments_.scenarioServerOverrides === 'object' &&
          !Array.isArray(arguments_.scenarioServerOverrides)
            ? Object.fromEntries(
                Object.entries(arguments_.scenarioServerOverrides).map(([id, value]) => [
                  id,
                  Array.isArray(value)
                    ? value.filter((item): item is string => typeof item === 'string')
                    : []
                ])
              )
            : undefined;
        const prepared = prepareWorkspaceEvaluationRun({
          config,
          availableAgents: config.agents,
          availableScenarios: config.scenarios,
          libraryServers,
          selectedAgentIds,
          selectedScenarioIds,
          runsPerScenario:
            typeof arguments_.runsPerScenario === 'number' ? arguments_.runsPerScenario : 1,
          globalServerOverrideEnabled: serverOverrideAll !== undefined,
          globalServerOverrideIds: serverOverrideAll ?? [],
          scenarioServerOverrideEnabledMap:
            scenarioServerOverrides === undefined
              ? {}
              : Object.fromEntries(Object.keys(scenarioServerOverrides).map((id) => [id, true])),
          scenarioServerOverrides,
          runNote: typeof arguments_.runNote === 'string' ? arguments_.runNote : undefined
        });
        const { jobId } = await submitWorkspaceEvaluationRun({
          prepared,
          source,
          ensureOAuth: async (serverNames) => ensureOAuthForServers({ serverNames, source })
        });
        toast({ title: 'Evaluation queued', description: `${config.name} (${jobId})` });
      }),
    [configs, libraryServers, source]
  );

  useEffect(
    () =>
      registerGlobalCopilotAction('create_test_case', async (arguments_) => {
        const created = await source.createTestCase({
          id: typeof arguments_.id === 'string' ? arguments_.id : '',
          name: typeof arguments_.name === 'string' ? arguments_.name : undefined,
          servers: Array.isArray(arguments_.servers)
            ? arguments_.servers.filter((item): item is string => typeof item === 'string')
            : [],
          prompt: typeof arguments_.prompt === 'string' ? arguments_.prompt : '',
          requiredTools: Array.isArray(arguments_.required_tools)
            ? arguments_.required_tools.filter((item): item is string => typeof item === 'string')
            : undefined,
          responseRegexPatterns: Array.isArray(arguments_.response_regex_patterns)
            ? arguments_.response_regex_patterns.filter(
                (item): item is string => typeof item === 'string'
              )
            : undefined
        });
        toast({ title: 'Test Case created', description: `Created ${created.id} in Test Cases.` });
      }),
    [source]
  );

  useEffect(
    () =>
      registerGlobalCopilotAction('create_test_case_from_draft', async (arguments_) => {
        const id = typeof arguments_.id === 'string' ? arguments_.id.trim() : '';
        const prompt = typeof arguments_.prompt === 'string' ? arguments_.prompt : '';
        if (!id || !prompt) throw new Error('A draft Test Case requires an id and prompt.');
        const requestedServers = Array.isArray(arguments_.servers)
          ? arguments_.servers.filter((item): item is string => typeof item === 'string')
          : [];
        const evalRules = Array.isArray(arguments_.evalRules) ? arguments_.evalRules : [];
        const extractRules = Array.isArray(arguments_.extractRules) ? arguments_.extractRules : [];
        const libraries = await source.getLibraries();
        const servers = requestedServers.map((serverId) =>
          serverId === 'mcplab' &&
          !libraries.servers.some((server) => server.id === 'mcplab') &&
          libraries.servers.some((server) => server.id === 'mcp-lab')
            ? 'mcp-lab'
            : serverId
        );
        await source.createTestCase({
          id,
          name: typeof arguments_.name === 'string' ? arguments_.name : undefined,
          servers,
          prompt
        });
        const updatedLibraries = await source.getLibraries();
        const created = updatedLibraries.scenarios.find((scenario) => scenario.id === id);
        if (!created) throw new Error(`Created Test Case '${id}' could not be reloaded.`);
        created.evalRules = evalRules as typeof created.evalRules;
        created.extractRules = extractRules as typeof created.extractRules;
        await source.saveLibraries(updatedLibraries);
        navigate(`/libraries/test-cases/${encodeURIComponent(id)}`);
        toast({ title: 'Test Case created', description: `Created ${id} in Test Cases.` });
        return { id };
      }),
    [navigate, source]
  );
}
