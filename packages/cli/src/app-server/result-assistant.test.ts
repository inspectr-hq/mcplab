import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { McpClientManager } from '@inspectr/mcplab-core';
import { handleResultAssistantRoutes } from './result-assistant.js';
import {
  setupResultAssistantSession,
  type ResultAssistantSession,
  type ResultAssistantSessionInitializer
} from './result-assistant-domain.js';
import { createScriptedRuntimeFactory } from '../../test-support/scripted-chat-model.js';
import { createStatefulAssistantRuntimeHarness } from '../../test-support/stateful-assistant-runtime.js';
import type { AssistantRuntimeDefinition } from './assistant-runtime-contract.js';

async function createResultDefinition(params: {
  tools: Array<{ name: string; inputSchema?: unknown }>;
  scope?: 'run' | 'all_runs';
  runId?: string | null;
  resultSummary?: any;
  referenceReportsForRun?: any[];
  refreshReports?: () => any[];
}) {
  let definition: any;
  const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
  const listTools = vi
    .spyOn(McpClientManager.prototype, 'listTools')
    .mockResolvedValue(params.tools as any);
  const session: ResultAssistantSessionInitializer = {
    id: 'ras-test',
    scope: params.scope ?? 'all_runs',
    runId: params.runId ?? null,
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
    selectedAssistantAgentName: 'assistant',
    model: 'test',
    provider: 'openai',
    toolsLoaded: 0,
    toolServers: [],
    initialMessages: [],

    clients: new Set()
  };
  try {
    await setupResultAssistantSession({
      session,
      agentConfig: { provider: 'openai', model: 'test' },
      resultSummary: params.resultSummary ?? null,
      referenceReportsForRun: params.referenceReportsForRun ?? [],
      mcpServerUrl: 'http://mcplab.test/mcp',
      refreshReports: params.refreshReports ?? (() => []),
      assistantRuntimeFactory: {
        create: async (value) => {
          definition = value;
          return {
            sendMessage: async () => ({ type: 'assistant_message', text: '' }),
            resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
            cancel: vi.fn().mockResolvedValue(undefined),
            getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
            isBusy: () => false,
            dispose: async () => {}
          };
        }
      },
      onEvent: () => {},
      onActivity: () => {}
    });
    return { definition, session, connectAll, listTools };
  } finally {
    connectAll.mockRestore();
    listTools.mockRestore();
  }
}

it('publishes factory-time Result events with a finalized runtime session', async () => {
  vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
  vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([]);
  const observed: Array<{ type: string; session: ResultAssistantSession }> = [];
  const initializer: ResultAssistantSessionInitializer = {
    id: 'ras-startup',
    scope: 'all_runs',
    runId: null,
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
    selectedAssistantAgentName: 'assistant',
    model: 'test',
    provider: 'openai',
    toolsLoaded: 0,
    toolServers: [],
    initialMessages: [],

    clients: new Set()
  };
  let emitLateEvent: NonNullable<AssistantRuntimeDefinition['onEvent']> | undefined;
  try {
    const session = await setupResultAssistantSession({
      session: initializer,
      agentConfig: { provider: 'openai', model: 'test' },
      resultSummary: null,
      referenceReportsForRun: [],
      mcpServerUrl: 'http://mcplab.test/mcp',
      refreshReports: () => [],
      assistantRuntimeFactory: {
        create: async (definition) => {
          emitLateEvent = definition.onEvent;
          definition.onEvent?.({
            type: 'session_warning',
            ts: new Date().toISOString(),
            payload: { warning: 'startup' }
          });
          return {
            sendMessage: async () => ({ type: 'assistant_message', text: '' }),
            resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
            cancel: vi.fn().mockResolvedValue(undefined),
            getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
            isBusy: () => false,
            dispose: async () => {}
          };
        }
      },
      onEvent: (event, readySession) => {
        observed.push({ type: event.type, session: readySession });
      },
      onActivity: () => {}
    });
    expect(session).toBe(initializer);
    expect(observed).toEqual([{ type: 'session_warning', session }]);
    emitLateEvent?.({
      type: 'session_warning',
      ts: new Date().toISOString(),
      payload: { warning: 'later' }
    });
    expect(observed).toEqual([
      { type: 'session_warning', session },
      { type: 'session_warning', session }
    ]);
    expect(session.runtime.getSnapshot()).toEqual({
      revision: 0,
      messages: [],
      pendingToolCalls: []
    });
  } finally {
    vi.restoreAllMocks();
  }
});

it('publishes preload warnings before factory-time Result events', async () => {
  vi.spyOn(McpClientManager.prototype, 'connectAll').mockRejectedValue(new Error('offline'));
  const observed: Array<{ type: string; warning?: unknown }> = [];
  const session: ResultAssistantSessionInitializer = {
    id: 'ras-preload-warning',
    scope: 'all_runs',
    runId: null,
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
    selectedAssistantAgentName: 'assistant',
    model: 'test',
    provider: 'openai',
    toolsLoaded: 0,
    toolServers: [],
    initialMessages: [],

    clients: new Set()
  };
  try {
    await setupResultAssistantSession({
      session,
      agentConfig: { provider: 'openai', model: 'test' },
      resultSummary: null,
      referenceReportsForRun: [],
      mcpServerUrl: 'http://mcplab.test/mcp',
      refreshReports: () => [],
      assistantRuntimeFactory: {
        create: async (definition) => {
          definition.onEvent?.({
            type: 'session_warning',
            ts: new Date().toISOString(),
            payload: { warning: 'factory startup' }
          });
          return {
            sendMessage: async () => ({ type: 'assistant_message', text: '' }),
            resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
            cancel: vi.fn().mockResolvedValue(undefined),
            getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
            isBusy: () => false,
            dispose: async () => {}
          };
        }
      },
      onEvent: (event) => observed.push({ type: event.type, warning: event.payload.warning }),
      onActivity: () => {}
    });
    expect(session.initialMessages).toHaveLength(1);
    expect(session.initialMessages[0]?.text).toContain(
      'could not preload MCPLab MCP tools: offline'
    );
    expect(observed).toEqual([
      { type: 'session_warning', warning: 'offline' },
      { type: 'session_warning', warning: 'factory startup' }
    ]);
  } finally {
    vi.restoreAllMocks();
  }
});

it('disposes the Result runtime and MCP client when a startup observer throws', async () => {
  vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
  vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([]);
  const disconnectAll = vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
  const runtimeDispose = vi.fn();
  try {
    await expect(
      setupResultAssistantSession({
        session: {
          id: 'ras-observer-failure',
          scope: 'all_runs',
          runId: null,
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          selectedAssistantAgentName: 'assistant',
          model: 'test',
          provider: 'openai',
          toolsLoaded: 0,
          toolServers: [],
          initialMessages: [],

          clients: new Set()
        },
        agentConfig: { provider: 'openai', model: 'test' },
        resultSummary: null,
        referenceReportsForRun: [],
        mcpServerUrl: 'http://mcplab.test/mcp',
        refreshReports: () => [],
        assistantRuntimeFactory: {
          create: async (definition) => {
            definition.onEvent?.({
              type: 'session_warning',
              ts: new Date().toISOString(),
              payload: { warning: 'startup' }
            });
            return {
              sendMessage: async () => ({ type: 'assistant_message', text: '' }),
              resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
              cancel: vi.fn().mockResolvedValue(undefined),
              getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
              isBusy: () => false,
              dispose: runtimeDispose
            };
          }
        },
        onEvent: () => {
          throw new Error('observer failed');
        },
        onActivity: () => {}
      })
    ).rejects.toThrow('observer failed');
    expect(runtimeDispose).toHaveBeenCalledOnce();
    expect(disconnectAll).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
  }
});

describe('GET /api/result-assistant/sessions/:id/events', () => {
  it('streams a current snapshot instead of replaying stale events', async () => {
    const writes: string[] = [];
    const ends: number[] = [];
    const resultAssistantSessions = new Map([
      [
        'ras-1',
        {
          id: 'ras-1',
          createdAt: 0,
          lastTouchedAt: Date.now(),
          runtime: { getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }) },
          clients: new Set()
        }
      ]
    ]) as any;

    const handled = await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {
        statusCode: 0,
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: (chunk: string) => writes.push(chunk),
        end: () => ends.push(1)
      } as any,
      pathname: '/api/result-assistant/sessions/ras-1/events',
      method: 'GET',
      settings: { workspaceRoot: '/tmp', runsDir: '/tmp/runs', librariesDir: '/tmp/libs' } as any,
      resultAssistantSessions,
      deps: {
        parseBody: vi.fn(),
        asJson: vi.fn(),
        getRunResults: vi.fn(),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn()
      } as any
    });

    expect(handled).toBe(true);
    expect(writes.join('')).toContain('event: session_snapshot');
    expect(writes.join('')).not.toContain('event: session_started');
    expect(writes.join('')).not.toContain('event: turn_started');
    expect(ends).toHaveLength(0);
    expect(resultAssistantSessions.get('ras-1')?.clients.size).toBe(1);
  });
});

describe('DELETE /api/result-assistant/sessions/:id', () => {
  it('clears the session and SSE clients when runtime disposal rejects', async () => {
    const dispose = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    const client = { write: vi.fn(), end: vi.fn() };
    const session = {
      id: 'ras-delete',
      scope: 'all_runs',
      runId: null,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      selectedAssistantAgentName: 'assistant',
      agentConfig: { provider: 'openai', model: 'fake' },
      toolsLoaded: 0,
      toolServers: [],
      initialMessages: [],

      clients: new Set([client]),
      runtime: {
        dispose,
        cancel: vi.fn().mockResolvedValue(undefined),
        getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] })
      }
    } as any;
    const sessions = new Map([[session.id, session]]);
    const responses: unknown[] = [];
    const params = {
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/result-assistant/sessions/${session.id}`,
      method: 'DELETE',
      settings: {} as any,
      resultAssistantSessions: sessions,
      deps: {
        asJson: vi.fn((_res, status, body) => responses.push({ status, body }))
      } as any
    };
    await handleResultAssistantRoutes(params);
    expect(responses).toEqual([{ status: 500, body: { error: 'cleanup failed' } }]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    expect(sessions.has(session.id)).toBe(false);
    await handleResultAssistantRoutes(params);
    expect(responses.at(-1)).toEqual({ status: 200, body: { ok: true } });
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('Result Assistant report refresh', () => {
  it('refreshes linked reports after a write tool completes', async () => {
    const reports = [
      {
        path: '/reports/new.md',
        relativePath: 'reports/new.md',
        name: 'new.md',
        sizeBytes: 4,
        mtime: 'now'
      }
    ];
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const callToolSpy = vi
      .spyOn(McpClientManager.prototype, 'callTool')
      .mockImplementation(async (...args: any[]) => callTool(...args));
    try {
      const { definition } = await createResultDefinition({
        scope: 'run',
        runId: 'run-1',
        tools: [{ name: 'mcplab_write_markdown_report' }],
        refreshReports: () => reports
      });
      expect(definition.getSystemPrompt()).not.toContain('reports/new.md');
      await definition.tools[0].execute({ title: 'Summary' });
      expect(callTool).toHaveBeenCalledWith(
        'mcplab',
        'mcplab_write_markdown_report',
        { title: 'Summary' },
        { signal: undefined }
      );
      expect(definition.getSystemPrompt()).toContain('reports/new.md');
    } finally {
      callToolSpy.mockRestore();
    }
  });

  it('keeps refreshed reports private and exposes them to the next prompt', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'mcplab-result-assistant-'));
    const reportPath = join(workspaceRoot, 'mcplab/reports/run-1-summary.md');
    const callTool = vi
      .spyOn(McpClientManager.prototype, 'callTool')
      .mockImplementation(async () => {
        mkdirSync(join(workspaceRoot, 'mcplab/reports'), { recursive: true });
        writeFileSync(reportPath, '# Summary');
        return { ok: true };
      });
    const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    const listTools = vi
      .spyOn(McpClientManager.prototype, 'listTools')
      .mockResolvedValue([
        { name: 'mcplab_write_markdown_report', inputSchema: { type: 'object' } }
      ] as any);
    const sessions = new Map();
    const captured: Array<{ status: number; body: any }> = [];
    let definition: any;
    try {
      await handleResultAssistantRoutes({
        req: { headers: {} } as any,
        res: {} as any,
        pathname: '/api/result-assistant/sessions',
        method: 'POST',
        settings: {
          workspaceRoot,
          runsDir: join(workspaceRoot, 'runs'),
          librariesDir: join(workspaceRoot, 'libraries')
        } as any,
        resultAssistantSessions: sessions,
        deps: {
          parseBody: vi.fn().mockResolvedValue({ scope: 'run', runId: 'run-1' }),
          asJson: vi.fn((_res, status, body) => {
            captured.push({ status, body });
          }),
          getRunResults: vi.fn().mockReturnValue(null),
          readLibraries: vi.fn().mockReturnValue({ agents: { assistant: {} }, servers: {} }),
          pickDefaultAssistantAgentName: vi.fn().mockReturnValue('assistant'),
          resolveAssistantAgentFromLibraries: vi
            .fn()
            .mockReturnValue({ provider: 'openai', model: 'test' }),
          assistantRuntimeFactory: {
            create: async (runtimeDefinition: any) => {
              definition = runtimeDefinition;
              return {
                sendMessage: vi.fn(),
                resolveToolCalls: vi.fn(),
                cancel: vi.fn().mockResolvedValue(undefined),
                getSnapshot: vi
                  .fn()
                  .mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
                dispose: vi.fn()
              };
            }
          }
        } as any
      });

      const sessionId = captured[0]!.body.sessionId;
      const session = sessions.get(sessionId)!;
      for (const key of [
        'mcp',
        'tools',
        'toolPublicMap',
        'systemPromptCache',
        'agentConfig',
        'resultSummary',
        'referenceReportsForRun'
      ]) {
        expect(session).not.toHaveProperty(key);
      }
      expect(definition.getSystemPrompt()).not.toContain('run-1-summary.md');
      await definition.tools[0].execute({ title: 'Summary' });
      expect(definition.getSystemPrompt()).toContain('run-1-summary.md');
      expect(callTool).toHaveBeenCalledOnce();
    } finally {
      connectAll.mockRestore();
      listTools.mockRestore();
      callTool.mockRestore();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('Result Assistant discovered tool approvals', () => {
  it('automatically runs discovered reads and pauses only the write in a mixed batch', async () => {
    const listTools = vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([
      { name: 'mcplab_read_run_artifact', inputSchema: { type: 'object' } },
      { name: 'mcplab_trace_stats', inputSchema: { type: 'object' } },
      { name: 'mcplab_write_markdown_report', inputSchema: { type: 'object' } }
    ]);
    const callTool = vi
      .spyOn(McpClientManager.prototype, 'callTool')
      .mockImplementation(async (_server, tool) => ({ tool }));
    const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    const toolDefinitions = [
      {
        name: 'mcplab_read_run_artifact',
        arguments: { run_id: 'run-1', artifact_path: 'results.json' }
      },
      { name: 'mcplab_trace_stats', arguments: { run_id: 'run-1' } }
    ];
    let modelRound = 0;
    const histories: any[][] = [];
    try {
      const session: ResultAssistantSessionInitializer = {
        id: 'ras-test',
        scope: 'all_runs',
        runId: null,
        createdAt: Date.now(),
        lastTouchedAt: Date.now(),
        selectedAssistantAgentName: 'assistant',
        model: 'test',
        provider: 'openai',
        toolsLoaded: 0,
        toolServers: [],
        initialMessages: [],

        clients: new Set()
      };
      let definition!: AssistantRuntimeDefinition;
      await setupResultAssistantSession({
        session,
        agentConfig: { provider: 'openai', model: 'fake' },
        resultSummary: null,
        referenceReportsForRun: [],
        mcpServerUrl: 'http://mcplab.test/mcp',
        refreshReports: () => [],
        assistantRuntimeFactory: {
          create: async (value) => {
            definition = value;
            return {
              sendMessage: async () => ({ type: 'assistant_message', text: '' }),
              resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
              cancel: vi.fn().mockResolvedValue(undefined),
              getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
              isBusy: () => false,
              dispose: async () => {}
            };
          }
        },
        onEvent: () => {},
        onActivity: () => {}
      });
      expect(connectAll).toHaveBeenCalledOnce();
      expect(listTools).toHaveBeenCalledWith('mcplab');

      const publicReadNames = definition.tools
        .filter((tool) => tool.tool !== 'mcplab_write_markdown_report')
        .map((tool) => tool.name);
      const readNames = toolDefinitions.map((tool) =>
        publicReadNames.find(
          (name) => definition.tools.find((entry) => entry.name === name)?.tool === tool.name
        )!
      );
      const writeName = definition.tools.find(
        (tool) => tool.tool === 'mcplab_write_markdown_report'
      )!.name;
      expect(readNames).toEqual(['mcplab__mcplab_read_run_artifact', 'mcplab__mcplab_trace_stats']);
      expect(definition.approvalPolicy(readNames[0]!)).toBe('automatic');
      expect(definition.approvalPolicy(readNames[1]!)).toBe('automatic');
      expect(definition.approvalPolicy(writeName)).toBe('approval_required');
      expect(definition.approvalPolicy('unknown_tool')).toBe('approval_required');
      expect(definition.approvalPolicy('mcplab_trace_stats')).toBe('approval_required');

      const runtime = await createScriptedRuntimeFactory(async (_definition, messages) => {
        histories.push([...messages]);
        modelRound += 1;
        if (modelRound === 1) {
          return {
            type: 'tool_call_request',
            text: '',
            toolCalls: toolDefinitions.map((tool, index) => ({
              id: `read-${index + 1}`,
              name: readNames[index]!,
              arguments: tool.arguments
            }))
          };
        }
        if (modelRound === 2) return { type: 'assistant_message', text: 'Read results.' };
        return {
          type: 'tool_call_request',
          text: '',
          toolCalls: [
            { id: 'mixed-read', name: readNames[0]!, arguments: {} },
            { id: 'mixed-write', name: writeName, arguments: { title: 'Report' } }
          ]
        };
      }).create(definition);

      await expect(
        runtime.sendMessage('What is the result of the last eval?')
      ).resolves.toMatchObject({
        type: 'assistant_message',
        text: 'Read results.'
      });
      expect(callTool).toHaveBeenCalledTimes(2);
      expect(runtime.getSnapshot().pendingToolCalls.map((call) => call.status)).toEqual([
        'approved',
        'approved'
      ]);
      expect(histories[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'tool', tool_call_id: 'read-1' }),
          expect.objectContaining({ type: 'tool', tool_call_id: 'read-2' })
        ])
      );
      expect(
        histories[1].find((message) => message.tool_calls)?.tool_calls.map((call: any) => call.id)
      ).toEqual(['read-1', 'read-2']);

      const mixed = await runtime.sendMessage('Read the artifact and write a report');
      expect(mixed.type).toBe('tool_call_request');
      expect(callTool).toHaveBeenCalledTimes(3);
      expect(runtime.getSnapshot().pendingToolCalls.slice(-2)).toMatchObject([
        { id: 'mixed-read', status: 'approved' },
        { id: 'mixed-write', status: 'pending' }
      ]);
    } finally {
      connectAll.mockRestore();
      listTools.mockRestore();
      callTool.mockRestore();
    }
  });
});

it('runs the Result HTTP approval flow through a real LangGraph runtime and MCP callbacks', async () => {
  const callTool = vi
    .spyOn(McpClientManager.prototype, 'callTool')
    .mockImplementation(async (_server, tool, args) => ({ tool, args }));
  const publicRead = 'mcplab__mcplab_read_run_artifact';
  const publicWrite = 'mcplab__mcplab_write_markdown_report';
  let modelRound = 0;
  const captured: Array<{ status: number; body: any }> = [];
  const sessions = new Map();
  let body: any;
  const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
  const listTools = vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([
    { name: 'mcplab_read_run_artifact', inputSchema: { type: 'object' } },
    { name: 'mcplab_write_markdown_report', inputSchema: { type: 'object' } }
  ] as any);
  const deps = {
    parseBody: vi.fn(async () => body ?? {}),
    asJson: vi.fn((_res, status, value) => captured.push({ status, body: value })),
    getRunResults: vi.fn(),
    readLibraries: vi.fn().mockReturnValue({ agents: { assistant: {} }, servers: {} }),
    pickDefaultAssistantAgentName: vi.fn().mockReturnValue('assistant'),
    resolveAssistantAgentFromLibraries: vi
      .fn()
      .mockReturnValue({ provider: 'openai', model: 'test' }),
    assistantRuntimeFactory: {
      create: (definition: any) =>
        createScriptedRuntimeFactory(async (_def, messages) => {
          modelRound++;
          if (modelRound === 1)
            return {
              type: 'tool_call_request',
              text: 'Read the artifact and prepare a report',
              toolCalls: [
                { id: 'read-id', name: publicRead, arguments: { path: 'original' } },
                { id: 'write-id', name: publicWrite, arguments: { title: 'Draft' } }
              ]
            };
          expect(messages.slice(-2).map((message) => message.getType())).toEqual(['tool', 'tool']);
          return {
            type: 'assistant_message',
            text: 'The read succeeded, and I did not write the report.'
          };
        }).create(definition)
    }
  } as any;
  const settings = {
    workspaceRoot: '/tmp',
    runsDir: '/tmp/runs',
    librariesDir: '/tmp/libs'
  } as any;
  const route = (pathname: string, method: string, value?: unknown, res: any = {}) => {
    body = value;
    return handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res,
      pathname,
      method,
      settings,
      resultAssistantSessions: sessions,
      deps
    });
  };
  try {
    await route('/api/result-assistant/sessions', 'POST', { scope: 'all_runs' });
    const sessionId = captured.at(-1)!.body.sessionId;
    const session = sessions.get(sessionId)!;
    for (const key of [
      'mcp',
      'tools',
      'toolPublicMap',
      'systemPromptCache',
      'agentConfig',
      'resultSummary',
      'referenceReportsForRun'
    ]) {
      expect(session).not.toHaveProperty(key);
    }
    const sseChunks: string[] = [];
    const sse = Object.assign(new EventEmitter(), {
      statusCode: 0,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: (chunk: string) => sseChunks.push(chunk),
      end: vi.fn()
    });
    await route(`/api/result-assistant/sessions/${sessionId}/events`, 'GET', undefined, sse);

    await route(
      `/api/result-assistant/sessions/${sessionId}/messages`,
      'POST',
      { message: 'Read it' },
      new EventEmitter()
    );
    expect(captured.at(-1)).toMatchObject({
      status: 200,
      body: { response: { type: 'tool_call_request' } }
    });
    // The read-only artifact read runs automatically; only the report write waits for approval.
    expect(captured.at(-1)!.body.response.pendingToolCalls).toMatchObject([{ id: 'write-id' }]);
    const [read, write] = session.runtime.getSnapshot().pendingToolCalls;
    expect([read!.id, write!.id]).toEqual(['read-id', 'write-id']);
    expect(callTool).toHaveBeenCalledWith(
      'mcplab',
      'mcplab_read_run_artifact',
      { path: 'original' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    await route(`/api/result-assistant/sessions/${sessionId}`, 'GET');
    expect(captured.at(-1)).toMatchObject({
      status: 200,
      body: {
        session: {
          pendingToolCalls: [
            { id: 'read-id', status: 'approved', arguments: { path: 'original' } },
            { id: 'write-id', status: 'pending' }
          ]
        }
      }
    });
    await route(`/api/result-assistant/sessions/${sessionId}/tool-calls/${write!.id}/deny`, 'POST');
    expect(captured.at(-1)).toMatchObject({
      status: 200,
      body: {
        response: {
          type: 'assistant_message',
          text: 'The read succeeded, and I did not write the report.'
        }
      }
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(session.runtime.getSnapshot().pendingToolCalls).toMatchObject([
      { id: 'read-id', status: 'approved', arguments: { path: 'original' } },
      { id: 'write-id', status: 'denied' }
    ]);
    expect(sseChunks.join('')).toContain('event: tool_call_resolved');
    expect(sseChunks.join('')).toContain('event: tool_call_denied');
    expect(sseChunks.join('')).toContain('The read succeeded, and I did not write the report.');
  } finally {
    connectAll.mockRestore();
    listTools.mockRestore();
    callTool.mockRestore();
  }
});

describe('POST /api/result-assistant/sessions/:id/messages cancellation', () => {
  it('does not return a canceled turn response after the request closes', async () => {
    let resolveTurn!: (value: unknown) => void;
    const turnPromise = new Promise((resolve) => {
      resolveTurn = resolve;
    });
    const req = new EventEmitter() as any;
    req.headers = {};
    const res = Object.assign(new EventEmitter(), { writableEnded: false }) as any;
    const asJson = vi.fn();
    const resultAssistantSessions = new Map([
      [
        'ras-1',
        {
          id: 'ras-1',
          scope: 'run',
          runId: 'run-1',
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          selectedAssistantAgentName: 'assistant-1',
          toolsLoaded: 0,
          toolServers: [],
          initialMessages: [],
          runtime: {
            sendMessage: vi.fn().mockReturnValue(turnPromise),
            resolveToolCalls: vi.fn(),
            cancel: vi.fn().mockResolvedValue(undefined),
            getSnapshot: vi
              .fn()
              .mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
            dispose: vi.fn()
          },
          clients: new Set()
        }
      ]
    ]) as any;

    const handled = handleResultAssistantRoutes({
      req,
      res,
      pathname: '/api/result-assistant/sessions/ras-1/messages',
      method: 'POST',
      settings: { workspaceRoot: '/tmp', runsDir: '/tmp/runs', librariesDir: '/tmp/libs' } as any,
      resultAssistantSessions,
      deps: {
        parseBody: vi.fn().mockResolvedValue({ message: 'hello' }),
        asJson,
        getRunResults: vi.fn(),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn()
      } as any
    });

    const handlerPromise = Promise.resolve(handled);
    res.emit('close');
    resolveTurn({
      response: {
        type: 'assistant_message',
        text: 'late response'
      }
    });

    await expect(handlerPromise).resolves.toBe(true);
    expect(asJson).not.toHaveBeenCalled();
    const session = resultAssistantSessions.get('ras-1');
    expect(session?.runtime?.getSnapshot()).toMatchObject({
      revision: 0,
      messages: [],
      pendingToolCalls: []
    });
  });
});

describe('Result Assistant runtime factory', () => {
  it('runs a stateful alternative runtime through decisions, snapshots, SSE, memory, and cleanup', async () => {
    const runtimeHarness = createStatefulAssistantRuntimeHarness();
    let runtimeDefinition: any;
    const captured: Array<{ status: number; body: any }> = [];
    const resultAssistantSessions = new Map();
    const deps = {
      parseBody: vi.fn(),
      asJson: vi.fn((_res, status, body) => captured.push({ status, body })),
      getRunResults: vi.fn(),
      readLibraries: vi.fn().mockReturnValue({ agents: { assistant: {} }, servers: {} }),
      pickDefaultAssistantAgentName: vi.fn().mockReturnValue('assistant'),
      resolveAssistantAgentFromLibraries: vi
        .fn()
        .mockReturnValue({ provider: 'openai', model: 'fake' }),
      assistantRuntimeFactory: {
        create: (definition: any) => {
          runtimeDefinition = definition;
          return runtimeHarness.factory.create(definition);
        }
      }
    } as any;
    const settings = {
      workspaceRoot: '/tmp',
      runsDir: '/tmp/runs',
      librariesDir: '/tmp/libs'
    } as any;
    const route = async (pathname: string, method: string, body?: unknown, res: any = {}) => {
      deps.parseBody = vi.fn().mockResolvedValue(body ?? {});
      return handleResultAssistantRoutes({
        req: { headers: {} } as any,
        res,
        pathname,
        method,
        settings,
        resultAssistantSessions,
        deps
      });
    };

    await route('/api/result-assistant/sessions', 'POST', { scope: 'all_runs' });
    const sessionId = captured[0]!.body.sessionId;
    expect(runtimeDefinition.getSystemPrompt()).toContain('Read-only tools run immediately');
    expect(runtimeDefinition.getSystemPrompt()).not.toContain('request exactly one tool call');
    const session = resultAssistantSessions.get(sessionId)!;
    const streamWrites: string[] = [];
    const streamRes = Object.assign(new EventEmitter(), {
      statusCode: 0,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: (chunk: string) => streamWrites.push(chunk),
      end: vi.fn()
    });
    await route(`/api/result-assistant/sessions/${sessionId}/events`, 'GET', undefined, streamRes);
    await route(
      `/api/result-assistant/sessions/${sessionId}/messages`,
      'POST',
      { message: 'Plan' },
      Object.assign(new EventEmitter(), { writableEnded: false })
    );
    const [first, second] = session.runtime.getSnapshot().pendingToolCalls;
    expect(session.runtime.getSnapshot().messages.at(-1)).toMatchObject({
      role: 'assistant',
      pendingToolCallId: first!.id,
      pendingToolCallIds: [first!.id, second!.id]
    });

    await route(
      `/api/result-assistant/sessions/${sessionId}/tool-calls/${first!.id}/approve`,
      'POST',
      {
        argumentsOverride: { value: 'edited-value' }
      }
    );
    expect(captured.at(-1)?.body.response.type).toBe('tool_call_resolved');
    await route(`/api/result-assistant/sessions/${sessionId}`, 'GET');
    expect(captured.at(-1)?.body.session.pendingToolCalls).toMatchObject([
      { id: first!.id, status: 'approved', arguments: { value: 'edited-value' } },
      { id: second!.id, status: 'pending' }
    ]);
    const emittedEvents = streamWrites
      .join('')
      .match(/data: (.+)\n/g)
      ?.map((line) => JSON.parse(line.slice('data: '.length)));
    expect(
      emittedEvents?.find((event) => event.type === 'tool_call_resolved')?.payload.session
    ).toMatchObject({
      pendingToolCalls: [
        { id: first!.id, status: 'approved', arguments: { value: 'edited-value' } },
        { id: second!.id, status: 'pending' }
      ],
      messages: expect.arrayContaining([
        expect.objectContaining({ pendingToolCallIds: [first!.id, second!.id] })
      ])
    });
    await route(
      `/api/result-assistant/sessions/${sessionId}/tool-calls/${first!.id}/approve`,
      'POST',
      {
        argumentsOverride: { value: 'rejected-repeat' }
      }
    );
    expect(captured.at(-1)?.status).toBe(409);
    await route(`/api/result-assistant/sessions/${sessionId}`, 'GET');
    expect(captured.at(-1)?.body.session.pendingToolCalls).toMatchObject([
      { id: first!.id, status: 'approved', arguments: { value: 'edited-value' } },
      { id: second!.id, status: 'pending' }
    ]);
    await route(
      `/api/result-assistant/sessions/${sessionId}/tool-calls/${second!.id}/deny`,
      'POST'
    );
    expect(captured.at(-1)?.body.response.text).toContain('second call denied');
    await route(
      `/api/result-assistant/sessions/${sessionId}/messages`,
      'POST',
      { message: 'Continue' },
      Object.assign(new EventEmitter(), { writableEnded: false })
    );
    expect(captured.at(-1)?.body.response.text).toContain('Remembered edited-value');
    await route(`/api/result-assistant/sessions/${sessionId}`, 'DELETE');
    await route(`/api/result-assistant/sessions/${sessionId}`, 'DELETE');
    expect(streamRes.end).toHaveBeenCalledOnce();
    expect(resultAssistantSessions.has(sessionId)).toBe(false);
    expect(runtimeHarness.disposedSessions).toEqual(['result']);
  });

  it('uses an opaque runtime for route create, send, decision, view, and close', async () => {
    const captured: Array<{ status: number; body: any }> = [];
    const snapshot = {
      messages: [],
      pendingToolCalls: [{ id: 'opaque-1', name: 'report', arguments: {}, status: 'pending' }]
    };
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'fake result' }),
      resolveToolCalls: vi.fn().mockResolvedValue({
        type: 'tool_call_resolved',
        text: 'Approved one call.',
        pendingToolCalls: [
          {
            id: 'opaque-2',
            server: 'mcplab',
            tool: 'report',
            publicToolName: 'report',
            arguments: {},
            status: 'pending',
            createdAt: new Date().toISOString()
          }
        ]
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      dispose: vi.fn()
    };
    const assistantRuntimeFactory = { create: vi.fn().mockResolvedValue(runtime) };
    const resultAssistantSessions = new Map();
    const deps = {
      parseBody: vi
        .fn()
        .mockResolvedValueOnce({ scope: 'all_runs' })
        .mockResolvedValueOnce({ message: 'hello' })
        .mockResolvedValueOnce({}),
      asJson: vi.fn((_res, status, body) => captured.push({ status, body })),
      getRunResults: vi.fn(),
      readLibraries: vi.fn().mockReturnValue({ agents: { assistant: {} }, servers: {} }),
      pickDefaultAssistantAgentName: vi.fn().mockReturnValue('assistant'),
      resolveAssistantAgentFromLibraries: vi
        .fn()
        .mockReturnValue({ provider: 'openai', model: 'fake' }),
      assistantRuntimeFactory
    } as any;
    const settings = {
      workspaceRoot: '/tmp',
      runsDir: '/tmp/runs',
      librariesDir: '/tmp/libs'
    } as any;

    await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: '/api/result-assistant/sessions',
      method: 'POST',
      settings,
      resultAssistantSessions,
      deps
    });
    const sessionId = captured[0].body.sessionId;
    await handleResultAssistantRoutes({
      req: Object.assign(new EventEmitter(), { complete: true, headers: {} }) as any,
      res: Object.assign(new EventEmitter(), { writableEnded: false }) as any,
      pathname: `/api/result-assistant/sessions/${sessionId}/messages`,
      method: 'POST',
      settings,
      resultAssistantSessions,
      deps
    });

    expect(assistantRuntimeFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assistant: 'result',
        context: expect.objectContaining({ scope: 'all_runs' })
      })
    );
    expect(assistantRuntimeFactory.create.mock.calls[0][0]).not.toHaveProperty('mcp');
    expect(assistantRuntimeFactory.create.mock.calls[0][0]).not.toHaveProperty('llmMessages');
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      'hello',
      expect.any(AbortSignal),
      expect.any(String)
    );
    await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}/tool-calls/opaque-1/approve`,
      method: 'POST',
      settings,
      resultAssistantSessions,
      deps
    });
    expect(runtime.resolveToolCalls).toHaveBeenCalledWith(
      [{ toolCallId: 'opaque-1', decision: 'approve' }],
      expect.any(AbortSignal)
    );
    expect(captured[2].body.response).toMatchObject({
      type: 'tool_call_resolved',
      pendingToolCall: { id: 'opaque-2' },
      pendingToolCalls: [{ id: 'opaque-2' }]
    });
    runtime.getSnapshot.mockReturnValue({
      messages: [],
      pendingToolCalls: [{ id: 'opaque-1', status: 'approved' }]
    });
    await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}/tool-calls/opaque-1/approve`,
      method: 'POST',
      settings,
      resultAssistantSessions,
      deps
    });
    expect(captured.at(-1)?.status).toBe(409);
    expect(runtime.resolveToolCalls).toHaveBeenCalledOnce();
    await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}`,
      method: 'GET',
      settings,
      resultAssistantSessions,
      deps
    });
    expect(runtime.getSnapshot).toHaveBeenCalled();
    await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}`,
      method: 'DELETE',
      settings,
      resultAssistantSessions,
      deps
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
