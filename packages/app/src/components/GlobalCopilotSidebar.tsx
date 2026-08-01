import { Bot, Copy, MessageSquarePlus, PanelRightClose, PanelRightOpen, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpAgent, type Message } from '@ag-ui/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AssistantComposer, AssistantMessageRow, AssistantTypingIndicator } from '@/components/assistant/AssistantChat';
import { useDataSource } from '@/contexts/DataSourceContext';
import { GlobalCopilotThreadStore, type GlobalCopilotMessage, type GlobalCopilotThread, workspaceKeyFromRoot } from '@/lib/global-copilot-thread-store';
import { availableGlobalCopilotActions, invokeGlobalCopilotAction } from '@/lib/global-copilot-actions';
import { globalCopilotRouteContext } from '@/lib/global-copilot-context';
import { useRunQueueStatus } from '@/hooks/use-run-queue-status';
import { toast } from '@/hooks/use-toast';

const store = new GlobalCopilotThreadStore();
const openKey = 'mcplab.globalCopilot.open';
const expandedKey = 'mcplab.globalCopilot.expanded';
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function stored(message: Message): GlobalCopilotMessage | null {
  const navigation = message.role === 'assistant'
    ? (message as Message & { toolCalls?: Array<{ function: { name: string; arguments: string } }> }).toolCalls?.find((call) => call.function.name === 'navigate_to_view')
    : undefined;
  if (navigation) {
    try {
      const args = JSON.parse(navigation.function.arguments) as { path?: unknown; reason?: unknown };
      if (typeof args.path === 'string') {
        return {
          id: message.id,
          role: 'system',
          content: `Navigation requested: ${args.path}`,
          createdAt: new Date().toISOString(),
          action: { kind: 'navigate_to_view', path: args.path, reason: typeof args.reason === 'string' ? args.reason : undefined, status: 'pending' }
        };
      }
    } catch { /* Invalid tool arguments are rendered as the normal assistant message. */ }
  }
  const externalTool = message.role === 'assistant'
    ? (message as Message & { toolCalls?: Array<{ function: { name: string; arguments: string } }> }).toolCalls?.find((call) => !['navigate_to_view', 'start_evaluation_run', 'start_tool_analysis'].includes(call.function.name) && !call.function.name.startsWith('mcplab__'))
    : undefined;
  if (externalTool) {
    try {
      const args = JSON.parse(externalTool.function.arguments) as Record<string, unknown>;
      const [serverName, ...toolParts] = externalTool.function.name.split('__');
      if (serverName && toolParts.length) {
        return {
          id: message.id,
          role: 'system',
          content: `External MCP call requested: ${serverName}/${toolParts.join('__')}`,
          createdAt: new Date().toISOString(),
          action: { kind: 'external_mcp_tool', serverName, toolName: toolParts.join('__'), arguments: args, status: 'pending' }
        };
      }
    } catch { /* Invalid tool arguments are rendered as the normal assistant message. */ }
  }
  const startAction = message.role === 'assistant'
    ? (message as Message & { toolCalls?: Array<{ function: { name: string; arguments: string } }> }).toolCalls?.find((call) => call.function.name === 'start_evaluation_run' || call.function.name === 'start_tool_analysis')
    : undefined;
  if (startAction) return { id: message.id, role: 'system', content: 'Run action requested.', createdAt: new Date().toISOString(), action: { kind: 'start_action', name: startAction.function.name as 'start_evaluation_run' | 'start_tool_analysis', status: 'pending' } };
  if (!['user', 'assistant', 'tool', 'system'].includes(message.role) || typeof message.content !== 'string') return null;
  return {
    id: message.id,
    role: message.role as GlobalCopilotMessage['role'],
    content: message.content,
    createdAt: new Date().toISOString(),
    ...((message as Message & { toolCallId?: string }).toolCallId ? { toolCallId: (message as Message & { toolCallId?: string }).toolCallId } : {})
  };
}

export function GlobalCopilotSidebar() {
  const { source, version } = useDataSource();
  const location = useLocation();
  const navigate = useNavigate();
  const queue = useRunQueueStatus();
  const [open, setOpen] = useState(() => window.localStorage.getItem(openKey) !== '0');
  const [expanded, setExpanded] = useState(() => window.localStorage.getItem(expandedKey) === '1');
  const [workspaceKey, setWorkspaceKey] = useState<string>();
  const [threads, setThreads] = useState<GlobalCopilotThread[]>([]);
  const [thread, setThread] = useState<GlobalCopilotThread>();
  const [showRecentThreads, setShowRecentThreads] = useState(true);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [threadQuery, setThreadQuery] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const agentRef = useRef<HttpAgent>();
  const refresh = useCallback(async (key: string) => { const next = await store.listThreads(key); setThreads(next); return next; }, []);

  useEffect(() => { void source.getWorkspaceSettings().then(async (settings) => { if (!settings) return; const key = await workspaceKeyFromRoot(settings.workspaceRoot); setWorkspaceKey(key); const next = await refresh(key); const activeId = await store.getActiveThreadId(key); setThread(next.find((item) => item.id === activeId) ?? next[0]); }); }, [refresh, source]);
  useEffect(() => window.localStorage.setItem(openKey, open ? '1' : '0'), [open]);
  useEffect(() => window.localStorage.setItem(expandedKey, expanded ? '1' : '0'), [expanded]);
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const save = useCallback(async (next: GlobalCopilotThread) => { const saved = await store.saveThread({ ...next, updatedAt: new Date().toISOString() }); await store.pruneThreads(saved.workspaceKey); await store.setActiveThreadId(saved.workspaceKey, saved.id); setThread(saved); await refresh(saved.workspaceKey); return saved; }, [refresh]);
  const selectThread = useCallback((next: GlobalCopilotThread) => { void store.setActiveThreadId(next.workspaceKey, next.id); setThread(next); }, []);
  const renameThread = useCallback(async (next: GlobalCopilotThread) => {
    const title = window.prompt('Rename conversation', next.title)?.trim();
    if (!title || title === next.title) return;
    const saved = await store.saveThread({ ...next, title, updatedAt: new Date().toISOString() });
    if (thread?.id === saved.id) setThread(saved);
    await refresh(saved.workspaceKey);
  }, [refresh, thread?.id]);
  const newThread = useCallback(async () => { if (!workspaceKey) return; const now = new Date().toISOString(); const next = await store.saveThread({ id: id('gct'), workspaceKey, title: 'New conversation', messages: [], createdAt: now, updatedAt: now }); await store.pruneThreads(workspaceKey); await store.setActiveThreadId(workspaceKey, next.id); setThread(next); await refresh(workspaceKey); }, [refresh, workspaceKey]);
  const send = useCallback(async () => {
    const question = input.trim(); if (!question || !workspaceKey || loading) return;
    const now = new Date().toISOString();
    const active = thread ?? await store.saveThread({ id: id('gct'), workspaceKey, title: question.slice(0, 60), messages: [], createdAt: now, updatedAt: now });
    const user: GlobalCopilotMessage = { id: id('msg'), role: 'user', content: question, createdAt: now };
    const optimistic = await save({ ...active, title: active.messages.length ? active.title : question.slice(0, 60), messages: [...active.messages, user] });
    setInput(''); setLoading(true);
    try {
      const agent = new HttpAgent({ url: '/api/global-copilot/run', agentId: 'mcplab-global-copilot', threadId: optimistic.id, initialMessages: optimistic.messages.map((message) => {
        if (message.role === 'tool' && !message.toolCallId) {
          return { id: message.id, role: 'system' as const, content: `Previously retrieved tool data:\n${message.content}` };
        }
        return { id: message.id, role: message.role, content: message.content, ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}) };
      }) });
      agentRef.current = agent;
      await agent.runAgent({
        forwardedProps: {
          context: {
            ...globalCopilotRouteContext(location.pathname, location.search),
            mcplabVersion: version,
            queue: {
              runningCount: queue.runningCount,
              queuedCount: queue.queuedCount,
              oauthBlockedCount: queue.oauthBlockedCount,
              streamStatus: queue.streamStatus
            },
            availableActions: availableGlobalCopilotActions()
          }
        }
      });
      const nextMessages = agent.messages.map(stored).filter((message): message is GlobalCopilotMessage => message !== null);
      await save({ ...optimistic, messages: nextMessages });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      await save({ ...optimistic, messages: [...optimistic.messages, { id: id('system'), role: 'system', content: `Copilot request failed: ${text}`, createdAt: new Date().toISOString() }] });
    } finally { agentRef.current = undefined; setLoading(false); }
  }, [input, loading, location.pathname, location.search, queue.oauthBlockedCount, queue.queuedCount, queue.runningCount, queue.streamStatus, save, thread, workspaceKey]);
  const confirmNavigation = useCallback(async (message: GlobalCopilotMessage, approved: boolean) => {
    if (!thread || !message.action || message.action.kind !== 'navigate_to_view') return;
    const allowed = new Set(['/', '/mcp-evaluations', '/run', '/results', '/compare', '/tool-analysis', '/tool-analysis-results', '/libraries/servers', '/libraries/agents', '/libraries/test-cases', '/settings']);
    if (!allowed.has(message.action.path)) return;
    const messages = thread.messages.map((item) => item.id === message.id ? { ...item, action: { ...message.action!, status: approved ? 'approved' as const : 'denied' as const } } : item);
    await save({ ...thread, messages });
    if (approved) navigate(message.action.path);
  }, [navigate, save, thread]);
  const confirmExternalTool = useCallback(async (message: GlobalCopilotMessage, approved: boolean) => {
    if (!thread || !message.action || message.action.kind !== 'external_mcp_tool') return;
    const update = (status: 'approved' | 'denied' | 'error') => thread.messages.map((item) => item.id === message.id ? { ...item, action: { ...message.action!, status } } : item);
    if (!approved) { await save({ ...thread, messages: update('denied') }); return; }
    try {
      const activeTestCaseId = location.pathname.match(/^\/libraries\/test-cases\/([^/]+)/)?.[1];
      const response = await fetch('/api/global-copilot/confirm-tool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ activeTestCaseId, serverName: message.action.serverName, toolName: message.action.toolName, arguments: message.action.arguments }) });
      const body = await response.json() as { content?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'The MCP call failed.');
      await save({ ...thread, messages: [...update('approved'), { id: id('tool'), role: 'system', content: `External tool result:\n${body.content ?? 'Tool completed.'}`, createdAt: new Date().toISOString() }] });
    } catch (error: unknown) {
      await save({ ...thread, messages: [...update('error'), { id: id('tool'), role: 'system', content: error instanceof Error ? error.message : String(error), createdAt: new Date().toISOString() }] });
    }
  }, [location.pathname, save, thread]);
  const confirmStartAction = useCallback(async (message: GlobalCopilotMessage, approved: boolean) => {
    if (!thread || !message.action || message.action.kind !== 'start_action') return;
    const update = (status: 'approved' | 'denied' | 'error') => thread.messages.map((item) => item.id === message.id ? { ...item, action: { ...message.action!, status } } : item);
    if (!approved) { await save({ ...thread, messages: update('denied') }); return; }
    try { await invokeGlobalCopilotAction(message.action.name); await save({ ...thread, messages: update('approved') }); }
    catch (error: unknown) { await save({ ...thread, messages: [...update('error'), { id: id('system'), role: 'system', content: error instanceof Error ? error.message : String(error), createdAt: new Date().toISOString() }] }); }
  }, [save, thread]);
  const copyMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied to clipboard' });
    } catch {
      toast({ title: 'Could not copy message', variant: 'destructive' });
    }
  }, []);

  if (!open) return <button type="button" aria-label="Open global copilot" onClick={() => setOpen(true)} className="fixed right-3 top-14 z-30 rounded-md border bg-card p-2 shadow"><Bot className="h-4 w-4" /></button>;
  return <aside className={`hidden h-screen min-h-0 shrink-0 overflow-hidden border-l bg-card transition-[width] duration-200 ${expanded ? 'w-[52rem] max-w-[60vw]' : 'w-[360px]'} lg:flex lg:flex-col`} aria-label="Global copilot">
    <div className="flex items-center gap-2 border-b p-3"><Bot className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">Global Copilot</span><div className="ml-auto flex items-center gap-1"><Button size="icon" variant="ghost" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Compact global copilot' : 'Expand global copilot'} title={expanded ? 'Compact' : 'Expand'}>{expanded ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button><Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Collapse global copilot"><PanelRightClose className="h-4 w-4" /></Button></div></div>
    <div className="border-b p-2"><Button size="sm" className="w-full" onClick={() => void newThread()}><MessageSquarePlus className="mr-2 h-4 w-4" />New chat</Button></div>
    <div className="border-b p-2"><div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground"><button type="button" className="hover:text-foreground" onClick={() => setShowRecentThreads((value) => !value)} aria-expanded={showRecentThreads}>{showRecentThreads ? 'Recent conversations ▾' : 'Recent conversations ▸'}</button><button type="button" className="hover:text-foreground" onClick={() => { setShowAllThreads((value) => !value); setShowRecentThreads(true); }}>{showAllThreads ? 'Recent only' : `All conversations (${threads.length})`}</button></div>{showRecentThreads && <>{showAllThreads && <input className="mb-1 h-8 w-full rounded border bg-background px-2 text-xs" value={threadQuery} onChange={(event) => setThreadQuery(event.target.value)} placeholder="Search conversations" />}<ScrollArea className={showAllThreads ? 'max-h-48' : 'max-h-52'}><div className="p-1">{threads.filter((item) => showAllThreads ? item.title.toLowerCase().includes(threadQuery.toLowerCase()) : true).slice(0, showAllThreads ? 100 : 6).map((item) => <div key={item.id} className="flex items-center"><button type="button" onClick={() => selectThread(item)} className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-xs ${thread?.id === item.id ? 'bg-muted font-medium' : 'hover:bg-muted/50'}`}>{item.title}</button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Rename ${item.title}`} onClick={() => void renameThread(item)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${item.title}`} onClick={async () => { await store.deleteThread(item.workspaceKey, item.id); const next = await refresh(item.workspaceKey); if (thread?.id === item.id) { await store.setActiveThreadId(item.workspaceKey, next[0]?.id); setThread(next[0]); } }}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></ScrollArea></>}</div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">{messages.length === 0 && <p className="text-sm text-muted-foreground">Ask about results, test cases, or MCPLab.</p>}{messages.map((message) => <div key={message.id} className="space-y-2">{message.role === 'tool' ? <details className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-900"><summary className="cursor-pointer font-medium">Used MCPLab data</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{message.content}</pre></details> : <AssistantMessageRow message={{ id: message.id, role: message.role, text: message.content, createdAt: message.createdAt }} renderActions={message.role === 'assistant' ? <Button type="button" variant="ghost" size="icon" className="mt-1 h-7 w-7" onClick={() => void copyMessage(message.content)} aria-label="Copy message" title="Copy message"><Copy className="h-3.5 w-3.5" /></Button> : undefined} />}{message.action?.kind === 'navigate_to_view' && message.action.status === 'pending' && <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm"><p>{message.action.reason || `Open ${message.action.path}?`}</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void confirmNavigation(message, true)}>Open view</Button><Button size="sm" variant="outline" onClick={() => void confirmNavigation(message, false)}>Not now</Button></div></div>}{message.action?.kind === 'external_mcp_tool' && message.action.status === 'pending' && <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm"><p>Run {message.action.serverName}/{message.action.toolName}?</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void confirmExternalTool(message, true)}>Run tool</Button><Button size="sm" variant="outline" onClick={() => void confirmExternalTool(message, false)}>Not now</Button></div></div>}{message.action?.kind === 'start_action' && message.action.status === 'pending' && <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm"><p>Start {message.action.name === 'start_evaluation_run' ? 'the evaluation run' : 'Tool Analysis'} using the current page settings?</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void confirmStartAction(message, true)}>Start</Button><Button size="sm" variant="outline" onClick={() => void confirmStartAction(message, false)}>Not now</Button></div></div>}{message.action?.kind === 'navigate_to_view' && message.action.status === 'approved' && <p className="text-xs text-emerald-700">Opened {message.action.path}</p>}{message.action?.status === 'denied' && <p className="text-xs text-muted-foreground">Action declined</p>}{message.action?.status === 'error' && <p className="text-xs text-destructive">Action failed</p>}</div>)}{loading && <AssistantTypingIndicator />}</div></ScrollArea>
    <div className="border-t p-3"><AssistantComposer input={input} onInputChange={setInput} onSend={() => void send()} onCancel={() => agentRef.current?.abortRun()} disabled={loading} loading={loading} inputPlaceholder="Ask MCPLab..." snippets={[]} snippetsLabel="Suggestions" onSnippetSelect={setInput} /></div>
  </aside>;
}
