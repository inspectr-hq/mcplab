import { Bot, MessageSquarePlus, PanelRightClose, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HttpAgent, type Message } from '@ag-ui/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AssistantComposer, AssistantMessageRow, AssistantTypingIndicator } from '@/components/assistant/AssistantChat';
import { useDataSource } from '@/contexts/DataSourceContext';
import { GlobalCopilotThreadStore, type GlobalCopilotMessage, type GlobalCopilotThread, workspaceKeyFromRoot } from '@/lib/global-copilot-thread-store';

const store = new GlobalCopilotThreadStore();
const openKey = 'mcplab.globalCopilot.open';
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
  if (!['user', 'assistant', 'tool', 'system'].includes(message.role) || typeof message.content !== 'string') return null;
  return { id: message.id, role: message.role as GlobalCopilotMessage['role'], content: message.content, createdAt: new Date().toISOString() };
}

export function GlobalCopilotSidebar() {
  const { source } = useDataSource();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(() => window.localStorage.getItem(openKey) !== '0');
  const [workspaceKey, setWorkspaceKey] = useState<string>();
  const [threads, setThreads] = useState<GlobalCopilotThread[]>([]);
  const [thread, setThread] = useState<GlobalCopilotThread>();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async (key: string) => { const next = await store.listThreads(key); setThreads(next); return next; }, []);

  useEffect(() => { void source.getWorkspaceSettings().then(async (settings) => { if (!settings) return; const key = await workspaceKeyFromRoot(settings.workspaceRoot); setWorkspaceKey(key); const next = await refresh(key); const activeId = await store.getActiveThreadId(key); setThread(next.find((item) => item.id === activeId) ?? next[0]); }); }, [refresh, source]);
  useEffect(() => window.localStorage.setItem(openKey, open ? '1' : '0'), [open]);
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const save = useCallback(async (next: GlobalCopilotThread) => { const saved = await store.saveThread({ ...next, updatedAt: new Date().toISOString() }); await store.setActiveThreadId(saved.workspaceKey, saved.id); setThread(saved); await refresh(saved.workspaceKey); return saved; }, [refresh]);
  const selectThread = useCallback((next: GlobalCopilotThread) => { void store.setActiveThreadId(next.workspaceKey, next.id); setThread(next); }, []);
  const newThread = useCallback(async () => { if (!workspaceKey) return; const now = new Date().toISOString(); const next = await store.saveThread({ id: id('gct'), workspaceKey, title: 'New conversation', messages: [], createdAt: now, updatedAt: now }); await store.setActiveThreadId(workspaceKey, next.id); setThread(next); await refresh(workspaceKey); }, [refresh, workspaceKey]);
  const send = useCallback(async () => {
    const question = input.trim(); if (!question || !workspaceKey || loading) return;
    const now = new Date().toISOString();
    const active = thread ?? await store.saveThread({ id: id('gct'), workspaceKey, title: question.slice(0, 60), messages: [], createdAt: now, updatedAt: now });
    const user: GlobalCopilotMessage = { id: id('msg'), role: 'user', content: question, createdAt: now };
    const optimistic = await save({ ...active, title: active.messages.length ? active.title : question.slice(0, 60), messages: [...active.messages, user] });
    setInput(''); setLoading(true);
    try {
      const agent = new HttpAgent({ url: '/api/global-copilot/run', agentId: 'mcplab-global-copilot', threadId: optimistic.id, initialMessages: optimistic.messages.map((message) => ({ id: message.id, role: message.role, content: message.content })) });
      await agent.runAgent({
        forwardedProps: {
          context: {
            pathname: location.pathname,
            search: location.search,
            activeTestCaseId: location.pathname.match(/^\/libraries\/test-cases\/([^/]+)/)?.[1]
          }
        }
      });
      const nextMessages = agent.messages.map(stored).filter((message): message is GlobalCopilotMessage => message !== null);
      await save({ ...optimistic, messages: nextMessages });
    } finally { setLoading(false); }
  }, [input, loading, location.pathname, location.search, save, thread, workspaceKey]);
  const confirmNavigation = useCallback(async (message: GlobalCopilotMessage, approved: boolean) => {
    if (!thread || !message.action || message.action.kind !== 'navigate_to_view') return;
    const allowed = new Set(['/', '/mcp-evaluations', '/run', '/results', '/compare', '/tool-analysis', '/tool-analysis-results', '/libraries/servers', '/libraries/agents', '/libraries/test-cases', '/settings']);
    if (!allowed.has(message.action.path)) return;
    const messages = thread.messages.map((item) => item.id === message.id ? { ...item, action: { ...message.action!, status: approved ? 'approved' as const : 'denied' as const } } : item);
    await save({ ...thread, messages });
    if (approved) navigate(message.action.path);
  }, [navigate, save, thread]);

  if (!open) return <button type="button" aria-label="Open global copilot" onClick={() => setOpen(true)} className="fixed right-3 top-14 z-30 rounded-md border bg-card p-2 shadow"><Bot className="h-4 w-4" /></button>;
  return <aside className="hidden w-[360px] shrink-0 border-l bg-card lg:flex lg:flex-col" aria-label="Global copilot">
    <div className="flex items-center gap-2 border-b p-3"><Bot className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">Global Copilot</span><Button className="ml-auto" size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Collapse global copilot"><PanelRightClose className="h-4 w-4" /></Button></div>
    <div className="border-b p-2"><Button size="sm" className="w-full" onClick={() => void newThread()}><MessageSquarePlus className="mr-2 h-4 w-4" />New chat</Button></div>
    <ScrollArea className="max-h-32 border-b"><div className="p-1">{threads.map((item) => <div key={item.id} className="flex items-center"><button type="button" onClick={() => selectThread(item)} className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-xs ${thread?.id === item.id ? 'bg-muted font-medium' : 'hover:bg-muted/50'}`}>{item.title}</button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${item.title}`} onClick={async () => { await store.deleteThread(item.workspaceKey, item.id); const next = await refresh(item.workspaceKey); if (thread?.id === item.id) { await store.setActiveThreadId(item.workspaceKey, next[0]?.id); setThread(next[0]); } }}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></ScrollArea>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">{messages.length === 0 && <p className="text-sm text-muted-foreground">Ask about results, test cases, or MCPLab.</p>}{messages.map((message) => <div key={message.id} className="space-y-2"><AssistantMessageRow message={{ id: message.id, role: message.role, text: message.content, createdAt: message.createdAt }} />{message.action?.status === 'pending' && <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm"><p>{message.action.reason || `Open ${message.action.path}?`}</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void confirmNavigation(message, true)}>Open view</Button><Button size="sm" variant="outline" onClick={() => void confirmNavigation(message, false)}>Not now</Button></div></div>}{message.action?.status === 'approved' && <p className="text-xs text-emerald-700">Opened {message.action.path}</p>}{message.action?.status === 'denied' && <p className="text-xs text-muted-foreground">Navigation declined</p>}</div>)}{loading && <AssistantTypingIndicator />}</div></ScrollArea>
    <div className="border-t p-3"><AssistantComposer input={input} onInputChange={setInput} onSend={() => void send()} disabled={loading} loading={loading} inputPlaceholder="Ask MCPLab..." snippets={[]} snippetsLabel="Suggestions" onSnippetSelect={setInput} /></div>
  </aside>;
}
