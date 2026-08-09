import { useCallback, useEffect, useRef, useState } from 'react';
import type { useDataSource } from '@/contexts/DataSourceContext';
import type {
  GlobalCopilotMessage,
  GlobalCopilotThread
} from '@/lib/global-copilot-thread-store';
import { workspaceKeyFromRoot } from '@/lib/global-copilot-thread-store';

const activePreferenceKey = (workspaceKey: string) =>
  `mcplab.globalCopilot.activeThread.${workspaceKey}`;

type DataSource = ReturnType<typeof useDataSource>['source'];
type ThreadRecord = Omit<GlobalCopilotThread, 'version' | 'workspaceKey' | 'messages'>;

function pendingInterrupts(record: ThreadRecord) {
  const metadata = (record as ThreadRecord & { metadata?: Record<string, unknown> }).metadata;
  return Array.isArray(metadata?.globalCopilotPendingInterrupts)
    ? (metadata.globalCopilotPendingInterrupts as GlobalCopilotThread['pendingInterrupts'])
    : undefined;
}

function textFromMemoryContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map((part) => part.text)
    .join('');
}

function memoryMessageCreatedAt(message: any): string {
  return typeof message.createdAt === 'string'
    ? message.createdAt
    : new Date(message.createdAt ?? Date.now()).toISOString();
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result ?? null, null, 2);
  } catch {
    return String(result);
  }
}

export function globalCopilotMemoryMessages(message: any): GlobalCopilotMessage[] {
  if (!message || !['user', 'assistant', 'system'].includes(message.role)) return [];
  const content = textFromMemoryContent(message.content);
  const createdAt = memoryMessageCreatedAt(message);
  const restored: GlobalCopilotMessage[] = content.trim()
    ? [{ id: String(message.id), role: message.role, content, createdAt }]
    : [];
  const parts = message.content?.parts;
  if (!Array.isArray(parts)) return restored;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const invocation =
      part.type === 'tool-invocation' && part.toolInvocation && typeof part.toolInvocation === 'object'
        ? part.toolInvocation
        : part.type === 'tool-result'
          ? part
          : undefined;
    if (!invocation || !('result' in invocation)) continue;
    const toolCallId = String(invocation.toolCallId ?? `${message.id}-tool`);
    restored.push({
      id: `${message.id}-${toolCallId}`,
      role: 'tool',
      content: stringifyToolResult(invocation.result),
      createdAt,
      toolCallId,
      toolName: String(invocation.toolName ?? 'mcplab_read'),
      toolArguments:
        invocation.args && typeof invocation.args === 'object'
          ? (invocation.args as Record<string, unknown>)
          : {}
    });
  }
  return restored;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

export function useGlobalCopilotThread(source: DataSource) {
  const [workspaceKey, setWorkspaceKey] = useState<string>();
  const [threads, setThreads] = useState<GlobalCopilotThread[]>([]);
  const [thread, setThread] = useState<GlobalCopilotThread>();
  const selectionRequest = useRef(0);

  const loadThread = useCallback(async (record: ThreadRecord, key: string) => {
    const detail = await responseJson<{ thread: ThreadRecord; messages: unknown[] }>(
      await fetch(`/api/global-copilot/threads/${encodeURIComponent(record.id)}`)
    );
    return {
      ...detail.thread,
      version: 1 as const,
      workspaceKey: key,
      pendingInterrupts: pendingInterrupts(detail.thread),
      messages: detail.messages.flatMap(globalCopilotMemoryMessages)
    };
  }, []);

  const refresh = useCallback(async (key: string) => {
    const result = await responseJson<{ threads: ThreadRecord[] }>(
      await fetch('/api/global-copilot/threads')
    );
    const next = result.threads.map((item) => ({
      ...item,
      version: 1 as const,
      workspaceKey: key,
      pendingInterrupts: pendingInterrupts(item),
      messages: []
    }));
    setThreads(next);
    return next;
  }, []);

  useEffect(() => {
    void source.getWorkspaceSettings().then(async (settings) => {
      if (!settings) return;
      const key = await workspaceKeyFromRoot(settings.workspaceRoot);
      setWorkspaceKey(key);
      let next = await refresh(key);
      if (!next.length) {
        const created = await responseJson<{ thread: ThreadRecord }>(
          await fetch('/api/global-copilot/threads', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'New conversation' })
          })
        );
        next = await refresh(key);
        window.localStorage.setItem(activePreferenceKey(key), created.thread.id);
      }
      const activeId = window.localStorage.getItem(activePreferenceKey(key));
      const selected = next.find((item) => item.id === activeId) ?? next[0];
      if (selected) {
        const request = ++selectionRequest.current;
        const loaded = await loadThread(selected, key);
        if (request === selectionRequest.current) setThread(loaded);
      }
    });
  }, [loadThread, refresh, source]);

  const selectThread = useCallback(
    (next: GlobalCopilotThread) => {
      if (!workspaceKey) return;
      window.localStorage.setItem(activePreferenceKey(workspaceKey), next.id);
      const request = ++selectionRequest.current;
      void loadThread(next, workspaceKey).then((loaded) => {
        if (request === selectionRequest.current) setThread(loaded);
      });
    },
    [loadThread, workspaceKey]
  );

  const renameThread = useCallback(
    async (next: GlobalCopilotThread, explicitTitle?: string) => {
      const title = (explicitTitle ?? window.prompt('Rename conversation', next.title))?.trim();
      if (!title || title === next.title || !workspaceKey) return;
      const result = await responseJson<{ thread: ThreadRecord }>(
        await fetch(`/api/global-copilot/threads/${encodeURIComponent(next.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title })
        })
      );
      if (thread?.id === next.id) {
        setThread((current) => (current ? { ...current, ...result.thread } : current));
      }
      await refresh(workspaceKey);
    },
    [refresh, thread?.id, workspaceKey]
  );

  const deleteThread = useCallback(
    async (next: GlobalCopilotThread) => {
      if (!workspaceKey) return;
      const response = await fetch(`/api/global-copilot/threads/${encodeURIComponent(next.id)}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error(`Delete failed (${response.status}).`);
      let remaining = await refresh(workspaceKey);
      if (!remaining.length) {
        await responseJson(
          await fetch('/api/global-copilot/threads', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'New conversation' })
          })
        );
        remaining = await refresh(workspaceKey);
      }
      if (thread?.id === next.id && remaining[0]) {
        ++selectionRequest.current;
        window.localStorage.setItem(activePreferenceKey(workspaceKey), remaining[0].id);
        setThread(await loadThread(remaining[0], workspaceKey));
      }
    },
    [loadThread, refresh, thread?.id, workspaceKey]
  );

  const newThread = useCallback(async () => {
    if (!workspaceKey) return;
    const result = await responseJson<{ thread: ThreadRecord; messages: unknown[] }>(
      await fetch('/api/global-copilot/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New conversation' })
      })
    );
    const next: GlobalCopilotThread = {
      ...result.thread,
      version: 1,
      workspaceKey,
      pendingInterrupts: pendingInterrupts(result.thread),
      messages: []
    };
    window.localStorage.setItem(activePreferenceKey(workspaceKey), next.id);
    ++selectionRequest.current;
    setThread(next);
    await refresh(workspaceKey);
    return next;
  }, [refresh, workspaceKey]);

  return {
    workspaceKey,
    threads,
    thread,
    setThread,
    refresh,
    selectThread,
    renameThread,
    deleteThread,
    newThread
  };
}
