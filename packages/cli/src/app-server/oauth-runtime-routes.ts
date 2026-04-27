import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppRouteRequestContext, OAuthDebuggerSessionsMap } from './app-context.js';
import type { OAuthRuntimeSessionsMap } from './oauth-runtime-domain.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
import {
  cleanupOAuthRuntimeSessions,
  createOAuthRuntimeSession,
  getOAuthRuntimeSessionToken,
  oauthRuntimeSessionView,
  stopOAuthRuntimeSession,
  submitOAuthRuntimeCallback
} from './oauth-runtime-domain.js';

export interface OAuthRuntimeRouteDeps {
  parseBody: (req: IncomingMessage) => Promise<any>;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
}

export async function handleOAuthRuntimeRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  runtimeSessions: OAuthRuntimeSessionsMap;
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
  oauthSessionManager: OAuthSessionManager;
  deps: OAuthRuntimeRouteDeps;
}): Promise<boolean> {
  const {
    req,
    res,
    pathname,
    method,
    settings,
    runtimeSessions,
    oauthDebuggerSessions,
    oauthSessionManager,
    deps
  } = params;
  const { parseBody, asJson } = deps;

  if (pathname === '/api/oauth-runtime/servers/ensure' && method === 'POST') {
    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions);
    const body = await parseBody(req);
    const serverNames = Array.isArray(body?.serverNames)
      ? body.serverNames.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    if (serverNames.length === 0) {
      asJson(res, 400, { error: 'serverNames[] is required' });
      return true;
    }
    try {
      const result = await oauthSessionManager.ensureServersAuthorized(
        serverNames,
        req.headers.host
      );
      asJson(res, 200, result);
    } catch (error: unknown) {
      if (error instanceof OAuthAuthorizationRequiredError) {
        asJson(res, 401, { error: error.message, oauth: { required: error.details } });
        return true;
      }
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (pathname === '/api/oauth-runtime/sessions' && method === 'POST') {
    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions);
    const body = await parseBody(req);
    const serverName = String(body?.serverName ?? '').trim();
    if (!serverName) {
      asJson(res, 400, { error: 'serverName is required' });
      return true;
    }
    try {
      const session = await createOAuthRuntimeSession({
        serverName,
        hostHeader: req.headers.host,
        librariesDir: settings.librariesDir,
        runtimeSessions,
        oauthDebuggerSessions
      });
      oauthSessionManager.noteRuntimeSession(serverName, session.id);
      asJson(res, 201, { session });
    } catch (error: unknown) {
      asJson(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-runtime/sessions/') &&
    pathname.endsWith('/token') &&
    method === 'GET'
  ) {
    const sessionId = pathname.split('/')[4];
    const runtimeSession = runtimeSessions.get(sessionId);
    if (!runtimeSession) {
      asJson(res, 404, { error: 'OAuth runtime session not found' });
      return true;
    }
    const accessToken = getOAuthRuntimeSessionToken({ runtimeSession, oauthDebuggerSessions });
    if (!accessToken) {
      asJson(res, 404, { error: 'No access token available for this session' });
      return true;
    }
    asJson(res, 200, { accessToken });
    return true;
  }

  if (pathname.startsWith('/api/oauth-runtime/sessions/') && method === 'GET') {
    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const runtimeSession = runtimeSessions.get(sessionId);
    if (!runtimeSession) {
      asJson(res, 404, { error: 'OAuth runtime session not found' });
      return true;
    }
    asJson(res, 200, {
      session: oauthRuntimeSessionView({ runtimeSession, oauthDebuggerSessions })
    });
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-runtime/sessions/') &&
    pathname.endsWith('/callback') &&
    method === 'POST'
  ) {
    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const runtimeSession = runtimeSessions.get(sessionId);
    if (!runtimeSession) {
      asJson(res, 404, { error: 'OAuth runtime session not found' });
      return true;
    }
    const body = await parseBody(req);
    try {
      await submitOAuthRuntimeCallback({
        runtimeSession,
        oauthDebuggerSessions,
        redirectUrl: typeof body?.redirectUrl === 'string' ? body.redirectUrl : undefined,
        code: typeof body?.code === 'string' ? body.code : undefined,
        state: typeof body?.state === 'string' ? body.state : undefined,
        hostHeader: req.headers.host
      });
      oauthSessionManager.noteRuntimeSession(runtimeSession.serverName, runtimeSession.id);
      asJson(res, 200, {
        session: oauthRuntimeSessionView({ runtimeSession, oauthDebuggerSessions })
      });
    } catch (error: unknown) {
      asJson(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-runtime/sessions/') &&
    pathname.endsWith('/cancel') &&
    method === 'POST'
  ) {
    cleanupOAuthRuntimeSessions(runtimeSessions, oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const runtimeSession = runtimeSessions.get(sessionId);
    if (!runtimeSession) {
      asJson(res, 404, { error: 'OAuth runtime session not found' });
      return true;
    }
    stopOAuthRuntimeSession({ runtimeSession, oauthDebuggerSessions });
    asJson(res, 200, {
      session: oauthRuntimeSessionView({ runtimeSession, oauthDebuggerSessions })
    });
    return true;
  }

  return false;
}
