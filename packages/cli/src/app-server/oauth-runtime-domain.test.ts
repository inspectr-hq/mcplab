import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OAuthRuntimeSession, OAuthRuntimeSessionsMap } from './oauth-runtime-domain.js';
import {
  cleanupOAuthRuntimeSessions,
  oauthRuntimeSessionView,
  resolveRuntimeOAuthAuthHeaders
} from './oauth-runtime-domain.js';
import type { OAuthDebuggerSessionsMap } from './app-context.js';
import type { OAuthDebuggerSession } from './oauth-debugger-domain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRuntimeSession(overrides: Partial<OAuthRuntimeSession> = {}): OAuthRuntimeSession {
  return {
    id: 'oauthrt-test-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    serverName: 'my-server',
    oauthDebuggerSessionId: 'dbg-1',
    status: 'configuring',
    ...overrides
  };
}

function makeDebuggerSession(overrides: Partial<OAuthDebuggerSession> = {}): OAuthDebuggerSession {
  return {
    id: 'dbg-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'running',
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

// ---------------------------------------------------------------------------
// resolveRuntimeOAuthAuthHeaders
// ---------------------------------------------------------------------------

describe('resolveRuntimeOAuthAuthHeaders', () => {
  it('throws when no session mapping provided for a required server', () => {
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map();
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();

    expect(() =>
      resolveRuntimeOAuthAuthHeaders({
        requiredServerNames: ['my-server'],
        oauthRuntimeSessionsByServer: {},
        runtimeSessions,
        oauthDebuggerSessions
      })
    ).toThrow(/OAuth login required for server 'my-server'/i);
  });

  it('throws when runtime session id is not found in the map', () => {
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map();
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();

    expect(() =>
      resolveRuntimeOAuthAuthHeaders({
        requiredServerNames: ['my-server'],
        oauthRuntimeSessionsByServer: { 'my-server': 'oauthrt-missing' },
        runtimeSessions,
        oauthDebuggerSessions
      })
    ).toThrow(/invalid for 'my-server'/i);
  });

  it('throws when runtime session belongs to a different server', () => {
    const session = makeRuntimeSession({ serverName: 'other-server' });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();

    expect(() =>
      resolveRuntimeOAuthAuthHeaders({
        requiredServerNames: ['my-server'],
        oauthRuntimeSessionsByServer: { 'my-server': session.id },
        runtimeSessions,
        oauthDebuggerSessions
      })
    ).toThrow(/invalid for 'my-server'/i);
  });

  it('throws when debugger session has no access token', () => {
    const session = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({ context: {} });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    expect(() =>
      resolveRuntimeOAuthAuthHeaders({
        requiredServerNames: ['my-server'],
        oauthRuntimeSessionsByServer: { 'my-server': session.id },
        runtimeSessions,
        oauthDebuggerSessions
      })
    ).toThrow(/has no access token yet/i);
  });

  it('returns Bearer header when access token is present', () => {
    const session = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'tok-abc123' } }
    });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    const result = resolveRuntimeOAuthAuthHeaders({
      requiredServerNames: ['my-server'],
      oauthRuntimeSessionsByServer: { 'my-server': session.id },
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect(result['my-server']).toEqual({ authorization: 'Bearer tok-abc123' });
  });

  it('resolves headers for multiple servers in one call', () => {
    const session1 = makeRuntimeSession({ id: 'rt-1', serverName: 'server-a', oauthDebuggerSessionId: 'dbg-a' });
    const session2 = makeRuntimeSession({ id: 'rt-2', serverName: 'server-b', oauthDebuggerSessionId: 'dbg-b' });
    const dbg1 = makeDebuggerSession({ id: 'dbg-a', context: { tokenResponse: { access_token: 'token-a' } } });
    const dbg2 = makeDebuggerSession({ id: 'dbg-b', context: { tokenResponse: { access_token: 'token-b' } } });

    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([
      [session1.id, session1],
      [session2.id, session2]
    ]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [dbg1.id, dbg1],
      [dbg2.id, dbg2]
    ]);

    const result = resolveRuntimeOAuthAuthHeaders({
      requiredServerNames: ['server-a', 'server-b'],
      oauthRuntimeSessionsByServer: { 'server-a': 'rt-1', 'server-b': 'rt-2' },
      runtimeSessions,
      oauthDebuggerSessions
    });

    expect(result['server-a']).toEqual({ authorization: 'Bearer token-a' });
    expect(result['server-b']).toEqual({ authorization: 'Bearer token-b' });
  });

  it('throws when runtime session has status stopped', () => {
    const session = makeRuntimeSession({ status: 'stopped' });
    const debuggerSession = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'tok-stale' } }
    });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    expect(() =>
      resolveRuntimeOAuthAuthHeaders({
        requiredServerNames: ['my-server'],
        oauthRuntimeSessionsByServer: { 'my-server': session.id },
        runtimeSessions,
        oauthDebuggerSessions
      })
    ).toThrow(/stopped and cannot be used for authorization/i);
  });

  it('throws when runtime session has status error', () => {
    const session = makeRuntimeSession({ status: 'error' });
    const debuggerSession = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'tok-stale' } }
    });
    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    expect(() =>
      resolveRuntimeOAuthAuthHeaders({
        requiredServerNames: ['my-server'],
        oauthRuntimeSessionsByServer: { 'my-server': session.id },
        runtimeSessions,
        oauthDebuggerSessions
      })
    ).toThrow(/error and cannot be used for authorization/i);
  });
});

// ---------------------------------------------------------------------------
// cleanupOAuthRuntimeSessions
// ---------------------------------------------------------------------------

describe('cleanupOAuthRuntimeSessions', () => {
  const TTL = 30 * 60 * 1000;

  it('removes expired runtime sessions and their debugger sessions', () => {
    const now = Date.now();
    const expiredAt = now - TTL - 1000;
    const session = makeRuntimeSession({ updatedAt: expiredAt });
    const debuggerSession = makeDebuggerSession({ updatedAt: expiredAt });

    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions, now, TTL);

    expect(runtimeSessions.size).toBe(0);
    expect(oauthDebuggerSessions.size).toBe(0);
  });

  it('keeps sessions that are still within TTL', () => {
    const now = Date.now();
    const recentAt = now - TTL + 60_000;
    const session = makeRuntimeSession({ updatedAt: recentAt });
    const debuggerSession = makeDebuggerSession({ updatedAt: recentAt });

    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions, now, TTL);

    expect(runtimeSessions.size).toBe(1);
    expect(oauthDebuggerSessions.size).toBe(1);
  });

  it('removes expired runtime session even when no matching debugger session exists', () => {
    const now = Date.now();
    const session = makeRuntimeSession({ updatedAt: now - TTL - 1000 });

    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();

    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions, now, TTL);

    expect(runtimeSessions.size).toBe(0);
  });

  it('uses debugger session updatedAt over runtime session updatedAt for TTL check', () => {
    const now = Date.now();
    const session = makeRuntimeSession({ updatedAt: now - TTL - 1000 });
    // debugger session was updated recently — should keep both
    const debuggerSession = makeDebuggerSession({ updatedAt: now - 1000 });

    const runtimeSessions: OAuthRuntimeSessionsMap = new Map([[session.id, session]]);
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions, now, TTL);

    expect(runtimeSessions.size).toBe(1);
    expect(oauthDebuggerSessions.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// oauthRuntimeSessionView
// ---------------------------------------------------------------------------

describe('oauthRuntimeSessionView', () => {
  it('maps status to error when no debugger session and runtime is not completed', () => {
    const session = makeRuntimeSession({ status: 'configuring', lastError: 'something failed' });
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();

    const view = oauthRuntimeSessionView({ runtimeSession: session, oauthDebuggerSessions });

    expect(view.status).toBe('error');
    expect(view.lastError).toBe('something failed');
    expect(view.hasAccessToken).toBe(false);
    expect(view.authorizationUrl).toBeUndefined();
    expect(view.authorizeLaunchUrl).toBeUndefined();
  });

  it('maps status to completed when no debugger session and runtime status is completed', () => {
    const session = makeRuntimeSession({ status: 'completed' });
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map();

    const view = oauthRuntimeSessionView({ runtimeSession: session, oauthDebuggerSessions });

    expect(view.status).toBe('completed');
  });

  it('maps hasAccessToken to true when debugger session has access token', () => {
    const session = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: { tokenResponse: { access_token: 'tok-xyz' } }
    });
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    const view = oauthRuntimeSessionView({ runtimeSession: session, oauthDebuggerSessions });

    expect(view.hasAccessToken).toBe(true);
  });

  it('includes authorizeLaunchUrl when debugger session has authorizationRequestUrl in context', () => {
    const session = makeRuntimeSession();
    const debuggerSession = makeDebuggerSession({
      context: {
        authorizationRequestUrl: 'https://auth.example.com/authorize?foo=bar'
      }
    });
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([
      [debuggerSession.id, debuggerSession]
    ]);

    const view = oauthRuntimeSessionView({ runtimeSession: session, oauthDebuggerSessions });

    expect(view.authorizeLaunchUrl).toBe(`/api/oauth-debugger/sessions/${debuggerSession.id}/authorize`);
    expect(view.authorizationUrl).toBe('https://auth.example.com/authorize?foo=bar');
  });
});
