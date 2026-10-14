import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AssistantSessionsMap } from './app-context.js';
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';
import { OAuthAuthorizationRequiredError } from './oauth-session-manager.js';

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
      assistantSessionView: vi.fn((session: any) => ({
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
  oauthSessionManager?: { getAuthHeadersForServers: ReturnType<typeof vi.fn> };
}) {
  const { deps, captured, preloadAssistantTools, runtime } = makeDeps({
    body: params?.body,
    servers: params?.servers,
    preloadAssistantTools: params?.preloadAssistantTools,
    assistantRuntimeFactory: params?.assistantRuntimeFactory
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

describe('Scenario Assistant runtime factory', () => {
  it('uses an opaque runtime for route create, send, decision, view, and close', async () => {
    const snapshot = { messages: [], pendingToolCalls: [{ id: 'opaque-1', name: 'write', arguments: {}, status: 'pending' }] };
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
    expect(runtime.resolveToolCalls).toHaveBeenCalledWith([
      { toolCallId: 'opaque-1', decision: 'approve' }
    ], expect.any(AbortSignal));

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
        preloadAssistantTools: vi.fn(),
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
