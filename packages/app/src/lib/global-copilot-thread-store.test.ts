import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { GlobalCopilotThreadStore } from './global-copilot-thread-store';

describe('GlobalCopilotThreadStore', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('mcplab-global-copilot');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  it('partitions threads by workspace key', async () => {
    const store = new GlobalCopilotThreadStore();
    await store.saveThread({ id: 'one', workspaceKey: 'workspace-a', title: 'A', messages: [] });
    await store.saveThread({ id: 'two', workspaceKey: 'workspace-b', title: 'B', messages: [] });

    expect((await store.listThreads('workspace-a')).map((thread) => thread.id)).toEqual(['one']);
    expect((await store.listThreads('workspace-b')).map((thread) => thread.id)).toEqual(['two']);
  });

  it('keeps the active thread selection within its workspace partition', async () => {
    const store = new GlobalCopilotThreadStore();
    await store.setActiveThreadId('workspace-a', 'thread-a');
    await store.setActiveThreadId('workspace-b', 'thread-b');

    await expect(store.getActiveThreadId('workspace-a')).resolves.toBe('thread-a');
    await expect(store.getActiveThreadId('workspace-b')).resolves.toBe('thread-b');
  });

  it('prunes only the oldest threads beyond a workspace retention limit', async () => {
    const store = new GlobalCopilotThreadStore();
    await store.saveThread({ id: 'old', workspaceKey: 'workspace-a', title: 'Old', messages: [], updatedAt: '2026-01-01T00:00:00.000Z' });
    await store.saveThread({ id: 'new', workspaceKey: 'workspace-a', title: 'New', messages: [], updatedAt: '2026-01-02T00:00:00.000Z' });
    await store.pruneThreads('workspace-a', 1);

    expect((await store.listThreads('workspace-a')).map((thread) => thread.id)).toEqual(['new']);
  });
});
