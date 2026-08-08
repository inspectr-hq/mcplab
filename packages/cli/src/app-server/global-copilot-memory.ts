import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StorageThreadType } from '@mastra/core/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { z } from 'zod';

export const globalCopilotWorkingMemorySchema = z
  .object({
    goal: z.string(),
    constraints: z.array(z.string()),
    decisions: z.array(z.string()),
    followUps: z.array(z.string())
  })
  .strict();

export const GLOBAL_COPILOT_MEMORY_OPTIONS = {
  lastMessages: 20,
  semanticRecall: false as const,
  workingMemory: {
    enabled: true,
    scope: 'thread' as const,
    schema: globalCopilotWorkingMemorySchema
  }
};

export function globalCopilotMemoryDatabasePath(workspaceRoot: string): string {
  return join(workspaceRoot, 'mcplab', '.mastra', 'global-copilot.db');
}

export type GlobalCopilotMemoryRuntime = {
  storage: LibSQLStore;
  memory: Memory;
  close: () => Promise<void>;
};

export async function createGlobalCopilotMemoryRuntime(params: {
  databasePath: string;
}): Promise<GlobalCopilotMemoryRuntime> {
  await mkdir(dirname(params.databasePath), { recursive: true });
  const storage = new LibSQLStore({
    id: `global-copilot-${createHash('sha256').update(params.databasePath).digest('hex').slice(0, 16)}`,
    url: `file:${params.databasePath}`
  });
  await storage.init();
  return {
    storage,
    memory: new Memory({ storage, options: GLOBAL_COPILOT_MEMORY_OPTIONS }),
    close: () => storage.close()
  };
}

export class GlobalCopilotThreadService {
  constructor(
    private readonly memory: Memory,
    private readonly resourceId: string,
    private readonly maxThreads = 100
  ) {}

  async list(): Promise<StorageThreadType[]> {
    const result = await this.memory.listThreads({
      filter: { resourceId: this.resourceId },
      perPage: false,
      orderBy: { field: 'updatedAt', direction: 'DESC' }
    });
    return result.threads;
  }

  async get(id: string): Promise<StorageThreadType> {
    const thread = await this.memory.getThreadById({
      threadId: id,
      resourceId: this.resourceId
    });
    if (!thread || thread.resourceId !== this.resourceId) {
      throw new Error(`Global Copilot thread not found: ${id}`);
    }
    return thread;
  }

  async create(params: { id: string; title?: string }): Promise<StorageThreadType> {
    const now = new Date();
    const thread = await this.memory.saveThread({
      thread: {
        id: params.id,
        title: params.title?.trim() || 'New conversation',
        resourceId: this.resourceId,
        createdAt: now,
        updatedAt: now,
        metadata: {}
      }
    });
    await this.prune(thread.id);
    return thread;
  }

  async rename(id: string, title: string): Promise<StorageThreadType> {
    const thread = await this.get(id);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('Thread title is required.');
    return this.memory.updateThread({
      id,
      title: normalizedTitle,
      metadata: thread.metadata ?? {}
    });
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.memory.deleteThread(id);
  }

  private async prune(preserveId: string): Promise<void> {
    const threads = await this.list();
    if (threads.length <= this.maxThreads) return;
    const retained = new Set([
      preserveId,
      ...threads.filter((thread) => thread.id !== preserveId).slice(0, this.maxThreads - 1).map((thread) => thread.id)
    ]);
    await Promise.all(
      threads.filter((thread) => !retained.has(thread.id)).map((thread) => this.memory.deleteThread(thread.id))
    );
  }
}

const memoryRuntimes = new Map<string, Promise<GlobalCopilotMemoryRuntime>>();

export function getGlobalCopilotMemoryRuntime(
  workspaceRoot: string
): Promise<GlobalCopilotMemoryRuntime> {
  const databasePath = globalCopilotMemoryDatabasePath(workspaceRoot);
  let runtime = memoryRuntimes.get(databasePath);
  if (!runtime) {
    runtime = createGlobalCopilotMemoryRuntime({ databasePath });
    memoryRuntimes.set(databasePath, runtime);
    runtime.catch(() => memoryRuntimes.delete(databasePath));
  }
  return runtime;
}
