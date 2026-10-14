import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AssistantSessionsMap } from './app-context.js';
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';
import { OAuthAuthorizationRequiredError } from './oauth-session-manager.js';
import { McpClientManager } from '@inspectr/mcplab-core';
import { assistantSessionView } from './scenario-assistant-domain.js';
import { createStatefulAssistantRuntimeHarness } from '../../test-support/stateful-assistant-runtime.js';

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    scenarioId: 'scenario-1',
    selectedAssistantAgentName: 'assistant-1',
    context: {
      scenario: {
        id: 'scenario-1',
        name: 'Scenario',
        prompt: 'Prompt',
        serverNames: ['server-1'],
        evalRules: [],
        extractRules: []
      }
    },
    ...overrides
  };
}

function makeDeps(options?: {
  body?: unknown;
  servers?: Record<string, any>;
  preloadAssistantTools?: ReturnType<typeof vi.fn>;
  assistantRuntimeFactory?: { create: ReturnType<typeof vi.fn> };
  assistantSessionView?: (session: any) => unknown;
}) {
  const captured: Array<{ status: number; body: unknown }> = [];
  const preloadAssistantTools =
    options?.preloadAssistantTools ?? vi.fn().mockResolvedValue(undefined);
  const servers = options?.servers ?? {
    'server-1': { transport: 'http', url: 'https://example.com/mcp' }
  };
  const runtime = {
    sendMessage: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'fake response' }),
    resolveToolCalls: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'resolved' }),
    getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
    dispose: vi.fn()
  };
  const assistantRuntimeFactory = options?.assistantRuntimeFactory ?? {
    create: vi.fn().mockResolvedValue(runtime)
  };

  return {
    deps: {
      parseBody: vi.fn().mockResolvedValue(options?.body ?? makeBody()),
      asJson: vi.fn((_res: any, status: number, body: unknown) => {
        captured.push({ status, body });
      }),
      cleanupAssistantSessions: vi.fn(),
      touchAssistantSession: vi.fn(),
      assistantSessionView:
        options?.assistantSessionView ??
        vi.fn((session: any) => ({
          id: session.id,
          warnings: session.warnings ?? []
        })),
      ensureInsideRoot: vi.fn((_root: string, p: string) => p),
      readLibraries: vi.fn().mockReturnValue({
        servers,
        agents: {
          'assistant-1': { id: 'assistant-1', provider: 'openai', model: 'gpt-4o-mini' }
        },
        scenarios: []
      }),
      pickDefaultAssistantAgentName: vi.fn().mockReturnValue('assistant-1'),
      resolveAssistantAgentFromConfig: vi.fn(),
      resolveAssistantAgentFromLibraries: vi
        .fn()
        .mockReturnValue({ id: 'assistant-1', provider: 'openai', model: 'gpt-4o-mini' }),
      preloadAssistantTools,
      assistantRuntimeFactory
    },
    captured,
    preloadAssistantTools,
    assistantRuntimeFactory,
    runtime
  };
}

async function callCreateSessionRoute(params?: {
  body?: unknown;
  servers?: Record<string, any>;
  preloadAssistantTools?: ReturnType<typeof vi.fn>;
  assistantRuntimeFactory?: { create: ReturnType<typeof vi.fn> };
  assistantSessionView?: (session: any) => unknown;
  oauthSessionManager?: { getAuthHeadersForServers: ReturnType<typeof vi.fn> };
}) {
  const { deps, captured, preloadAssistantTools, runtime } = makeDeps({
    body: params?.body,
    servers: params?.servers,
    preloadAssistantTools: params?.preloadAssistantTools,
    assistantRuntimeFactory: params?.assistantRuntimeFactory,
    assistantSessionView: params?.assistantSessionView
  });
  const assistantSessions: AssistantSessionsMap = new Map();
  const oauthSessionManager =
    params?.oauthSessionManager ??
    ({ getAuthHeadersForServers: vi.fn().mockResolvedValue({}) } as any);

  const handled = await handleScenarioAssistantRoutes({
    req: { headers: { host: 'localhost:8787' } } as any,
    res: {} as any,
    pathname: '/api/scenario-assistant/sessions',
    method: 'POST',
    settings: {
      evalsDir: '/tmp/evals',
      librariesDir: '/tmp/libraries',
      scenarioAssistantAgentName: 'assistant-1'
    } as any,
    assistantSessions,
    oauthSessionManager: oauthSessionManager as any,
    deps: deps as any
  });

  return {
    handled,
    response: captured[0],
    preloadAssistantTools,
    assistantSessions,
    oauthSessionManager,
    deps,
    assistantRuntimeFactory: deps.assistantRuntimeFactory,
    runtime
  };
}

describe('POST /api/scenario-assistant/sessions OAuth manager handling', () => {
  it('creates session for non-OAuth servers without auth headers', async () => {
    const { handled, response, preloadAssistantTools, oauthSessionManager } =
      await callCreateSessionRoute({
        body: makeBody({
          context: {
            scenario: {
              id: 'scenario-1',
              name: 'Scenario',
              prompt: 'Prompt',
              serverNames: ['server-1'],
              evalRules: [],
              extractRules: []
            }
          }
        }),
        servers: {
          'server-1': { transport: 'http', url: 'https://example.com/mcp' }
        }
      });

    expect(handled).toBe(true);
    expect(response.status).toBe(201);
    expect(oauthSessionManager.getAuthHeadersForServers).not.toHaveBeenCalled();
    expect(preloadAssistantTools).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      ['server-1'],
      { serverAuthHeaders: undefined }
    );
  });

  it('injects OAuth headers for oauth_authorization_code server', async () => {
    const oauthSessionManager = {
      getAuthHeadersForServers: vi
        .fn()
        .mockResolvedValue({ 'oauth-server': { authorization: 'Bearer tok-123' } })
    };

    const { response, preloadAssistantTools } = await callCreateSessionRoute({
      body: makeBody({
        context: {
          scenario: {
            id: 'scenario-1',
            name: 'Scenario',
            prompt: 'Prompt',
            serverNames: ['oauth-server'],
            evalRules: [],
            extractRules: []
          }
        }
      }),
      servers: {
        'oauth-server': {
          transport: 'http',
          url: 'https://example.com/mcp',
          auth: { type: 'oauth_authorization_code' }
        }
      },
      oauthSessionManager: oauthSessionManager as any
    });

    expect(response.status).toBe(201);
    expect(preloadAssistantTools).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      ['oauth-server'],
      { serverAuthHeaders: { 'oauth-server': { authorization: 'Bearer tok-123' } } }
    );
  });

  it('returns 401 when OAuth authorization is required', async () => {
    const oauthSessionManager = {
      getAuthHeadersForServers: vi.fn().mockRejectedValue(
        new OAuthAuthorizationRequiredError([
          {
            serverName: 'oauth-server',
            runtimeSessionId: 'oauthrt-1',
            authorizeLaunchUrl:
              'http://localhost:8787/api/oauth-runtime/sessions/oauthrt-1/authorize',
            message: "OAuth login required for server 'oauth-server'."
          }
        ])
      )
    };

    const { response, preloadAssistantTools } = await callCreateSessionRoute({
      body: makeBody({
        context: {
          scenario: {
            id: 'scenario-1',
            name: 'Scenario',
            prompt: 'Prompt',
            serverNames: ['oauth-server'],
            evalRules: [],
            extractRules: []
          }
        }
      }),
      servers: {
        'oauth-server': {
          transport: 'http',
          url: 'https://example.com/mcp',
          auth: { type: 'oauth_authorization_code' }
        }
      },
      oauthSessionManager: oauthSessionManager as any
    });

    expect(response.status).toBe(401);
    expect((response.body as any).error).toMatch(/OAuth login required/i);
    expect((response.body as any).oauth.required[0].serverName).toBe('oauth-server');
    expect(preloadAssistantTools).not.toHaveBeenCalled();
  });
});

describe('Scenario Assistant stateful alternative runtime acceptance', () => {
  it('keeps edits, partial decisions, final denial, memory, SSE snapshots, and cleanup coherent', async () => {
    const runtimeHarness = createStatefulAssistantRuntimeHarness();
    const assistantRuntimeFactory = {
      create: vi.fn((definition: any) => runtimeHarness.factory.create(definition))
    };
    const { deps, assistantSessions } = await callCreateSessionRoute({
      assistantRuntimeFactory,
      assistantSessionView
    });
    const sessionId = Array.from(assistantSessions.keys())[0]!;
    const responses: Array<{ status: number; body: any }> = [];
    deps.asJson = vi.fn((_res: any, status: number, body: any) => responses.push({ status, body }));
    const session = assistantSessions.get(sessionId)!;
    const route = async (pathname: string, method: string, body?: unknown, res: any = {}) => {
      deps.parseBody = vi.fn().mockResolvedValue(body ?? {});
      return handleScenarioAssistantRoutes({
        req: { headers: {} } as any,
        res,
        pathname,
        method,
        settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libraries' } as any,
        assistantSessions,
        oauthSessionManager: { getAuthHeadersForServers: vi.fn().mockResolvedValue({}) } as any,
        deps: deps as any
      });
    };
    const eventsRes = Object.assign(new EventEmitter(), {
      statusCode: 0,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn()
    });
    await route(
      `/api/scenario-assistant/sessions/${sessionId}/events`,
      'GET',
      undefined,
      eventsRes
    );

    await route(
      `/api/scenario-assistant/sessions/${sessionId}/messages`,
      'POST',
      { message: 'Plan' },
      Object.assign(new EventEmitter(), { writableEnded: false })
    );
    const first = session.runtime!.getSnapshot().pendingToolCalls[0]!;
    const second = session.runtime!.getSnapshot().pendingToolCalls[1]!;
    expect([first.id, second.id]).toEqual(['fake-call-1', 'fake-call-2']);
    expect(session.runtime!.getSnapshot().messages.at(-1)).toMatchObject({
      role: 'assistant',
      pendingToolCallId: first.id,
      pendingToolCallIds: [first.id, second.id]
    });

    await route(
      `/api/scenario-assistant/sessions/${sessionId}/tool-calls/${first.id}/approve`,
      'POST',
      {
        argumentsOverride: { value: 'edited-value' }
      }
    );
    expect(responses.at(-1)?.body.response.type).toBe('tool_call_resolved');
    await route(`/api/scenario-assistant/sessions/${sessionId}`, 'GET');
    expect(responses.at(-1)?.body.session.pendingToolCalls).toMatchObject([
      { id: first.id, status: 'approved', arguments: { value: 'edited-value' } },
      { id: second.id, status: 'pending' }
    ]);
    const emittedEvents = eventsRes.write.mock.calls
      .flat()
      .join('')
      .match(/data: (.+)\n/g)
      ?.map((line: string) => JSON.parse(line.slice('data: '.length)));
    expect(
      emittedEvents?.find((event: any) => event.type === 'tool_call_resolved')?.payload.session
    ).toMatchObject({
      pendingToolCalls: [
        { id: first.id, status: 'approved', arguments: { value: 'edited-value' } },
        { id: second.id, status: 'pending' }
      ],
      messages: expect.arrayContaining([
        expect.objectContaining({ pendingToolCallIds: [first.id, second.id] })
      ])
    });

    await route(
      `/api/scenario-assistant/sessions/${sessionId}/tool-calls/${first.id}/approve`,
      'POST'
    );
    expect(responses.at(-1)?.status).toBe(409);
    await route(
      `/api/scenario-assistant/sessions/${sessionId}/tool-calls/${second.id}/deny`,
      'POST'
    );
    expect(responses.at(-1)?.body.response.text).toContain('second call denied');
    await route(
      `/api/scenario-assistant/sessions/${sessionId}/messages`,
      'POST',
      { message: 'Continue' },
      Object.assign(new EventEmitter(), { writableEnded: false })
    );
    expect(responses.at(-1)?.body.response.text).toContain('Remembered edited-value');
    await route(`/api/scenario-assistant/sessions/${sessionId}`, 'DELETE');
    await route(`/api/scenario-assistant/sessions/${sessionId}`, 'DELETE');
    expect(eventsRes.end).toHaveBeenCalledOnce();
    expect(assistantSessions.has(sessionId)).toBe(false);
    expect(runtimeHarness.disposedSessions).toEqual(['scenario']);
  });
});

describe('Scenario Assistant runtime factory', () => {
  it('disposes MCP resources when runtime factory initialization fails', async () => {
    const disconnect = vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    try {
      const { assistantSessions } = await callCreateSessionRoute({
        assistantRuntimeFactory: { create: vi.fn().mockRejectedValue(new Error('factory failed')) }
      }).catch((error) => {
        expect(error).toMatchObject({ message: 'factory failed' });
        return { assistantSessions: new Map() };
      });
      expect(assistantSessions.size).toBe(0);
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      disconnect.mockRestore();
    }
  });

  it('approves pending calls in model order through approve-all', async () => {
    const { assistantSessions, deps, runtime } = await callCreateSessionRoute();
    const sessionId = Array.from(assistantSessions.keys())[0];
    runtime.getSnapshot.mockReturnValue({
      messages: [],
      pendingToolCalls: [
        { id: 'first', status: 'pending' },
        { id: 'second', status: 'pending' }
      ]
    });
    await handleScenarioAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/scenario-assistant/sessions/${sessionId}/tool-calls/approve-all`,
      method: 'POST',
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libraries' } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: deps as any
    });
    expect(runtime.resolveToolCalls).toHaveBeenCalledWith(
      [
        { toolCallId: 'first', decision: 'approve' },
        { toolCallId: 'second', decision: 'approve' }
      ],
      expect.any(AbortSignal)
    );
  });

  it('uses an opaque runtime for route create, send, decision, view, and close', async () => {
    const snapshot = {
      messages: [],
      pendingToolCalls: [{ id: 'opaque-1', name: 'write', arguments: {}, status: 'pending' }]
    };
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'fake response' }),
      resolveToolCalls: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'resolved' }),
      getSnapshot: vi.fn(() => snapshot),
      dispose: vi.fn()
    };
    const assistantRuntimeFactory = { create: vi.fn().mockResolvedValue(runtime) };
    const { deps, assistantSessions } = await callCreateSessionRoute({ assistantRuntimeFactory });
    const sessionId = Array.from(assistantSessions.keys())[0];
    deps.parseBody.mockResolvedValueOnce({ message: 'hello runtime' });
    const res = new EventEmitter() as any;

    await handleScenarioAssistantRoutes({
      req: Object.assign(new EventEmitter(), { complete: true, headers: {} }) as any,
      res,
      pathname: `/api/scenario-assistant/sessions/${sessionId}/messages`,
      method: 'POST',
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libraries' } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: deps as any
    });

    expect(assistantRuntimeFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({ assistant: 'scenario', context: expect.any(Object) })
    );
    expect(assistantRuntimeFactory.create.mock.calls[0][0]).not.toHaveProperty('mcp');
    expect(assistantRuntimeFactory.create.mock.calls[0][0]).not.toHaveProperty('llmMessages');
    expect(runtime.sendMessage).toHaveBeenCalledWith('hello runtime', expect.any(AbortSignal));

    deps.parseBody.mockResolvedValueOnce({});
    await handleScenarioAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/scenario-assistant/sessions/${sessionId}/tool-calls/opaque-1/approve`,
      method: 'POST',
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libraries' } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: deps as any
    });
    expect(runtime.resolveToolCalls).toHaveBeenCalledWith(
      [{ toolCallId: 'opaque-1', decision: 'approve' }],
      expect.any(AbortSignal)
    );

    await handleScenarioAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/scenario-assistant/sessions/${sessionId}`,
      method: 'GET',
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libraries' } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: deps as any
    });
    expect(runtime.getSnapshot).toHaveBeenCalled();
    await handleScenarioAssistantRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/scenario-assistant/sessions/${sessionId}`,
      method: 'DELETE',
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libraries' } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: deps as any
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});

describe('DELETE /api/scenario-assistant/sessions/:id', () => {
  it('clears the session and SSE clients when runtime disposal rejects', async () => {
    const dispose = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    const client = { write: vi.fn(), end: vi.fn() };
    const session = {
      id: 'sas-delete',
      events: [],
      clients: new Set([client]),
      runtime: { dispose }
    } as any;
    const sessions = new Map([[session.id, session]]);
    const responses: unknown[] = [];
    const deps = {
      cleanupAssistantSessions: vi.fn(),
      assistantSessionView: vi.fn().mockReturnValue({ id: session.id }),
      asJson: vi.fn((_res, status, body) => responses.push({ status, body }))
    } as any;
    const params = {
      req: { headers: {} } as any,
      res: {} as any,
      pathname: `/api/scenario-assistant/sessions/${session.id}`,
      method: 'DELETE',
      settings: {} as any,
      assistantSessions: sessions,
      oauthSessionManager: {} as any,
      deps
    };
    await handleScenarioAssistantRoutes(params);
    expect(responses).toEqual([{ status: 500, body: { error: 'cleanup failed' } }]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    expect(sessions.has(session.id)).toBe(false);
    await handleScenarioAssistantRoutes(params);
    expect(responses.at(-1)).toEqual({ status: 200, body: { ok: true } });
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('POST /api/scenario-assistant/sessions/:id/messages cancellation', () => {
  it('does not return a canceled turn response after the request closes', async () => {
    let resolveTurn!: (value: unknown) => void;
    const turnPromise = new Promise((resolve) => {
      resolveTurn = resolve;
    });
    const req = new EventEmitter() as any;
    req.headers = { host: 'localhost:8787' };
    const res = Object.assign(new EventEmitter(), { writableEnded: false }) as any;
    const asJson = vi.fn();
    const assistantSessions: AssistantSessionsMap = new Map([
      [
        'sas-1',
        {
          id: 'sas-1',
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          selectedAssistantAgentName: 'assistant-1',
          context: makeBody().context,
          agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
          toolsLoaded: 0,
          toolServers: [],
          initialMessages: [],
          runtime: {
            sendMessage: vi.fn().mockReturnValue(turnPromise),
            resolveToolCalls: vi.fn(),
            getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
            dispose: vi.fn()
          },
          warnings: [],
          events: [],
          clients: new Set()
        }
      ]
    ]) as any;

    const handled = handleScenarioAssistantRoutes({
      req,
      res,
      pathname: '/api/scenario-assistant/sessions/sas-1/messages',
      method: 'POST',
      settings: {
        evalsDir: '/tmp/evals',
        librariesDir: '/tmp/libraries',
        scenarioAssistantAgentName: 'assistant-1'
      } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: {
        parseBody: vi.fn().mockResolvedValue({ message: 'hello' }),
        asJson,
        cleanupAssistantSessions: vi.fn(),
        touchAssistantSession: vi.fn(),
        assistantSessionView: vi.fn((session: any) => ({ id: session.id })),
        ensureInsideRoot: vi.fn((_root: string, p: string) => p),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromConfig: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn(),
        preloadAssistantTools: vi.fn()
      } as any
    });

    const handlerPromise = Promise.resolve(handled);
    res.emit('close');
    resolveTurn({
      response: {
        type: 'assistant_message',
        text: 'late response',
        suggestions: undefined
      }
    });

    await expect(handlerPromise).resolves.toBe(true);
    expect(asJson).not.toHaveBeenCalled();
    const session = assistantSessions.get('sas-1');
    expect(session?.runtime?.getSnapshot()).toMatchObject({ messages: [], pendingToolCalls: [] });
  });
});
