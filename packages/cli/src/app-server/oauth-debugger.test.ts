import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submitBrowserCallbackToSession: vi.fn(
    (params: { session: OAuthDebuggerSession; rawUrl: string }) => {
      const parsed = new URL(params.rawUrl);
      params.session.context.callbackResult = {
        rawUrl: params.rawUrl,
        code: parsed.searchParams.get('code') ?? undefined,
        state: parsed.searchParams.get('state') ?? undefined,
        error: parsed.searchParams.get('error') ?? undefined,
        errorDescription: parsed.searchParams.get('error_description') ?? undefined,
        issuer: parsed.searchParams.get('iss') ?? undefined
      };
    }
  ),
  startOrResumeOAuthDebuggerSession: vi.fn()
}));

vi.mock('./oauth-debugger-domain.js', () => ({
  cleanupOAuthDebuggerSessions: vi.fn(),
  createOAuthDebuggerSession: vi.fn(),
  oauthDebuggerExportMarkdown: vi.fn(),
  oauthDebuggerExportRawTrace: vi.fn(),
  oauthDebuggerSessionView: vi.fn(),
  startOrResumeOAuthDebuggerSession: mocks.startOrResumeOAuthDebuggerSession,
  stopOAuthDebuggerSession: vi.fn(),
  submitBrowserCallbackToSession: mocks.submitBrowserCallbackToSession,
  submitManualCallbackToSession: vi.fn()
}));

import { handleOAuthDebuggerRoutes } from './oauth-debugger.js';
import type { OAuthDebuggerSession } from './oauth-debugger-domain.js';
import type { OAuthDebuggerSessionsMap } from './app-context.js';

function makeSession(overrides: Partial<OAuthDebuggerSession> = {}): OAuthDebuggerSession {
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

describe('GET /api/oauth-debugger/sessions/:id/callback', () => {
  it('returns a success page with the authorization code and resumes the session', async () => {
    const session = makeSession();
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[session.id, session]]);
    const captured: Array<{ status: number; body: string }> = [];

    const handled = await handleOAuthDebuggerRoutes({
      req: {
        headers: { host: 'localhost:8787' },
        url: `/api/oauth-debugger/sessions/${session.id}/callback?code=abc123&state=xyz`
      } as any,
      res: {} as any,
      pathname: `/api/oauth-debugger/sessions/${session.id}/callback`,
      method: 'GET',
      settings: { librariesDir: '/tmp/test-libs' } as any,
      oauthDebuggerSessions,
      deps: {
        parseBody: vi.fn(),
        asHtml: vi.fn((_res: any, status: number, body: string) => {
          captured.push({ status, body });
        }),
        asJson: vi.fn(),
        asText: vi.fn(),
        readLibraries: vi.fn(),
        sendSseEvent: vi.fn()
      } as any
    });

    expect(handled).toBe(true);
    expect(mocks.submitBrowserCallbackToSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        rawUrl:
          'http://localhost:8787/api/oauth-debugger/sessions/dbg-1/callback?code=abc123&state=xyz'
      })
    );
    expect(mocks.startOrResumeOAuthDebuggerSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        appBaseUrl: 'http://localhost:8787'
      })
    );
    expect(captured[0]?.status).toBe(200);
    expect(captured[0]?.body).toContain('<title>OAuth callback captured - MCPLab</title>');
    expect(captured[0]?.body).toContain('MCPLab');
    expect(captured[0]?.body).toContain('data:image/svg+xml;utf8,');
    expect(captured[0]?.body).toContain('OAuth callback captured by MCP Lab OAuth Debugger.');
    expect(captured[0]?.body).toContain(
      'You can return to the app and continue inspecting the flow.'
    );
    expect(captured[0]?.body).not.toContain('code: abc123');
    expect(captured[0]?.body).not.toContain('state: xyz');
    expect(captured[0]?.body).not.toContain('Return to the OAuth Debugger to continue the flow.');
    expect(captured[0]?.body).not.toContain('Close this tab and paste the code');
  });

  it('returns plain text when the client accepts text/plain', async () => {
    const session = makeSession();
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[session.id, session]]);
    const captured: Array<{ status: number; body: string }> = [];

    const handled = await handleOAuthDebuggerRoutes({
      req: {
        headers: { host: 'localhost:8787', accept: 'text/plain' },
        url: `/api/oauth-debugger/sessions/${session.id}/callback?code=abc123&state=xyz`
      } as any,
      res: {} as any,
      pathname: `/api/oauth-debugger/sessions/${session.id}/callback`,
      method: 'GET',
      settings: { librariesDir: '/tmp/test-libs' } as any,
      oauthDebuggerSessions,
      deps: {
        parseBody: vi.fn(),
        asHtml: vi.fn(),
        asJson: vi.fn(),
        asText: vi.fn((_res: any, status: number, body: string) => {
          captured.push({ status, body });
        }),
        readLibraries: vi.fn(),
        sendSseEvent: vi.fn()
      } as any
    });

    expect(handled).toBe(true);
    expect(captured[0]?.status).toBe(200);
    expect(captured[0]?.body).toBe(
      'OAuth callback captured by MCP Lab OAuth Debugger. You can return to the app and continue inspecting the flow.'
    );
  });

  it('returns an error page when the authorization server reports an error', async () => {
    const session = makeSession();
    const oauthDebuggerSessions: OAuthDebuggerSessionsMap = new Map([[session.id, session]]);
    const captured: Array<{ status: number; body: string }> = [];

    const handled = await handleOAuthDebuggerRoutes({
      req: {
        headers: { host: 'localhost:8787' },
        url: `/api/oauth-debugger/sessions/${
          session.id
        }/callback?error=invalid_scope&error_description=${encodeURIComponent(
          'Invalid scopes: profile mcp:access'
        )}&state=xyz`
      } as any,
      res: {} as any,
      pathname: `/api/oauth-debugger/sessions/${session.id}/callback`,
      method: 'GET',
      settings: { librariesDir: '/tmp/test-libs' } as any,
      oauthDebuggerSessions,
      deps: {
        parseBody: vi.fn(),
        asHtml: vi.fn((_res: any, status: number, body: string) => {
          captured.push({ status, body });
        }),
        asJson: vi.fn(),
        asText: vi.fn(),
        readLibraries: vi.fn(),
        sendSseEvent: vi.fn()
      } as any
    });

    expect(handled).toBe(true);
    expect(captured[0]?.status).toBe(200);
    expect(captured[0]?.body).toContain('Authorization server returned an error.');
    expect(captured[0]?.body).toContain('<title>OAuth error - MCPLab</title>');
    expect(captured[0]?.body).toContain('data:image/svg+xml;utf8,');
    expect(captured[0]?.body).toContain('error: invalid_scope');
    expect(captured[0]?.body).toContain('error_description: Invalid scopes: profile mcp:access');
    expect(captured[0]?.body).toContain('state: xyz');
  });
});
