import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EvalConfig } from '@inspectr/mcplab-core';
import type {
  AppRouteDeps,
  AppRouteRequestContext,
  OAuthDebuggerSessionsMap
} from './app-context.js';
import {
  cleanupOAuthDebuggerSessions,
  createOAuthDebuggerSession,
  oauthDebuggerExportMarkdown,
  oauthDebuggerExportRawTrace,
  oauthDebuggerSessionView,
  startOrResumeOAuthDebuggerSession,
  stopOAuthDebuggerSession,
  submitBrowserCallbackToSession,
  submitManualCallbackToSession,
  type OAuthDebuggerSessionConfigInput
} from './oauth-debugger-domain.js';

export type OAuthDebuggerRouteDeps = Pick<
  AppRouteDeps,
  'parseBody' | 'asJson' | 'asText' | 'readLibraries' | 'sendSseEvent'
>;

function appBaseUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? '127.0.0.1:8787';
  return `http://${host}`;
}

export async function handleOAuthDebuggerRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
  deps: OAuthDebuggerRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, oauthDebuggerSessions, deps } = params;
  const { parseBody, asJson, asText, readLibraries, sendSseEvent } = deps;

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const getSession = (id: string) => oauthDebuggerSessions.get(id);

  if (pathname === '/api/oauth-debugger/sessions' && method === 'POST') {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const body = (await parseBody(req)) as OAuthDebuggerSessionConfigInput;
    if (!body || body.profile !== 'latest') {
      asJson(res, 400, { error: 'profile must be "latest" in v1' });
      return true;
    }
    if (!body.target?.serverName) {
      asJson(res, 400, { error: 'target.serverName is required' });
      return true;
    }
    if (!body.registrationMethod) {
      asJson(res, 400, { error: 'registrationMethod is required' });
      return true;
    }
    const libraries = readLibraries(settings.librariesDir);
    const serverConfig = libraries.servers[String(body.target.serverName)] as
      | EvalConfig['servers'][string]
      | undefined;
    const session = createOAuthDebuggerSession({ config: body, serverConfig });
    oauthDebuggerSessions.set(session.id, session);
    asJson(res, 201, { sessionId: session.id, session: oauthDebuggerSessionView(session) });
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-debugger/sessions/') &&
    pathname.endsWith('/events') &&
    method === 'GET'
  ) {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const session = getSession(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'OAuth Debugger session not found' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    if ('flushHeaders' in res && typeof res.flushHeaders === 'function') res.flushHeaders();
    for (const event of session.events) sendSseEvent(res, event);
    if (
      session.status === 'completed' ||
      session.status === 'error' ||
      session.status === 'stopped'
    ) {
      res.end();
      return true;
    }
    session.clients.add(res);
    req.on('close', () => {
      session.clients.delete(res);
    });
    return true;
  }

  if (pathname.startsWith('/api/oauth-debugger/sessions/') && method === 'GET') {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const parts = pathname.split('/');
    if (parts[5] === 'authorize') {
      const sessionId = parts[4];
      const session = getSession(sessionId);
      if (!session) {
        asText(res, 404, 'OAuth Debugger session not found');
        return true;
      }
      const authorizationUrl = session.context.authorizationRequestUrl;
      if (!authorizationUrl) {
        asText(res, 409, 'Authorization URL not available yet. Start the flow first.');
        return true;
      }
      res.statusCode = 302;
      res.setHeader('location', authorizationUrl);
      res.end();
      return true;
    }
    if (parts[5] === 'callback') {
      const sessionId = parts[4];
      const session = getSession(sessionId);
      if (!session) {
        asText(res, 404, 'OAuth Debugger session not found');
        return true;
      }
      const url = new URL(req.url ?? '/', appBaseUrl(req));
      submitBrowserCallbackToSession({ session, rawUrl: url.toString() });
      void startOrResumeOAuthDebuggerSession({ session, appBaseUrl: appBaseUrl(req) });
      asText(
        res,
        200,
        'OAuth callback captured by MCP Lab OAuth Debugger. You can return to the app and continue inspecting the flow.'
      );
      return true;
    }
    const sessionId = parts[4];
    const session = getSession(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'OAuth Debugger session not found' });
      return true;
    }
    asJson(res, 200, { session: oauthDebuggerSessionView(session) });
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-debugger/sessions/') &&
    pathname.endsWith('/start') &&
    method === 'POST'
  ) {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const session = getSession(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'OAuth Debugger session not found' });
      return true;
    }
    void startOrResumeOAuthDebuggerSession({ session, appBaseUrl: appBaseUrl(req) });
    asJson(res, 200, { session: oauthDebuggerSessionView(session) });
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-debugger/sessions/') &&
    pathname.endsWith('/manual-callback') &&
    method === 'POST'
  ) {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const session = getSession(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'OAuth Debugger session not found' });
      return true;
    }
    const body = await parseBody(req);
    submitManualCallbackToSession({
      session,
      redirectUrl: typeof body.redirectUrl === 'string' ? body.redirectUrl : undefined,
      code: typeof body.code === 'string' ? body.code : undefined,
      state: typeof body.state === 'string' ? body.state : undefined
    });
    void startOrResumeOAuthDebuggerSession({ session, appBaseUrl: appBaseUrl(req) });
    asJson(res, 200, { session: oauthDebuggerSessionView(session) });
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-debugger/sessions/') &&
    pathname.endsWith('/stop') &&
    method === 'POST'
  ) {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const session = getSession(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'OAuth Debugger session not found' });
      return true;
    }
    stopOAuthDebuggerSession(session);
    asJson(res, 200, { ok: true, status: session.status });
    return true;
  }

  if (
    pathname.startsWith('/api/oauth-debugger/sessions/') &&
    pathname.endsWith('/export') &&
    method === 'GET'
  ) {
    cleanupOAuthDebuggerSessions(oauthDebuggerSessions);
    const sessionId = pathname.split('/')[4];
    const session = getSession(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'OAuth Debugger session not found' });
      return true;
    }
    const url = new URL(req.url ?? '/', appBaseUrl(req));
    const format = String(url.searchParams.get('format') ?? 'json');
    if (format === 'json') {
      asJson(res, 200, {
        session: oauthDebuggerSessionView(session),
        raw: {
          config: session.config,
          steps: session.steps,
          validations: session.validations,
          network: session.network,
          events: session.events,
          sequence: session.sequence
        }
      });
      return true;
    }
    if (format === 'markdown') {
      asText(res, 200, oauthDebuggerExportMarkdown(session));
      return true;
    }
    if (format === 'raw') {
      asText(res, 200, oauthDebuggerExportRawTrace(session));
      return true;
    }
    asJson(res, 400, { error: 'format must be json|markdown|raw' });
    return true;
  }

  return false;
}
