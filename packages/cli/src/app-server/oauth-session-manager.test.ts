import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthDebuggerSession } from './oauth-debugger-domain.js';
import type { OAuthRuntimeSession } from './oauth-runtime-domain.js';
import type { OAuthDebuggerSessionsMap, OAuthRuntimeSessionsMap } from './app-context.js';
import { writeLibraries } from './libraries-store.js';
import { OAuthSessionManager } from './oauth-session-manager.js';

const { createRuntimeSessionMock } = vi.hoisted(() => ({ createRuntimeSessionMock: vi.fn() }));
vi.mock('./oauth-runtime-domain.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oauth-runtime-domain.js')>();
  return { ...actual, createOAuthRuntimeSession: createRuntimeSessionMock };
});

function makeRuntimeSession(overrides: Partial<OAuthRuntimeSession> = {}): OAuthRuntimeSession {
  return {
    id: 'oauthrt-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    serverName: 'oauth-server',
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
      target: { serverName: 'oauth-server' },
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

function setupHarness(params?: {
  runtimeSession?: OAuthRuntimeSession;
  debuggerSession?: OAuthDebuggerSession;
  refreshSkewMs?: number;
}) {
  const librariesDir = mkdtempSync(join(tmpdir(), 'oauth-manager-'));
  writeLibraries(librariesDir, {
    servers: {
      'oauth-server': {
        transport: 'http',
        url: 'https://example.com/mcp',
        auth: { type: 'oauth_authorization_code', client_id: 'cid' }
      } as any
    },
    agents: {},
    scenarios: []
  });

  const runtimeSessions: OAuthRuntimeSessionsMap = new Map();
  const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();
  const runtimeSession = params?.runtimeSession;
  const debuggerSession = params?.debuggerSession;
  if (runtimeSession) runtimeSessions.set(runtimeSession.id, runtimeSession);
  if (debuggerSession) oauthDebuggerSessions.set(debuggerSession.id, debuggerSession);

  const manager = new OAuthSessionManager({
    librariesDir,
    runtimeSessions,
    oauthDebuggerSessions,
    refreshSkewMs: params?.refreshSkewMs
  });

  if (runtimeSession) {
    manager.noteRuntimeSession(runtimeSession.serverName, runtimeSession.id);
  }

  return { manager, librariesDir, runtimeSessions, oauthDebuggerSessions };
}

describe('OAuthSessionManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses a valid token without refresh', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        tokenResponse: { access_token: 'tok-valid', expires_in: 3600 }
      } as any
    });
    const { manager, librariesDir } = setupHarness({ runtimeSession, debuggerSession });
    try {
      const headers = await manager.getAuthHeadersForServers(['oauth-server']);
      expect(headers['oauth-server']).toEqual({ authorization: 'Bearer tok-valid' });
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });

  it('refreshes near-expiry tokens and rotates access token', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        tokenResponse: { access_token: 'tok-old', refresh_token: 'refresh-1', expires_in: 1 },
        authServerMetadata: { token_endpoint: 'https://auth.example.com/token' },
        resolvedClient: {
          clientId: 'cid',
          clientSecret: 'secret',
          tokenEndpointAuthMethod: 'client_secret_post'
        }
      } as any
    });
    const { manager, librariesDir } = setupHarness({ runtimeSession, debuggerSession });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'tok-new', expires_in: 3600 }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      const headers = await manager.getAuthHeadersForServers(['oauth-server']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(headers['oauth-server']).toEqual({ authorization: 'Bearer tok-new' });
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });

  it('forces refresh after an MCP 401 even when the token is not near expiry', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        tokenResponse: { access_token: 'tok-old', refresh_token: 'refresh-1', expires_in: 3600 },
        authServerMetadata: { token_endpoint: 'https://auth.example.com/token' },
        resolvedClient: { clientId: 'cid', clientSecret: 'secret', tokenEndpointAuthMethod: 'client_secret_post' }
      } as any
    });
    const { manager, librariesDir } = setupHarness({ runtimeSession, debuggerSession });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok-new', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      expect(await manager.refreshAfterUnauthorized('oauth-server')).toBe(true);
      expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('grant_type')).toBe(
        'refresh_token'
      );
      expect(await manager.getAuthHeadersForServers(['oauth-server'])).toEqual({
        'oauth-server': { authorization: 'Bearer tok-new' }
      });
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });

  it('does not repeat a failed forced refresh after invalid_grant', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        tokenResponse: { access_token: 'tok-old', refresh_token: 'refresh-1', expires_in: 3600 },
        authServerMetadata: { token_endpoint: 'https://auth.example.com/token' },
        resolvedClient: { clientId: 'cid', clientSecret: 'secret', tokenEndpointAuthMethod: 'client_secret_post' }
      } as any
    });
    const { manager, librariesDir } = setupHarness({ runtimeSession, debuggerSession });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      expect(await manager.refreshAfterUnauthorized('oauth-server')).toBe(false);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });

  it('starts fresh authorization and clears a token rejected after refresh', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'tok-rejected', expires_in: 3600 } } as any
    });
    const harness = setupHarness({ runtimeSession, debuggerSession });
    const createdSession = {
      id: 'oauthrt-new',
      serverName: 'oauth-server',
      status: 'configuring',
      authorizationUrl: 'https://auth.example.com/authorize',
      authorizeLaunchUrl: '/authorize',
      hasAccessToken: false
    };
    createRuntimeSessionMock.mockImplementation(async (params) => {
      params.runtimeSessions.set('oauthrt-new', makeRuntimeSession({
        id: 'oauthrt-new',
        oauthDebuggerSessionId: 'dbg-new',
        status: 'configuring'
      }));
      params.oauthDebuggerSessions.set('dbg-new', makeDebuggerSession({
        id: 'dbg-new',
        status: 'running'
      }));
      return createdSession;
    });

    try {
      await expect(
        harness.manager.reauthorizeAfterUnauthorized('oauth-server', 'localhost')
      ).rejects.toMatchObject({
        name: 'OAuthAuthorizationRequiredError',
        details: [expect.objectContaining({ runtimeSessionId: 'oauthrt-new' })]
      });
      const result = await harness.manager.ensureServerAuthorized('oauth-server');
      expect(result.status).toBe('auth_required');
      expect(result.runtimeSessionId).toBe('oauthrt-new');
    } finally {
      createRuntimeSessionMock.mockReset();
      rmSync(harness.librariesDir, { recursive: true, force: true });
    }
  });

  it('returns auth_required when token is expired and refresh is unavailable', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        tokenResponse: { access_token: 'tok-old', expires_in: 1 }
      } as any
    });
    const { manager, librariesDir } = setupHarness({ runtimeSession, debuggerSession });

    try {
      const result = await manager.ensureServerAuthorized('oauth-server');
      expect(result.status).toBe('auth_required');
      expect(result.runtimeSessionId).toBe('oauthrt-1');
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });

  it('deduplicates concurrent refresh requests per server', async () => {
    const runtimeSession = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        tokenResponse: { access_token: 'tok-old', refresh_token: 'refresh-1', expires_in: 1 },
        authServerMetadata: { token_endpoint: 'https://auth.example.com/token' },
        resolvedClient: {
          clientId: 'cid',
          clientSecret: 'secret',
          tokenEndpointAuthMethod: 'client_secret_post'
        }
      } as any
    });
    const { manager, librariesDir } = setupHarness({ runtimeSession, debuggerSession });
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      const p1 = manager.refreshIfNeeded('oauth-server');
      const p2 = manager.refreshIfNeeded('oauth-server');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      resolveFetch?.(
        new Response(JSON.stringify({ access_token: 'tok-new', expires_in: 3600 }), { status: 200 })
      );
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });
});
