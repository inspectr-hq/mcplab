import type { Message } from '@ag-ui/client';
import { CopilotKitProvider, useAgentContext } from '@copilotkit/react-core/v2';
import { Bot, MessageSquarePlus, Minimize2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useDataSource } from '@/contexts/DataSourceContext';
import { useConfigs } from '@/contexts/ConfigContext';
import { useLibraries } from '@/contexts/LibraryContext';
import { useRunQueueStatus } from '@/hooks/use-run-queue-status';
import { useGlobalCopilotRun } from '@/hooks/use-global-copilot-run';
import { useGlobalCopilotThread } from '@/hooks/use-global-copilot-thread';
import { toast } from '@/hooks/use-toast';
import {
  availableGlobalCopilotActions,
  invokeGlobalCopilotAction,
  registerGlobalCopilotAction,
  subscribeGlobalCopilotActions
} from '@/lib/global-copilot-actions';
import { globalCopilotRouteContext } from '@/lib/global-copilot-context';
import { storedGlobalCopilotMessage } from '@/lib/global-copilot-message';
import { globalCopilotPageContextForPath } from '@/lib/global-copilot-page-context';
import { GlobalCopilotComposer } from './GlobalCopilotComposer';
import { useGlobalCopilotActions } from './GlobalCopilotActions';
import { useGlobalCopilotFrontendTools } from './GlobalCopilotTools';
import { useGlobalCopilotInterrupts } from './GlobalCopilotInterrupts';
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

  useEffect(
    () => subscribeGlobalCopilotActions(() => refreshAvailableActions((value) => value + 1)),
    []
  );

  useGlobalCopilotActions({ source, configs, libraryServers });

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
    toast({
      title: 'Could not open conversation',
      description: threadError,
      variant: 'destructive'
    });
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
    [
      location.pathname,
      location.search,
      queue.oauthBlockedCount,
      queue.queuedCount,
      queue.runningCount,
      queue.streamStatus,
      version
    ]
  );
  useAgentContext({ description: 'Current MCPLab application context', value: appContext });

  const {
    agent,
    isReady,
    messages,
    loading,
    send: run,
    resumeStoredInterrupt,
    cancel
  } = useGlobalCopilotRun({
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
    agentId: runtimeAgentId,
    source,
    navigate,
    availableActions: appContext.availableActions
  });

  const interruptElement = useGlobalCopilotInterrupts({
    agentId: runtimeAgentId,
    storedInterrupt: thread?.pendingInterrupts?.[0],
    resumeStoredInterrupt
  });

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
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'Compact global copilot' : 'Expand global copilot'}
            title={expanded ? 'Compact' : 'Expand'}
          >
            {expanded ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setOpen(false)}
            aria-label="Collapse global copilot"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
            onClick={() => void newThread()}
            aria-label="New chat"
            title="New chat"
          >
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
        interruptElement={interruptElement}
        loading={loading}
        onCopy={(text) => void copy(text)}
      />
      <GlobalCopilotComposer
        input={input}
        onInputChange={setInput}
        onSend={() => void send()}
        onCancel={cancel}
        loading={loading}
      />
    </aside>
  );
}
