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
import { useRunQueueStatus } from '@/hooks/use-run-queue-status';
import { useGlobalCopilotRun } from '@/hooks/use-global-copilot-run';
import { useGlobalCopilotThread } from '@/hooks/use-global-copilot-thread';
import { toast } from '@/hooks/use-toast';
import { availableGlobalCopilotActions, invokeGlobalCopilotAction, registerGlobalCopilotAction } from '@/lib/global-copilot-actions';
import { globalCopilotRouteContext } from '@/lib/global-copilot-context';
import { storedGlobalCopilotMessage } from '@/lib/global-copilot-message';
import {
  GLOBAL_COPILOT_NAVIGATION_INPUTS,
  resolveGlobalCopilotNavigationTarget
} from '@/lib/global-copilot-navigation';
import { globalCopilotPageContextForPath } from '@/lib/global-copilot-page-context';
import { resolveGlobalCopilotTestCaseOpen } from '@/lib/global-copilot-test-case-open';
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
  const location = useLocation();
  const navigate = useNavigate();
  const queue = useRunQueueStatus();
  const [open, setOpen] = useState(() => window.localStorage.getItem(openKey) !== '0');
  const [expanded, setExpanded] = useState(() => window.localStorage.getItem(expandedKey) === '1');
  const [input, setInput] = useState('');

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

  const {
    workspaceKey,
    threads,
    thread,
    refresh,
    selectThread,
    renameThread,
    deleteThread,
    newThread
  } = useGlobalCopilotThread(source);
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
      availableActions: availableGlobalCopilotActions()
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
  useConfirmedFrontendTool('start_tool_analysis', params.agentId, available.has('start_tool_analysis'));
  useConfirmedFrontendTool('duplicate_test_case', params.agentId, available.has('duplicate_test_case'));
  useConfirmedFrontendTool('duplicate_mcp_server', params.agentId, available.has('duplicate_mcp_server'));
  useConfirmedFrontendTool('duplicate_agent', params.agentId, available.has('duplicate_agent'));
  useConfirmedFrontendTool('create_test_case', params.agentId, available.has('create_test_case'));
}

function useConfirmedFrontendTool(
  name: Parameters<typeof invokeGlobalCopilotAction>[0],
  agentId: string | undefined,
  available: boolean
) {
  useHumanInTheLoop(
    {
      name,
      description: `Request confirmation before ${name.replaceAll('_', ' ')}.`,
      parameters: z.record(z.unknown()),
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
    [agentId, available, name]
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
      await invokeGlobalCopilotAction(name, args);
      await respond({ approved: true });
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
