import type { Message } from '@ag-ui/client';
import {
  CopilotKitProvider,
  useAgentContext,
  useFrontendTool,
  useHumanInTheLoop,
  useInterrupt
} from '@copilotkit/react-core/v2';
import { Bot, MessageSquarePlus, Minimize2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AssistantToolCallCard } from '@/components/assistant/AssistantChat';
import { Button } from '@/components/ui/button';
import { useDataSource } from '@/contexts/DataSourceContext';
import { useConfigs } from '@/contexts/ConfigContext';
import { useLibraries } from '@/contexts/LibraryContext';
import { useRunQueueStatus } from '@/hooks/use-run-queue-status';
import { useGlobalCopilotRun } from '@/hooks/use-global-copilot-run';
import { useGlobalCopilotThread } from '@/hooks/use-global-copilot-thread';
import { toast } from '@/hooks/use-toast';
import { availableGlobalCopilotActions, invokeGlobalCopilotAction, registerGlobalCopilotAction, subscribeGlobalCopilotActions } from '@/lib/global-copilot-actions';
import { globalCopilotRouteContext } from '@/lib/global-copilot-context';
import { storedGlobalCopilotMessage } from '@/lib/global-copilot-message';
import {
  GLOBAL_COPILOT_NAVIGATION_INPUTS,
  resolveGlobalCopilotNavigationTarget
} from '@/lib/global-copilot-navigation';
import { globalCopilotPageContextForPath } from '@/lib/global-copilot-page-context';
import { resolveGlobalCopilotTestCaseOpen } from '@/lib/global-copilot-test-case-open';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import {
  prepareWorkspaceEvaluationRun,
  submitWorkspaceEvaluationRun
} from '@/lib/workspace-evaluation-run';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';
import { GlobalCopilotComposer } from './GlobalCopilotComposer';
import { GlobalCopilotConversation } from './GlobalCopilotConversation';
import { GlobalCopilotThreadList } from './GlobalCopilotThreadList';

const runtimeAgentId = 'mcplab-global-copilot';
const openKey = 'mcplab.globalCopilot.open';
const expandedKey = 'mcplab.globalCopilot.expanded';
export function GlobalCopilotController() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint showDevConsole={false}>
      <GlobalCopilotControllerInner />
    </CopilotKitProvider>
  );
}

function GlobalCopilotControllerInner() {
  const { source, version } = useDataSource();
  const { configs } = useConfigs();
  const { servers: libraryServers } = useLibraries();
  const location = useLocation();
  const navigate = useNavigate();
  const queue = useRunQueueStatus();
  const [open, setOpen] = useState(() => window.localStorage.getItem(openKey) !== '0');
  const [expanded, setExpanded] = useState(() => window.localStorage.getItem(expandedKey) === '1');
  const [input, setInput] = useState('');
  const [, refreshAvailableActions] = useState(0);

  useEffect(() => subscribeGlobalCopilotActions(() => refreshAvailableActions((value) => value + 1)), []);

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
        const runsPerScenario =
          typeof arguments_.runsPerScenario === 'number' ? arguments_.runsPerScenario : 1;
        const prepared = prepareWorkspaceEvaluationRun({
          config,
          availableAgents: config.agents,
          availableScenarios: config.scenarios,
          libraryServers,
          selectedAgentIds,
          selectedScenarioIds,
          runsPerScenario,
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
          ensureOAuth: async (serverNames) =>
            ensureOAuthForServers({ serverNames, source })
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
            ? arguments_.response_regex_patterns.filter((item): item is string => typeof item === 'string')
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
        const servers = requestedServers.map((serverId) => {
          if (serverId !== 'mcplab' || libraries.servers.some((server) => server.id === 'mcplab')) {
            return serverId;
          }
          return libraries.servers.some((server) => server.id === 'mcp-lab') ? 'mcp-lab' : serverId;
        });
        await source.createTestCase({ id, name: typeof arguments_.name === 'string' ? arguments_.name : undefined, servers, prompt });
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

  const {
    workspaceKey,
    threads,
    thread,
    refresh,
    selectThread,
    renameThread,
    deleteThread,
    newThread,
    threadError
  } = useGlobalCopilotThread(source);

  useEffect(() => {
    if (!threadError) return;
    toast({ title: 'Could not open conversation', description: threadError, variant: 'destructive' });
  }, [threadError]);
  const appContext = useMemo(
    () => ({
      ...globalCopilotRouteContext(location.pathname, location.search),
      ...globalCopilotPageContextForPath(location.pathname),
      mcplabVersion: version,
      queue: {
        runningCount: queue.runningCount,
        queuedCount: queue.queuedCount,
        oauthBlockedCount: queue.oauthBlockedCount,
        streamStatus: String(queue.streamStatus)
      },
      availableActions: Array.from(
        new Set([...availableGlobalCopilotActions(), 'queue_evaluation_by_config'])
      )
    }),
    [location.pathname, location.search, queue.oauthBlockedCount, queue.queuedCount, queue.runningCount, queue.streamStatus, version]
  );
  useAgentContext({ description: 'Current MCPLab application context', value: appContext });

  const { agent, isReady, messages, loading, send: run, resumeStoredInterrupt, cancel } = useGlobalCopilotRun({
    thread,
    renameThread,
    refresh,
    storeMessage: storedGlobalCopilotMessage
  });

  useEffect(
    () =>
      registerGlobalCopilotAction('send_copilot_message', async (arguments_) => {
        const message = typeof arguments_.message === 'string' ? arguments_.message.trim() : '';
        if (!message) throw new Error('A Copilot message is required.');
        if (!thread) throw new Error('No active Copilot conversation is available.');
        setOpen(true);
        await run(message);
      }),
    [run, thread]
  );

  useGlobalCopilotFrontendTools({
    agentId: agent.agentId,
    source,
    navigate,
    availableActions: appContext.availableActions
  });

  const interruptElement = useInterrupt({
    agentId: agent.agentId,
    renderInChat: false,
    enabled: (event) => {
      const interrupt = event.value as { reason?: string } | undefined;
      return interrupt?.reason === 'mastra:tool_suspend';
    },
    render: ({ interrupt, resolve }) => {
      const mastra = interrupt?.metadata?.mastra as
        | {
            toolName?: string;
            suspendPayload?: Record<string, unknown>;
            args?: Record<string, unknown>;
          }
        | undefined;
      const payload = mastra?.suspendPayload ?? {};
      const kind = payload.kind;
      const message: GlobalCopilotMessage =
        kind === 'continue_reading'
          ? {
              id: interrupt?.id ?? 'pending-read-approval',
              role: 'system',
              content: `Additional MCPLab read-tool batch requested (${Number(payload.batchSize ?? 5)} calls).`,
              createdAt: new Date().toISOString(),
              action: {
                kind: 'continue_reading',
                batchSize: Number(payload.batchSize ?? 5),
                status: 'pending'
              }
            }
          : {
              id: interrupt?.id ?? 'pending-tool-approval',
              role: 'system',
              content: `MCP call requested: ${String(payload.serverName ?? 'mcplab')}/${String(payload.toolName ?? mastra?.toolName ?? 'tool')}`,
              createdAt: new Date().toISOString(),
              action: {
                kind: 'external_mcp_tool',
                serverName: String(payload.serverName ?? 'mcplab'),
                toolName: String(payload.toolName ?? mastra?.toolName ?? 'tool'),
                arguments: (payload.arguments ?? mastra?.args ?? {}) as Record<string, unknown>,
                status: 'pending'
              }
            };
      return (
        <NativeInterruptCard
          message={message}
          onDecision={(approved) => void resolve({ approved }, interrupt?.id)}
        />
      );
    }
  });
  const storedInterrupt = thread?.pendingInterrupts?.[0];
  const storedInterruptElement =
    !interruptElement && storedInterrupt ? (
      <NativeInterruptCard
        message={globalCopilotInterruptMessage(storedInterrupt)}
        onDecision={(approved) => void resumeStoredInterrupt(storedInterrupt, approved)}
      />
    ) : null;

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || !thread || !isReady) return;
    setInput('');
    await run(question);
  }, [input, isReady, run, thread]);

  useEffect(() => window.localStorage.setItem(openKey, open ? '1' : '0'), [open]);
  useEffect(() => window.localStorage.setItem(expandedKey, expanded ? '1' : '0'), [expanded]);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied to clipboard' });
    } catch {
      toast({ title: 'Could not copy message', variant: 'destructive' });
    }
  }, []);

  if (!open)
    return (
      <button
        type="button"
        aria-label="Open global copilot"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-14 z-30 rounded-xl border border-transparent p-2 shadow"
        style={{
          background:
            'linear-gradient(var(--colorNeutralBackground1, hsl(var(--card)))) padding-box, linear-gradient(225deg, #A0E4FC 0%, #DBA9F6 100%) border-box'
        }}
      >
        <Bot className="h-4 w-4" />
      </button>
    );
  return (
    <aside
      className={`hidden h-screen min-h-0 min-w-0 shrink-0 overflow-hidden border-l bg-card transition-[width] duration-200 ${
        expanded ? 'w-[52rem] max-w-[60vw]' : 'w-[360px]'
      } lg:flex lg:flex-col`}
      aria-label="Global copilot"
    >
      <div className="flex w-full min-w-0 items-center gap-2 border-b p-3">
        <Bot className="h-4 w-4 text-primary" />
        <span className="min-w-0 truncate text-sm font-semibold">Global Copilot</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Compact global copilot' : 'Expand global copilot'} title={expanded ? 'Compact' : 'Expand'}>
            {expanded ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Collapse global copilot">
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" onClick={() => void newThread()} aria-label="New chat" title="New chat">
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <GlobalCopilotThreadList
        threads={threads}
        activeThreadId={thread?.id}
        onSelect={selectThread}
        onRename={(item) => void renameThread(item)}
        onDelete={(item) => void deleteThread(item)}
      />
      <GlobalCopilotConversation
        messages={messages}
        rawMessages={agent.messages as Message[]}
        interruptElement={interruptElement ?? storedInterruptElement}
        loading={loading}
        onCopy={(text) => void copy(text)}
      />
      <GlobalCopilotComposer input={input} onInputChange={setInput} onSend={() => void send()} onCancel={cancel} loading={loading} />
    </aside>
  );
}

function useGlobalCopilotFrontendTools(params: {
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

  useConfirmedFrontendTool('start_evaluation_run', params.agentId, available.has('start_evaluation_run'));
  useConfirmedFrontendTool('queue_evaluation_run', params.agentId, available.has('queue_evaluation_run'));
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
      parameters: z.object({
        id: z.string(),
        name: z.string().optional(),
        servers: z.array(z.string()),
        prompt: z.string(),
        evalRules: z.array(z.record(z.unknown())).optional(),
        extractRules: z.array(z.record(z.unknown())).optional(),
        rationale: z.string().optional()
      }).strict(),
      agentId: params.agentId,
      available: available.has('create_test_case'),
      render: (props) => (
        <ScenarioDraftCard args={props.args as Record<string, unknown>} respond={props.status === 'executing' ? props.respond : undefined} />
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
  useConfirmedFrontendTool('start_tool_analysis', params.agentId, available.has('start_tool_analysis'));
  useConfirmedFrontendTool('duplicate_test_case', params.agentId, available.has('duplicate_test_case'));
  useConfirmedFrontendTool('duplicate_mcp_server', params.agentId, available.has('duplicate_mcp_server'));
  useConfirmedFrontendTool('duplicate_agent', params.agentId, available.has('duplicate_agent'));
  useConfirmedFrontendTool('create_test_case', params.agentId, available.has('create_test_case'));
}

function useConfirmedFrontendTool(
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

function FrontendApprovalCard({
  name,
  args,
  respond
}: {
  name: Parameters<typeof invokeGlobalCopilotAction>[0];
  args: Record<string, unknown>;
  respond?: (result: unknown) => Promise<void>;
}) {
  const decide = async (approved: boolean) => {
    if (!respond) return;
    if (!approved) {
      await respond({ approved: false, reason: 'Denied by user.' });
      return;
    }
    try {
      const result = await invokeGlobalCopilotAction(name, args);
      await respond({ approved: true, result });
    } catch (error: unknown) {
      await respond({ approved: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <AssistantToolCallCard
      call={{
        id: `frontend-${name}`,
        server: 'mcplab',
        tool: name.replaceAll('_', ' '),
        publicToolName: name,
        arguments: args,
        status: respond ? 'pending' : 'approved',
        createdAt: new Date().toISOString()
      }}
      description="This action uses the current page state and requires confirmation."
      onApprove={() => void decide(true)}
      onDeny={() => void decide(false)}
    />
  );
}

export function ScenarioSuggestionCard({
  args,
  respond
}: {
  args: Record<string, unknown>;
  respond?: (result: unknown) => Promise<void>;
}) {
  const [applied, setApplied] = useState<string[]>([]);
  const scenarioId = typeof args.scenarioId === 'string' ? args.scenarioId : '';
  const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;
  const prompt = typeof args.prompt === 'string' ? args.prompt : undefined;
  const evalRules = Array.isArray(args.evalRules) ? args.evalRules : undefined;
  const extractRules = Array.isArray(args.extractRules) ? args.extractRules : undefined;

  const apply = async (field: 'prompt' | 'evalRules' | 'extractRules', value: unknown) => {
    try {
      await invokeGlobalCopilotAction('apply_scenario_patch', { scenarioId, [field]: value });
      setApplied((current) => (current.includes(field) ? current : [...current, field]));
    } catch (error: unknown) {
      toast({
        title: 'Could not apply suggestion',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  const applyRule = async (
    field: 'evalRules' | 'extractRules',
    value: Record<string, unknown>,
    mode: 'append' | 'replace',
    key: string
  ) => {
    try {
      await invokeGlobalCopilotAction('apply_scenario_patch', {
        scenarioId,
        [field]: [value],
        [field === 'evalRules' ? 'evalRuleMode' : 'extractRuleMode']: mode
      });
      setApplied((current) => (current.includes(key) ? current : [...current, key]));
    } catch (error: unknown) {
      toast({
        title: 'Could not apply suggestion',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="rounded-md border border-sky-400/40 bg-sky-50 p-3 text-sm">
      <p className="font-medium">Scenario suggestions{scenarioId ? ` · ${scenarioId}` : ''}</p>
      {rationale && <p className="mt-1 text-xs text-muted-foreground">{rationale}</p>}
      <div className="mt-3 space-y-2">
        {prompt && (
          <SuggestionSection label="Prompt" value={prompt} applied={applied.includes('prompt')} onApply={() => void apply('prompt', prompt)} />
        )}
        {evalRules && (
          <RuleSuggestionSection
            label="Checks"
            rules={evalRules}
            applied={applied.includes('evalRules')}
            onApplyAll={() => void apply('evalRules', evalRules)}
            onApplyOne={(rule, index) => void applyRule('evalRules', rule, 'append', `evalRules:add:${index}`)}
            onReplaceOne={(rule, index) => void applyRule('evalRules', rule, 'replace', `evalRules:replace:${index}`)}
          />
        )}
        {extractRules && (
          <RuleSuggestionSection
            label="Value Capture Rules"
            rules={extractRules}
            applied={applied.includes('extractRules')}
            onApplyAll={() => void apply('extractRules', extractRules)}
            onApplyOne={(rule, index) => void applyRule('extractRules', rule, 'append', `extractRules:add:${index}`)}
            onReplaceOne={(rule, index) => void applyRule('extractRules', rule, 'replace', `extractRules:replace:${index}`)}
          />
        )}
      </div>
      {respond && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => void respond({ approved: true, applied, scenarioId })}>Done</Button>
          <Button size="sm" variant="outline" onClick={() => void respond({ approved: false, reason: 'No suggestions applied.' })}>Skip</Button>
        </div>
      )}
    </div>
  );
}

function RuleSuggestionSection({
  label,
  rules,
  applied,
  onApplyAll,
  onApplyOne,
  onReplaceOne
}: {
  label: string;
  rules: Record<string, unknown>[];
  applied: boolean;
  onApplyAll: () => void;
  onApplyOne: (rule: Record<string, unknown>, index: number) => void;
  onReplaceOne: (rule: Record<string, unknown>, index: number) => void;
}) {
  const [itemActions, setItemActions] = useState<Set<string>>(new Set());
  return (
    <div className="rounded border bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <Button size="sm" variant={applied ? 'secondary' : 'outline'} disabled={applied} onClick={onApplyAll}>
          {applied ? 'Applied' : 'Apply all'}
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        {rules.map((rule, index) => {
          const addKey = `add-${index}`;
          const replaceKey = `replace-${index}`;
          return (
            <div key={`${label}-${index}`} className="flex items-start gap-2 rounded bg-muted/50 p-2">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                {JSON.stringify(rule, null, 2)}
              </pre>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={applied || itemActions.has(addKey)}
                  aria-label={`Add ${label === 'Checks' ? 'check' : 'value capture rule'} ${index + 1}`}
                  onClick={() => {
                    onApplyOne(rule, index);
                    setItemActions((current) => new Set(current).add(addKey));
                  }}
                >
                  {itemActions.has(addKey) ? 'Added' : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={applied || itemActions.has(replaceKey)}
                  aria-label={`Replace with ${label === 'Checks' ? 'check' : 'value capture rule'} ${index + 1}`}
                  onClick={() => {
                    onReplaceOne(rule, index);
                    setItemActions((current) => new Set(current).add(replaceKey));
                  }}
                >
                  {itemActions.has(replaceKey) ? 'Replaced' : 'Replace'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionSection({
  label,
  value,
  applied,
  onApply
}: {
  label: string;
  value: string;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <div className="rounded border bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <Button size="sm" variant={applied ? 'secondary' : 'outline'} disabled={applied} onClick={onApply}>
          {applied ? 'Applied' : 'Apply'}
        </Button>
      </div>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{value}</pre>
    </div>
  );
}

function ScenarioDraftCard({
  args,
  respond
}: {
  args: Record<string, unknown>;
  respond?: (result: unknown) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState({ prompt: true, evalRules: true, extractRules: true });
  const id = typeof args.id === 'string' ? args.id : '';
  const name = typeof args.name === 'string' ? args.name : undefined;
  const prompt = typeof args.prompt === 'string' ? args.prompt : '';
  const servers = Array.isArray(args.servers) ? args.servers : [];
  const evalRules = Array.isArray(args.evalRules) ? args.evalRules : [];
  const extractRules = Array.isArray(args.extractRules) ? args.extractRules : [];
  const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;

  const create = async () => {
    if (!respond || creating) return;
    setCreating(true);
    try {
      const result = await invokeGlobalCopilotAction('create_test_case_from_draft', {
        ...args,
        ...(selected.evalRules ? { evalRules } : { evalRules: [] }),
        ...(selected.extractRules ? { extractRules } : { extractRules: [] })
      });
      await respond({ approved: true, result });
    } catch (error: unknown) {
      setCreating(false);
      toast({
        title: 'Could not create Test Case',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="rounded-md border border-violet-400/40 bg-violet-50 p-3 text-sm">
      <p className="font-medium">New Test Case draft{ id ? ` · ${id}` : ''}</p>
      {rationale && <p className="mt-1 text-xs text-muted-foreground">{rationale}</p>}
      <div className="mt-2 rounded border bg-background p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Prompt</span>
          <Button size="sm" variant="secondary" disabled>Included</Button>
        </div>
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{prompt}</pre>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Servers: {servers.join(', ') || 'none'}</p>
      <DraftToggle label={`Checks (${evalRules.length})`} selected={selected.evalRules} onToggle={() => setSelected((current) => ({ ...current, evalRules: !current.evalRules }))} />
      <DraftToggle label={`Value Capture Rules (${extractRules.length})`} selected={selected.extractRules} onToggle={() => setSelected((current) => ({ ...current, extractRules: !current.extractRules }))} />
      {respond && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={creating || !id || !prompt} onClick={() => void create()}>
            {creating ? 'Creating...' : 'Create Test Case'}
          </Button>
          <Button size="sm" variant="outline" disabled={creating} onClick={() => void respond({ approved: false, reason: 'Draft creation denied.' })}>
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

function DraftToggle({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
  return (
    <Button type="button" size="sm" variant={selected ? 'secondary' : 'outline'} className="mt-2 w-full justify-start text-xs" onClick={onToggle}>
      {selected ? '✓' : '○'}&nbsp; {selected ? 'Include' : 'Exclude'} {label}
    </Button>
  );
}

function NativeInterruptCard({
  message,
  onDecision
}: {
  message: GlobalCopilotMessage;
  onDecision: (approved: boolean) => void;
}) {
  const action = message.action;
  if (!action) return null;
  if (action.kind === 'continue_reading') {
    return (
      <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm">
        <p>Allow up to {action.batchSize} additional read-only MCPLab tool calls to continue this investigation?</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onDecision(true)}>Continue</Button>
          <Button size="sm" variant="outline" onClick={() => onDecision(false)}>Stop here</Button>
        </div>
      </div>
    );
  }
  if (action.kind !== 'external_mcp_tool') return null;
  return (
    <AssistantToolCallCard
      call={{
        id: message.id,
        server: action.serverName,
        tool: action.toolName,
        publicToolName: `${action.serverName}__${action.toolName}`,
        arguments: action.arguments,
        status: 'pending',
        createdAt: message.createdAt
      }}
      description={`MCP call on ${action.serverName}.`}
      onApprove={() => onDecision(true)}
      onDeny={() => onDecision(false)}
    />
  );
}

function globalCopilotInterruptMessage(interrupt: {
  id: string;
  metadata?: Record<string, any>;
}): GlobalCopilotMessage {
  const mastra = interrupt.metadata?.mastra as
    | { toolName?: string; suspendPayload?: Record<string, unknown>; args?: Record<string, unknown> }
    | undefined;
  const payload = mastra?.suspendPayload ?? {};
  if (payload.kind === 'continue_reading') {
    return {
      id: interrupt.id,
      role: 'system',
      content: `Additional MCPLab read-tool batch requested (${Number(payload.batchSize ?? 5)} calls).`,
      createdAt: new Date().toISOString(),
      action: {
        kind: 'continue_reading',
        batchSize: Number(payload.batchSize ?? 5),
        status: 'pending'
      }
    };
  }
  return {
    id: interrupt.id,
    role: 'system',
    content: `MCP call requested: ${String(payload.serverName ?? 'mcplab')}/${String(payload.toolName ?? mastra?.toolName ?? 'tool')}`,
    createdAt: new Date().toISOString(),
    action: {
      kind: 'external_mcp_tool',
      serverName: String(payload.serverName ?? 'mcplab'),
      toolName: String(payload.toolName ?? mastra?.toolName ?? 'tool'),
      arguments: (payload.arguments ?? mastra?.args ?? {}) as Record<string, unknown>,
      status: 'pending'
    }
  };
}
