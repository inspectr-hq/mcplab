import { describe, expect, it, vi } from 'vitest';
import { handleOAuthRuntimeRoutes } from './oauth-runtime-routes.js';
import type { OAuthRuntimeSession, OAuthRuntimeSessionsMap } from './oauth-runtime-domain.js';
import type { OAuthDebuggerSessionsMap } from './app-context.js';
import type { OAuthDebuggerSession } from './oauth-debugger-domain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRuntimeSession(overrides: Partial<OAuthRuntimeSession> = {}): OAuthRuntimeSession {
  return {
    id: 'oauthrt-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    serverName: 'my-server',
    oauthDebuggerSessionId: 'dbg-1',
    status: 'completed',
    ...overrides
  };
}

function makeDebuggerSession(overrides: Partial<OAuthDebuggerSession> = {}): OAuthDebuggerSession {
  return {
    id: 'dbg-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'completed',
    config: {
      profile: 'latest',
      target: { serverName: 'my-server' },
      registrationMethod: 'pre_registered',
      clientConfig: { preRegistered: { clientId: 'cid' } },
      runtime: { redirectMode: 'local_callback', usePkce: true, codeChallengeMethod: 'S256' },
      display: { showSensitiveValues: false }
    } as any,
    steps: [],
    validations: [],
    network: [],
    sequence: [],
    events: [],
    clients: new Set(),
    abortController: new AbortController(),
    context: {},
    ...overrides
  };
}

function makeDeps(bodyOverride?: unknown) {
  const captured: Array<{ status: number; body: unknown }> = [];
  return {
    parseBody: vi.fn().mockResolvedValue(bodyOverride ?? {}),
    asJson: vi.fn((_res: any, status: number, body: unknown) => {
      captured.push({ status, body });
    }),
    captured
  };
}

async function callRoute(params: {
  pathname: string;
  method?: string;
  body?: unknown;
  runtimeSessions?: OAuthRuntimeSessionsMap;
  oauthDebuggerSessions?: OAuthDebuggerSessionsMap;
  oauthSessionManager?: {
    ensureServersAuthorized: ReturnType<typeof vi.fn>;
    noteRuntimeSession: ReturnType<typeof vi.fn>;
  };
}) {
  const deps = makeDeps(params.body);
  const oauthSessionManager =
    params.oauthSessionManager ??
    ({
      ensureServersAuthorized: vi.fn().mockResolvedValue({ servers: [], allReady: true }),
      noteRuntimeSession: vi.fn()
    } as any);
  const handled = await handleOAuthRuntimeRoutes({
    req: { headers: { host: 'localhost:8787' } } as any,
    res: {} as any,
    pathname: params.pathname,
    method: params.method ?? 'GET',
    settings: { librariesDir: '/tmp/test-libs' } as any,
    runtimeSessions: params.runtimeSessions ?? new Map(),
    oauthDebuggerSessions: params.oauthDebuggerSessions ?? new Map(),
    oauthSessionManager: oauthSessionManager as any,
    deps
  });
  return { handled, response: deps.captured[0] };
}

// ---------------------------------------------------------------------------
// GET /api/oauth-runtime/sessions/:id
// ---------------------------------------------------------------------------

describe('GET /api/oauth-runtime/sessions/:id', () => {
  it('returns 200 with session view when session exists', async () => {
    const session = makeRuntimeSession();
    const dbg = makeDebuggerSession();
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[dbg.id, dbg]]);

    const { handled, response } = await callRoute({
      pathname: `/api/oauth-runtime/sessions/${session.id}`,
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(200);
    expect((response.body as any).session.id).toBe(session.id);
    expect((response.body as any).session.serverName).toBe('my-server');
  });

  it('returns 404 when session is not found', async () => {
    const { handled, response } = await callRoute({
      pathname: '/api/oauth-runtime/sessions/oauthrt-missing'
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(404);
    expect((response.body as any).error).toMatch(/not found/i);
  });

  it('does not include accessToken in session view', async () => {
    const session = makeRuntimeSession();
    const dbg = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'secret-tok' } }
    });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[dbg.id, dbg]]);

    const { response } = await callRoute({
      pathname: `/api/oauth-runtime/sessions/${session.id}`,
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect((response.body as any).session.accessToken).toBeUndefined();
    expect((response.body as any).session.hasAccessToken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/oauth-runtime/sessions/:id/token
// ---------------------------------------------------------------------------

describe('GET /api/oauth-runtime/sessions/:id/token', () => {
  it('returns 200 with accessToken when token is present', async () => {
    const session = makeRuntimeSession();
    const dbg = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'tok-secret-123' } }
    });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[dbg.id, dbg]]);

    const { handled, response } = await callRoute({
      pathname: `/api/oauth-runtime/sessions/${session.id}/token`,
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(200);
    expect((response.body as any).accessToken).toBe('tok-secret-123');
  });

  it('returns 404 when session has no token', async () => {
    const session = makeRuntimeSession();
    const dbg = makeDebuggerSession({ context: {} });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[dbg.id, dbg]]);

    const { handled, response } = await callRoute({
      pathname: `/api/oauth-runtime/sessions/${session.id}/token`,
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(404);
    expect((response.body as any).error).toMatch(/no access token/i);
  });

  it('returns 404 when session is not found', async () => {
    const { handled, response } = await callRoute({
      pathname: '/api/oauth-runtime/sessions/oauthrt-missing/token'
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-runtime/sessions/:id/cancel
// ---------------------------------------------------------------------------

describe('POST /api/oauth-runtime/sessions/:id/cancel', () => {
  it('returns 200 and transitions session to stopped', async () => {
    const session = makeRuntimeSession({ status: 'configuring' });
    const dbg = makeDebuggerSession({ status: 'running' });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[dbg.id, dbg]]);

    const { handled, response } = await callRoute({
      pathname: `/api/oauth-runtime/sessions/${session.id}/cancel`,
      method: 'POST',
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(200);
    expect((response.body as any).session.status).toBe('stopped');
  });

  it('returns 404 when session is not found', async () => {
    const { handled, response } = await callRoute({
      pathname: '/api/oauth-runtime/sessions/oauthrt-missing/cancel',
      method: 'POST'
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-runtime/sessions/:id/callback
// ---------------------------------------------------------------------------

describe('POST /api/oauth-runtime/sessions/:id/callback', () => {
  it('returns 404 when session is not found', async () => {
    const { handled, response } = await callRoute({
      pathname: '/api/oauth-runtime/sessions/oauthrt-missing/callback',
      method: 'POST',
      body: { code: 'auth-code', state: 'state-val' }
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-runtime/sessions (create — validation only)
// ---------------------------------------------------------------------------

describe('POST /api/oauth-runtime/sessions', () => {
  it('returns 400 when serverName is missing', async () => {
    const { handled, response } = await callRoute({
      pathname: '/api/oauth-runtime/sessions',
      method: 'POST',
      body: {}
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(400);
    expect((response.body as any).error).toMatch(/serverName is required/i);
  });
});

describe('POST /api/oauth-runtime/servers/ensure', () => {
  it('returns 400 when serverNames is missing', async () => {
    const { handled, response } = await callRoute({
      pathname: '/api/oauth-runtime/servers/ensure',
      method: 'POST',
      body: {}
    });

    expect(handled).toBe(true);
    expect(response.status).toBe(400);
    expect((response.body as any).error).toMatch(/serverNames/i);
  });
});

// ---------------------------------------------------------------------------
// Unmatched routes
// ---------------------------------------------------------------------------

describe('unmatched routes', () => {
  it('returns false for unknown paths', async () => {
    const { handled } = await callRoute({
      pathname: '/api/other/endpoint',
      method: 'GET'
    });
    expect(handled).toBe(false);
  });
});
