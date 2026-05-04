import { readFileSync } from 'node:fs';
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
  'parseBody' | 'asHtml' | 'asJson' | 'asText' | 'readLibraries' | 'sendSseEvent'
>;

function appBaseUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? '127.0.0.1:8787';
  return `http://${host}`;
}

function acceptsTextPlain(acceptHeader: string | string[] | undefined): boolean {
  const accept = Array.isArray(acceptHeader) ? acceptHeader.join(',') : acceptHeader ?? '';
  return accept
    .toLowerCase()
    .split(',')
    .some((value) => value.trim().startsWith('text/plain'));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const fallbackFaviconHref = 'https://mcplab.inspectr.dev/favicon.svg';
const faviconHref = (() => {
  try {
    const faviconSvg = readFileSync(
      new URL('../../../app/public/favicon.svg', import.meta.url),
      'utf8'
    );
    return `data:image/svg+xml;utf8,${encodeURIComponent(faviconSvg)}`;
  } catch {
    return fallbackFaviconHref;
  }
})();

function renderOAuthCallbackPage(result?: {
  rawUrl?: string;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): string {
  const hasError = Boolean(result?.error);
  const message = hasError
    ? 'Authorization server returned an error.'
    : 'OAuth callback captured by MCPLab.';
  const messageHtml = escapeHtml(message);
  const supportingText = hasError ? 'Review the failure and try again.' : '';
  const detailLines = hasError
    ? [
        result?.error ? `error: ${result.error}` : undefined,
        result?.errorDescription ? `error_description: ${result.errorDescription}` : undefined,
        result?.state ? `state: ${result.state}` : undefined
      ].filter(Boolean)
    : [];
  const detailText = detailLines.length > 0 ? detailLines.join('\n') : '';
  const pageTitle = hasError ? 'OAuth error - MCPLab' : 'OAuth callback captured - MCPLab';
  const footerText = hasError
    ? 'Close this tab and return to MCPLab to inspect the error.'
    : 'Close this tab and return to MCPLab';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${faviconHref}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pageTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --panel: #f8fafc;
        --muted: #64748b;
        --text: #0f172a;
        --border: #e2e8f0;
        --soft: #f1f5f9;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        height: 100%;
      }

      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--bg);
      }

      #root {
        min-height: 100vh;
        display: grid;
        place-items: center;
        width: 100%;
      }

      .shell {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 24px;
      }

      .card {
        width: min(100%, 480px);
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel);
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
        padding: 16px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .brand-mark {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        background: hsl(38 92% 95% / 0.5);
        border: 1px solid hsl(25 95% 53% / 0.6);
      }

      .brand-mark img {
        width: 22px;
        height: 22px;
        display: block;
      }

      .brand-copy {
        display: grid;
        gap: 1px;
      }

      .brand-copy strong {
        font-size: 0.9rem;
        line-height: 1.2;
      }

      .brand-copy span {
        font-size: 0.75rem;
        color: var(--muted);
      }

      .status {
        margin-top: 14px;
        padding: 12px;
        border: 1px solid ${hasError ? '#fecaca' : 'var(--border)'};
        border-radius: 8px;
        background: ${hasError ? '#fef2f2' : 'var(--soft)'};
      }

      .status p {
        font-size: 0.875rem;
      }

      .status p + p {
        margin-top: 10px;
      }

      p {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.4;
      }

      .detail {
        margin-top: 10px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      code {
        display: block;
        margin-top: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--soft);
        border: 1px solid var(--border);
        font-size: 0.75rem;
        overflow-x: auto;
        word-break: break-word;
      }

      .footer {
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.75rem;
      }
    </style>
  </head>
  <body>
    <div id="root" class="w-full">
      <div class="shell">
        <div class="card">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">
              <img src="${faviconHref}" alt="" />
            </div>
            <div class="brand-copy">
              <strong>MCPLab</strong>
              <span>OAuth Callback</span>
            </div>
          </div>
          <div class="status">
            <p>${messageHtml}</p>
            ${hasError ? `<p class="detail">${escapeHtml(supportingText)}</p>` : ''}
            ${hasError ? `<code>${escapeHtml(detailText)}</code>` : ''}
          </div>
          ${footerText ? `<p class="footer">${escapeHtml(footerText)}</p>` : ''}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function renderOAuthCallbackPlainText(result?: {
  rawUrl?: string;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): string {
  if (result?.error) {
    const lines = [
      'Authorization server returned an error.',
      result.error ? `error: ${result.error}` : undefined,
      result.errorDescription ? `error_description: ${result.errorDescription}` : undefined,
      result.state ? `state: ${result.state}` : undefined
    ].filter(Boolean);
    return lines.join('\n');
  }

  return 'OAuth callback captured by MCP Lab OAuth Debugger. You can return to the app and continue inspecting the flow.';
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
  const { parseBody, asHtml, asJson, asText, readLibraries, sendSseEvent } = deps;

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
      if (acceptsTextPlain(req.headers.accept)) {
        asText(res, 200, renderOAuthCallbackPlainText(session.context.callbackResult));
      } else {
        asHtml(res, 200, renderOAuthCallbackPage(session.context.callbackResult));
      }
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
