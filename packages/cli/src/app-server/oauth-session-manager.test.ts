import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthDebuggerSession } from './oauth-debugger-domain.js';
import type { OAuthRuntimeSession } from './oauth-runtime-domain.js';
import type { OAuthDebuggerSessionsMap, OAuthRuntimeSessionsMap } from './app-context.js';
import { writeLibraries } from './libraries-store.js';
import { OAuthSessionManager } from './oauth-session-manager.js';

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

  return { manager, librariesDir };
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
      .mockResolvedValue(new Response(JSON.stringify({ access_token: 'tok-new', expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      const headers = await manager.getAuthHeadersForServers(['oauth-server']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(headers['oauth-server']).toEqual({ authorization: 'Bearer tok-new' });
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
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
      resolveFetch?.(new Response(JSON.stringify({ access_token: 'tok-new', expires_in: 3600 }), { status: 200 }));
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    } finally {
      rmSync(librariesDir, { recursive: true, force: true });
    }
  });
});
