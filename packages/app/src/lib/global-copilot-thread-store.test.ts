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
});
