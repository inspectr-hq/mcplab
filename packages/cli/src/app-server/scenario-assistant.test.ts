import { describe, it, expect, vi } from 'vitest';
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
}) {
  const captured: Array<{ status: number; body: unknown }> = [];
  const preloadAssistantTools =
    options?.preloadAssistantTools ?? vi.fn().mockResolvedValue(undefined);
  const servers = options?.servers ?? {
    'server-1': { transport: 'http', url: 'https://example.com/mcp' }
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
      continueAssistantTurn: vi.fn(),
      executeAssistantToolCall: vi.fn(),
      summarizeToolResultForAssistant: vi.fn()
    },
    captured,
    preloadAssistantTools
  };
}

async function callCreateSessionRoute(params?: {
  body?: unknown;
  servers?: Record<string, any>;
  preloadAssistantTools?: ReturnType<typeof vi.fn>;
  oauthSessionManager?: { getAuthHeadersForServers: ReturnType<typeof vi.fn> };
}) {
  const { deps, captured, preloadAssistantTools } = makeDeps({
    body: params?.body,
    servers: params?.servers,
    preloadAssistantTools: params?.preloadAssistantTools
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
    oauthSessionManager
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
