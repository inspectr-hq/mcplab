import { useCallback, useEffect, useState } from 'react';
import type { useDataSource } from '@/contexts/DataSourceContext';
import {
  GlobalCopilotThreadStore,
  type GlobalCopilotThread,
  workspaceKeyFromRoot
} from '@/lib/global-copilot-thread-store';

const store = new GlobalCopilotThreadStore();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

type DataSource = ReturnType<typeof useDataSource>['source'];

export function useGlobalCopilotThread(source: DataSource) {
  const [workspaceKey, setWorkspaceKey] = useState<string>();
  const [threads, setThreads] = useState<GlobalCopilotThread[]>([]);
  const [thread, setThread] = useState<GlobalCopilotThread>();
  const refresh = useCallback(async (key: string) => {
    const next = await store.listThreads(key);
    setThreads(next);
    return next;
  }, []);

  useEffect(() => {
    void source.getWorkspaceSettings().then(async (settings) => {
      if (!settings) return;
      const key = await workspaceKeyFromRoot(settings.workspaceRoot);
      setWorkspaceKey(key);
      const next = await refresh(key);
      const activeId = await store.getActiveThreadId(key);
      setThread(next.find((item) => item.id === activeId) ?? next[0]);
    });
  }, [refresh, source]);

  const save = useCallback(
    async (next: GlobalCopilotThread) => {
      const saved = await store.saveThread({ ...next, updatedAt: new Date().toISOString() });
      await store.pruneThreads(saved.workspaceKey);
      await store.setActiveThreadId(saved.workspaceKey, saved.id);
      setThread(saved);
      await refresh(saved.workspaceKey);
      return saved;
    },
    [refresh]
  );
  const selectThread = useCallback((next: GlobalCopilotThread) => {
    void store.setActiveThreadId(next.workspaceKey, next.id);
    setThread(next);
  }, []);
  const renameThread = useCallback(
    async (next: GlobalCopilotThread) => {
      const title = window.prompt('Rename conversation', next.title)?.trim();
      if (!title || title === next.title) return;
      const saved = await store.saveThread({ ...next, title, updatedAt: new Date().toISOString() });
      if (thread?.id === saved.id) setThread(saved);
      await refresh(saved.workspaceKey);
    },
    [refresh, thread?.id]
  );
  const deleteThread = useCallback(
    async (next: GlobalCopilotThread) => {
      await store.deleteThread(next.workspaceKey, next.id);
      const remaining = await refresh(next.workspaceKey);
      if (thread?.id === next.id) {
        await store.setActiveThreadId(next.workspaceKey, remaining[0]?.id);
        setThread(remaining[0]);
      }
    },
    [refresh, thread?.id]
  );
  const newThread = useCallback(async () => {
    if (!workspaceKey) return;
    const now = new Date().toISOString();
    const next = await store.saveThread({
      id: id('gct'),
      workspaceKey,
      title: 'New conversation',
      messages: [],
      createdAt: now,
      updatedAt: now
    });
    await store.pruneThreads(workspaceKey);
    await store.setActiveThreadId(workspaceKey, next.id);
    setThread(next);
    await refresh(workspaceKey);
  }, [refresh, workspaceKey]);

  return {
    workspaceKey,
    threads,
    thread,
    setThread,
    save,
    selectThread,
    renameThread,
    deleteThread,
    newThread
  };
}
