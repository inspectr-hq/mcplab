import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GLOBAL_COPILOT_MEMORY_OPTIONS,
  GlobalCopilotThreadService,
  createGlobalCopilotMemoryRuntime,
  globalCopilotMemoryDatabasePath,
  globalCopilotWorkingMemorySchema
} from './global-copilot-memory.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Global Copilot Mastra memory', () => {
  it('uses the explicit thread-scoped strict working-memory schema', () => {
    expect(GLOBAL_COPILOT_MEMORY_OPTIONS.lastMessages).toBe(20);
    expect(GLOBAL_COPILOT_MEMORY_OPTIONS.workingMemory.scope).toBe('thread');
    expect(
      globalCopilotWorkingMemorySchema.parse({
        goal: 'Investigate the failed run',
        constraints: ['Do not change evaluation behavior'],
        decisions: [],
        followUps: ['Inspect the trace']
      })
    ).toEqual(expect.objectContaining({ goal: 'Investigate the failed run' }));
    expect(() =>
      globalCopilotWorkingMemorySchema.parse({
        goal: '',
        constraints: [],
        decisions: [],
        followUps: [],
        rawToolPayload: 'secret'
      })
    ).toThrow();
  });

  it('places the database in the workspace MCPLab data directory', () => {
    expect(globalCopilotMemoryDatabasePath('/workspace')).toBe(
      '/workspace/mcplab/.mastra/global-copilot.db'
    );
  });

  it('persists, renames, lists, and deletes workspace threads with LibSQL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcplab-copilot-memory-'));
    temporaryDirectories.push(directory);
    const runtime = await createGlobalCopilotMemoryRuntime({
      databasePath: join(directory, 'copilot.db')
    });
    const threads = new GlobalCopilotThreadService(runtime.memory, 'workspace-1', 100);

    const created = await threads.create({ id: 'thread-1', title: 'First conversation' });
    expect((await threads.list()).map((thread) => thread.id)).toEqual(['thread-1']);

    const renamed = await threads.rename(created.id, 'Renamed conversation');
    expect(renamed.title).toBe('Renamed conversation');

    await runtime.close();

    const restarted = await createGlobalCopilotMemoryRuntime({
      databasePath: join(directory, 'copilot.db')
    });
    const restartedThreads = new GlobalCopilotThreadService(
      restarted.memory,
      'workspace-1',
      100
    );
    expect((await restartedThreads.get(created.id)).title).toBe('Renamed conversation');
    await restartedThreads.delete(created.id);
    expect(await restartedThreads.list()).toEqual([]);
    await restarted.close();
  });

  it('prunes the oldest workspace threads above the app-owned cap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcplab-copilot-memory-'));
    temporaryDirectories.push(directory);
    const runtime = await createGlobalCopilotMemoryRuntime({
      databasePath: join(directory, 'copilot.db')
    });
    const threads = new GlobalCopilotThreadService(runtime.memory, 'workspace-1', 2);

    await threads.create({ id: 'thread-1' });
    await threads.create({ id: 'thread-2' });
    await threads.create({ id: 'thread-3' });

    const retainedIds = (await threads.list()).map((thread) => thread.id);
    expect(retainedIds).toHaveLength(2);
    expect(retainedIds).toContain('thread-3');
    await runtime.close();
  });
});
