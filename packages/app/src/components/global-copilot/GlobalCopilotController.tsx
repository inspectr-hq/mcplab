import { Bot, MessageSquarePlus, Minimize2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useDataSource } from '@/contexts/DataSourceContext';
import { useRunQueueStatus } from '@/hooks/use-run-queue-status';
import { useGlobalCopilotRun } from '@/hooks/use-global-copilot-run';
import { useGlobalCopilotThread } from '@/hooks/use-global-copilot-thread';
import { invokeGlobalCopilotAction, registerGlobalCopilotAction } from '@/lib/global-copilot-actions';
import { storedGlobalCopilotMessage } from '@/lib/global-copilot-message';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';
import type { Scenario } from '@/types/eval';
import { toast } from '@/hooks/use-toast';
import { GlobalCopilotComposer } from './GlobalCopilotComposer';
import { GlobalCopilotConversation } from './GlobalCopilotConversation';
import { GlobalCopilotThreadList } from './GlobalCopilotThreadList';

const openKey = 'mcplab.globalCopilot.open';
const expandedKey = 'mcplab.globalCopilot.expanded';
const navigationTargets = new Set([
  '/',
  '/mcp-evaluations',
  '/run',
  '/results',
  '/compare',
  '/tool-analysis',
  '/tool-analysis-results',
  '/oauth-debugger',
  '/libraries/servers',
  '/libraries/agents',
  '/libraries/test-cases',
  '/settings'
]);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function GlobalCopilotController() {
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
        const id = typeof arguments_.id === 'string' ? arguments_.id.trim() : '';
        const prompt = typeof arguments_.prompt === 'string' ? arguments_.prompt.trim() : '';
        const servers = Array.isArray(arguments_.servers)
          ? arguments_.servers.filter((item): item is string => typeof item === 'string' && item.trim())
          : [];
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Test Case id must use letters, numbers, hyphens, or underscores.');
        if (!prompt || servers.length === 0) throw new Error('A Test Case needs a prompt and at least one MCP server.');
        const libraries = await source.getLibraries();
        if (libraries.scenarios.some((scenario) => scenario.id === id)) {
          throw new Error(`Test Case '${id}' already exists.`);
        }
        const missingServers = servers.filter((server) => !libraries.servers.some((item) => item.id === server));
        if (missingServers.length) throw new Error(`Unknown MCP server(s): ${missingServers.join(', ')}`);
        const requiredTools = Array.isArray(arguments_.required_tools)
          ? arguments_.required_tools.filter((item): item is string => typeof item === 'string' && item.trim())
          : [];
        const responsePatterns = Array.isArray(arguments_.response_regex_patterns)
          ? arguments_.response_regex_patterns.filter((item): item is string => typeof item === 'string' && item.trim())
          : [];
        const scenario: Scenario = {
          id,
          name: typeof arguments_.name === 'string' ? arguments_.name.trim() || id : id,
          serverIds: servers,
          prompt,
          evalRules: [
            ...requiredTools.map((value) => ({ type: 'required_tool' as const, value })),
            ...responsePatterns.map((value) => ({ type: 'response_regex' as const, value }))
          ],
          extractRules: []
        };
        await source.saveLibraries({ ...libraries, scenarios: [...libraries.scenarios, scenario] });
        toast({ title: 'Test Case created', description: `Created ${id} in Test Cases.` });
      }),
    [source]
  );
  const {
    workspaceKey,
    threads,
    thread,
    setThread,
    save,
    selectThread,
    renameThread,
    deleteThread,
    newThread
  } = useGlobalCopilotThread(source);
  const {
    loading,
    send: run,
    cancel
  } = useGlobalCopilotRun({
    version,
    queue: {
      runningCount: queue.runningCount,
      queuedCount: queue.queuedCount,
      oauthBlockedCount: queue.oauthBlockedCount,
      streamStatus: String(queue.streamStatus)
    },
    pathname: location.pathname,
    search: location.search,
    workspaceKey,
    thread,
    save,
    storeMessage: storedGlobalCopilotMessage
  });
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  useEffect(() => window.localStorage.setItem(openKey, open ? '1' : '0'), [open]);
  useEffect(() => window.localStorage.setItem(expandedKey, expanded ? '1' : '0'), [expanded]);
  useEffect(() => {
    if (!thread) return;
    const requested = thread.messages.find(
      (message) =>
        (message.action?.kind === 'navigate_to_view' ||
          message.action?.kind === 'open_test_case' ||
          message.action?.kind === 'navigate_to_result_detail') &&
        message.action.status === 'pending'
    );
    if (!requested?.action) return;
    const destination =
      requested.action.kind === 'navigate_to_view'
        ? navigationTargets.has(requested.action.path)
          ? requested.action.path
          : undefined
        : requested.action.kind === 'open_test_case'
          ? `/libraries/test-cases/${encodeURIComponent(requested.action.testCaseId)}`
          : `/results/${encodeURIComponent(requested.action.runId)}`;
    if (!destination) return;
    void save({
      ...thread,
      messages: thread.messages.map((message) =>
        message.id === requested.id
          ? {
              ...message,
              content:
                requested.action!.kind === 'open_test_case'
                  ? `Opened Test Case ${requested.action!.testCaseId}.`
                  : requested.action!.kind === 'navigate_to_result_detail'
                    ? `Opened Result Detail ${requested.action!.runId}.`
                  : `Opened ${destination}.`,
              action: { ...requested.action!, status: 'approved' as const }
            }
          : message
      )
    }).then(() => navigate(destination));
  }, [navigate, save, thread]);

  const send = useCallback(
    async (continuation?: GlobalCopilotMessage, continuationThread = thread) => {
      const question = continuation?.content ?? input.trim();
      if (!question) return;
      if (!continuation) setInput('');
      await run(question, continuation, continuationThread);
    },
    [input, run, thread]
  );
  const updateAction = useCallback(
    (message: GlobalCopilotMessage, status: 'approved' | 'denied' | 'error') => {
      if (!thread) return [];
      return thread.messages.map((item) =>
        item.id === message.id ? { ...item, action: { ...message.action!, status } } : item
      );
    },
    [thread]
  );
  const continueReading = useCallback(
    async (message: GlobalCopilotMessage, approved: boolean) => {
      if (!thread || message.action?.kind !== 'continue_reading') return;
      const saved = await save({
        ...thread,
        messages: updateAction(message, approved ? 'approved' : 'denied')
      });
      if (approved)
        await send(
          {
            id: id('continue'),
            role: 'system',
            content: `The user approved up to ${message.action.batchSize} additional read-only MCPLab tool calls. Continue investigating the most recent unresolved request.`,
            createdAt: new Date().toISOString()
          },
          saved
        );
    },
    [save, send, thread, updateAction]
  );
  const openResult = useCallback(
    async (message: GlobalCopilotMessage) => {
      if (!thread || message.action?.kind !== 'open_result_detail') return;
      await save({ ...thread, messages: updateAction(message, 'approved') });
      navigate(`/results/${encodeURIComponent(message.action.runId)}`);
    },
    [navigate, save, thread, updateAction]
  );
  const invokeConfirmed = useCallback(
    async (
      message: GlobalCopilotMessage,
      approved: boolean,
      path: string,
      label: string,
      body: Record<string, unknown>
    ) => {
      if (!thread) return;
      if (!approved) {
        await save({ ...thread, messages: updateAction(message, 'denied') });
        return;
      }
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const result = (await response.json()) as {
          content?: string;
          error?: string;
          runId?: string;
        };
        if (!response.ok) throw new Error(result.error ?? `${label} failed.`);
        const next: GlobalCopilotMessage[] = [
          ...updateAction(message, 'approved'),
          {
            id: id('result'),
            role: 'system',
            content: `${label}:\n${result.content ?? 'Completed.'}`,
            createdAt: new Date().toISOString()
          }
        ];
        if (result.runId)
          next.push({
            id: id('result-detail'),
            role: 'system',
            content: `Result Detail available for run ${result.runId}.`,
            createdAt: new Date().toISOString(),
            action: { kind: 'open_result_detail', runId: result.runId, status: 'pending' }
          });
        await save({ ...thread, messages: next });
      } catch (error) {
        await save({
          ...thread,
          messages: [
            ...updateAction(message, 'error'),
            {
              id: id('error'),
              role: 'system',
              content: error instanceof Error ? error.message : String(error),
              createdAt: new Date().toISOString()
            }
          ]
        });
      }
    },
    [save, thread, updateAction]
  );
  const runEvaluation = useCallback(
    (message: GlobalCopilotMessage, approved: boolean) =>
      message.action?.kind === 'run_mcp_evaluation'
        ? invokeConfirmed(
            message,
            approved,
            '/api/global-copilot/confirm-run-eval',
            'MCPLab evaluation completed',
            { arguments: message.action.arguments }
          )
        : Promise.resolve(),
    [invokeConfirmed]
  );
  const writeReport = useCallback(
    (message: GlobalCopilotMessage, approved: boolean) =>
      message.action?.kind === 'write_markdown_report'
        ? invokeConfirmed(
            message,
            approved,
            '/api/global-copilot/confirm-report-write',
            'Markdown report written',
            { arguments: message.action.arguments }
          )
        : Promise.resolve(),
    [invokeConfirmed]
  );
  const externalTool = useCallback(
    (message: GlobalCopilotMessage, approved: boolean) => {
      if (message.action?.kind !== 'external_mcp_tool') return Promise.resolve();
      const activeTestCaseId = location.pathname.match(/^\/libraries\/test-cases\/([^/]+)/)?.[1];
      return invokeConfirmed(
        message,
        approved,
        '/api/global-copilot/confirm-tool',
        'External tool result',
        {
          activeTestCaseId,
          serverName: message.action.serverName,
          toolName: message.action.toolName,
          arguments: message.action.arguments
        }
      );
    },
    [invokeConfirmed, location.pathname]
  );
  const startAction = useCallback(
    async (message: GlobalCopilotMessage, approved: boolean) => {
      if (!thread || message.action?.kind !== 'start_action') return;
      if (!approved) {
        await save({ ...thread, messages: updateAction(message, 'denied') });
        return;
      }
      try {
        await invokeGlobalCopilotAction(message.action.name);
        await save({ ...thread, messages: updateAction(message, 'approved') });
      } catch (error) {
        await save({
          ...thread,
          messages: [
            ...updateAction(message, 'error'),
            {
              id: id('error'),
              role: 'system',
              content: error instanceof Error ? error.message : String(error),
              createdAt: new Date().toISOString()
            }
          ]
        });
      }
    },
    [save, thread, updateAction]
  );
  const libraryAction = useCallback(
    async (message: GlobalCopilotMessage, approved: boolean) => {
      if (!thread || message.action?.kind !== 'library_action') return;
      if (!approved) {
        await save({ ...thread, messages: updateAction(message, 'denied') });
        return;
      }
      try {
        await invokeGlobalCopilotAction(message.action.name, message.action.arguments);
        await save({ ...thread, messages: updateAction(message, 'approved') });
      } catch (error) {
        await save({
          ...thread,
          messages: [
            ...updateAction(message, 'error'),
            {
              id: id('error'),
              role: 'system',
              content: error instanceof Error ? error.message : String(error),
              createdAt: new Date().toISOString()
            }
          ]
        });
      }
    },
    [save, thread, updateAction]
  );
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
        loading={loading}
        onCopy={(text) => void copy(text)}
        onContinue={(message, approved) => void continueReading(message, approved)}
        onOpenResult={(message) => void openResult(message)}
        onRunEvaluation={(message, approved) => void runEvaluation(message, approved)}
        onWriteReport={(message, approved) => void writeReport(message, approved)}
        onExternalTool={(message, approved) => void externalTool(message, approved)}
        onStartAction={(message, approved) => void startAction(message, approved)}
        onLibraryAction={(message, approved) => void libraryAction(message, approved)}
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
