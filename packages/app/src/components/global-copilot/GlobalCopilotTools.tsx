import { useFrontendTool, useHumanInTheLoop } from '@copilotkit/react-core/v2';
import { z } from 'zod';
import { invokeGlobalCopilotAction } from '@/lib/global-copilot-actions';
import {
  GLOBAL_COPILOT_NAVIGATION_INPUTS,
  resolveGlobalCopilotNavigationTarget
} from '@/lib/global-copilot-navigation';
import { resolveGlobalCopilotTestCaseOpen } from '@/lib/global-copilot-test-case-open';
import {
  FrontendApprovalCard,
  ScenarioDraftCard,
  ScenarioSuggestionCard
} from './GlobalCopilotCards';

export function useGlobalCopilotFrontendTools(params: {
  agentId?: string;
  source: ReturnType<typeof useDataSource>['source'];
  navigate: ReturnType<typeof useNavigate>;
  availableActions: string[];
}) {
  const available = new Set(params.availableActions);
  useFrontendTool(
    {
      name: 'navigate_to_view',
      description:
        'Navigate to a supported MCPLab view when explicitly requested. Use /libraries/test-cases for the Test Cases list.',
      parameters: z
        .object({ path: z.enum(GLOBAL_COPILOT_NAVIGATION_INPUTS), reason: z.string().optional() })
        .strict(),
      agentId: params.agentId,
      handler: async ({ path }) => {
        const target = resolveGlobalCopilotNavigationTarget(path);
        if (!target) throw new Error(`Unsupported MCPLab navigation target: ${path}`);
        params.navigate(target);
        return { opened: target };
      }
    },
    [params.agentId, params.navigate]
  );
  useFrontendTool(
    {
      name: 'open_result_detail',
      description: 'Open one evaluation Result Detail by run ID.',
      parameters: z.object({ runId: z.string() }).strict(),
      agentId: params.agentId,
      handler: async ({ runId }) => {
        params.navigate(`/results/${encodeURIComponent(runId)}`);
        return { opened: runId };
      }
    },
    [params.agentId, params.navigate]
  );
  useFrontendTool(
    {
      name: 'open_test_case',
      description: 'Open one verified MCPLab Test Case by ID.',
      parameters: z.object({ testCaseId: z.string() }).strict(),
      agentId: params.agentId,
      handler: async ({ testCaseId }) => {
        const resolution = await resolveGlobalCopilotTestCaseOpen(params.source, testCaseId);
        if ('message' in resolution) throw new Error(resolution.message);
        params.navigate(resolution.destination);
        return { opened: testCaseId };
      }
    },
    [params.agentId, params.navigate, params.source]
  );

  useConfirmedFrontendTool(
    'start_evaluation_run',
    params.agentId,
    available.has('start_evaluation_run')
  );
  useConfirmedFrontendTool(
    'queue_evaluation_run',
    params.agentId,
    available.has('queue_evaluation_run')
  );
  useConfirmedFrontendTool(
    'queue_evaluation_by_config',
    params.agentId,
    available.has('queue_evaluation_by_config'),
    z
      .object({
        configId: z.string(),
        agentIds: z.array(z.string()).optional(),
        scenarioIds: z.array(z.string()).optional(),
        runsPerScenario: z.number().int().positive().optional(),
        serverOverrideAll: z.array(z.string()).optional(),
        scenarioServerOverrides: z.record(z.array(z.string())).optional(),
        runNote: z.string().optional()
      })
      .strict()
  );
  useConfirmedFrontendTool(
    'apply_scenario_patch',
    params.agentId,
    available.has('apply_scenario_patch'),
    z
      .object({
        scenarioId: z.string(),
        prompt: z.string().optional(),
        evalRules: z.array(z.record(z.unknown())).optional(),
        extractRules: z.array(z.record(z.unknown())).optional(),
        evalRuleMode: z.enum(['append', 'replace']).optional(),
        extractRuleMode: z.enum(['append', 'replace']).optional()
      })
      .strict(),
    'Apply a structured edit to an open scenario after user confirmation. Preserve scenarioId and include only the fields being changed; evalRules and extractRules are complete replacement arrays.'
  );
  useHumanInTheLoop(
    {
      name: 'propose_scenario_changes',
      description:
        'Present structured scenario suggestions for selective application. Do not change the scenario until the user chooses which sections to apply.',
      parameters: z
        .object({
          scenarioId: z.string(),
          rationale: z.string().optional(),
          prompt: z.string().optional(),
          evalRules: z.array(z.record(z.unknown())).optional(),
          extractRules: z.array(z.record(z.unknown())).optional()
        })
        .strict(),
      agentId: params.agentId,
      available: available.has('apply_scenario_patch'),
      render: (props) => (
        <ScenarioSuggestionCard
          args={props.args as Record<string, unknown>}
          respond={props.status === 'executing' ? props.respond : undefined}
        />
      )
    },
    [params.agentId, available.has('apply_scenario_patch')]
  );
  useHumanInTheLoop(
    {
      name: 'propose_new_scenario',
      description: 'Present a complete new Test Case draft for review before creating it.',
      parameters: z
        .object({
          id: z.string(),
          name: z.string().optional(),
          servers: z.array(z.string()),
          prompt: z.string(),
          evalRules: z.array(z.record(z.unknown())).optional(),
          extractRules: z.array(z.record(z.unknown())).optional(),
          rationale: z.string().optional()
        })
        .strict(),
      agentId: params.agentId,
      available: available.has('create_test_case'),
      render: (props) => (
        <ScenarioDraftCard
          args={props.args as Record<string, unknown>}
          respond={props.status === 'executing' ? props.respond : undefined}
        />
      )
    },
    [params.agentId, available.has('create_test_case')]
  );
  useConfirmedFrontendTool(
    'preview_scenario',
    params.agentId,
    available.has('preview_scenario'),
    z.object({ scenarioId: z.string(), agentId: z.string().optional() }).strict(),
    'Run the open scenario once with a selected agent and return its preview checks and response. This requires confirmation and does not persist changes.'
  );
  useConfirmedFrontendTool(
    'start_tool_analysis',
    params.agentId,
    available.has('start_tool_analysis')
  );
  useConfirmedFrontendTool(
    'duplicate_test_case',
    params.agentId,
    available.has('duplicate_test_case')
  );
  useConfirmedFrontendTool(
    'duplicate_mcp_server',
    params.agentId,
    available.has('duplicate_mcp_server')
  );
  useConfirmedFrontendTool('duplicate_agent', params.agentId, available.has('duplicate_agent'));
  useConfirmedFrontendTool('create_test_case', params.agentId, available.has('create_test_case'));
}

export function useConfirmedFrontendTool(
  name: Parameters<typeof invokeGlobalCopilotAction>[0],
  agentId: string | undefined,
  available: boolean,
  parameters: z.ZodTypeAny = z.record(z.unknown()),
  description = `Request confirmation before ${name.replaceAll('_', ' ')}.`
) {
  useHumanInTheLoop(
    {
      name,
      description,
      parameters,
      agentId,
      available,
      render: (props) => (
        <FrontendApprovalCard
          name={name}
          args={props.args as Record<string, unknown>}
          respond={props.status === 'executing' ? props.respond : undefined}
        />
      )
    },
    [agentId, available, name, description]
  );
}
