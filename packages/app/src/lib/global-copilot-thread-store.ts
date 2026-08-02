export type GlobalCopilotMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  createdAt: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  action?:
    | {
        kind: 'navigate_to_view';
        path: string;
        reason?: string;
        status: 'pending' | 'approved' | 'denied';
      }
    | {
        kind: 'external_mcp_tool';
        serverName: string;
        toolName: string;
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'start_action';
        name: 'start_evaluation_run' | 'start_tool_analysis';
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'library_action';
        name: 'duplicate_test_case' | 'duplicate_mcp_server' | 'duplicate_agent';
        arguments: { id: string };
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'continue_reading';
        batchSize: number;
        status: 'pending' | 'approved' | 'denied';
      }
    | {
        kind: 'open_result_detail';
        runId: string;
        status: 'pending' | 'approved';
      }
    | {
        kind: 'open_test_case';
        testCaseId: string;
        status: 'pending' | 'approved';
      }
    | {
        kind: 'navigate_to_result_detail';
        runId: string;
        status: 'pending' | 'approved';
      }
    | {
        kind: 'run_mcp_evaluation';
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'write_markdown_report';
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      };
};

export type GlobalCopilotThread = {
  version: 1;
  id: string;
  workspaceKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: GlobalCopilotMessage[];
};

export type GlobalCopilotThreadInput = Omit<
  GlobalCopilotThread,
  'version' | 'createdAt' | 'updatedAt'
> &
  Partial<Pick<GlobalCopilotThread, 'createdAt' | 'updatedAt'>>;

const DATABASE_NAME = 'mcplab-global-copilot';
const STORE_NAME = 'threads';
const PREFERENCES_STORE_NAME = 'preferences';

export class GlobalCopilotThreadStore {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          const store = request.result.createObjectStore(STORE_NAME, {
            keyPath: ['workspaceKey', 'id']
          });
          store.createIndex('workspace-updated', ['workspaceKey', 'updatedAt']);
        }
        if (!request.result.objectStoreNames.contains(PREFERENCES_STORE_NAME)) {
          request.result.createObjectStore(PREFERENCES_STORE_NAME, { keyPath: 'workspaceKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveThread(input: GlobalCopilotThreadInput): Promise<GlobalCopilotThread> {
    const now = new Date().toISOString();
    const thread: GlobalCopilotThread = {
      version: 1,
      id: input.id,
      workspaceKey: input.workspaceKey,
      title: input.title,
      messages: input.messages,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    };
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(thread);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return thread;
  }

  async listThreads(workspaceKey: string): Promise<GlobalCopilotThread[]> {
    const database = await this.open();
    const threads = await new Promise<GlobalCopilotThread[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as GlobalCopilotThread[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return threads
      .filter((thread) => thread.workspaceKey === workspaceKey)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async deleteThread(workspaceKey: string, id: string): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete([workspaceKey, id]);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async pruneThreads(workspaceKey: string, maxThreads = 100): Promise<void> {
    const stale = (await this.listThreads(workspaceKey)).slice(Math.max(0, maxThreads));
    await Promise.all(stale.map((thread) => this.deleteThread(workspaceKey, thread.id)));
  }

  async getActiveThreadId(workspaceKey: string): Promise<string | undefined> {
    const database = await this.open();
    const record = await new Promise<{ workspaceKey: string; activeThreadId?: string } | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction(PREFERENCES_STORE_NAME, 'readonly')
          .objectStore(PREFERENCES_STORE_NAME)
          .get(workspaceKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    database.close();
    return record?.activeThreadId;
  }

  async setActiveThreadId(workspaceKey: string, activeThreadId: string | undefined): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PREFERENCES_STORE_NAME, 'readwrite');
      transaction.objectStore(PREFERENCES_STORE_NAME).put({ workspaceKey, activeThreadId });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }
}

export async function workspaceKeyFromRoot(workspaceRoot: string): Promise<string> {
  const bytes = new TextEncoder().encode(workspaceRoot);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}
