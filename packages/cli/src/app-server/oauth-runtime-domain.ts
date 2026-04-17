import type { EvalConfig } from '@inspectr/mcplab-core';
import type { OAuthDebuggerSession, OAuthDebuggerSessionConfigInput } from './oauth-debugger-domain.js';
import type { OAuthDebuggerSessionsMap } from './app-context.js';
import { readLibraries } from './libraries-store.js';
import {
  createOAuthDebuggerSession,
  oauthDebuggerSessionView,
  startOrResumeOAuthDebuggerSession,
  stopOAuthDebuggerSession,
  submitManualCallbackToSession
} from './oauth-debugger-domain.js';

export type OAuthRuntimeSessionStatus =
  | 'configuring'
  | 'waiting_for_user'
  | 'waiting_for_browser_callback'
  | 'completed'
  | 'error'
  | 'stopped';

export interface OAuthRuntimeSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  serverName: string;
  oauthDebuggerSessionId: string;
  status: OAuthRuntimeSessionStatus;
  lastError?: string;
}

export interface OAuthRuntimeSessionView {
  id: string;
  serverName: string;
  status: OAuthRuntimeSessionStatus;
  createdAt: string;
  updatedAt: string;
  oauthDebuggerSessionId: string;
  authorizationUrl?: string;
  authorizeLaunchUrl?: string;
  callbackUrl?: string;
  hasAccessToken: boolean;
  lastError?: string;
}

export type OAuthRuntimeSessionsMap = Map<string, OAuthRuntimeSession>;

function makeRuntimeSessionId(): string {
  return `oauthrt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appBaseUrl(hostHeader?: string): string {
  return `http://${hostHeader ?? '127.0.0.1:8787'}`;
}

function splitScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toRuntimeStatus(debuggerStatus: OAuthDebuggerSession['status']): OAuthRuntimeSessionStatus {
  if (debuggerStatus === 'running') return 'configuring';
  return debuggerStatus;
}

function getAccessToken(session: OAuthDebuggerSession | undefined): string | undefined {
  if (!session) return undefined;
  const tokenResponse = session.context.tokenResponse as Record<string, unknown> | undefined;
  if (!tokenResponse) return undefined;
  const accessToken = tokenResponse.access_token;
  return typeof accessToken === 'string' && accessToken.trim() ? accessToken : undefined;
}

export function cleanupOAuthRuntimeSessions(
  runtimeSessions: OAuthRuntimeSessionsMap,
  oauthDebuggerSessions: OAuthDebuggerSessionsMap,
  now = Date.now(),
  ttlMs = 30 * 60 * 1000
): void {
  for (const [id, runtime] of runtimeSessions) {
    const debuggerSession = oauthDebuggerSessions.get(runtime.oauthDebuggerSessionId);
    const updated = debuggerSession?.updatedAt ?? runtime.updatedAt;
    if (now - updated <= ttlMs) continue;
    runtimeSessions.delete(id);
    if (debuggerSession) {
      stopOAuthDebuggerSession(debuggerSession);
      oauthDebuggerSessions.delete(runtime.oauthDebuggerSessionId);
    }
  }
}

export function oauthRuntimeSessionView(params: {
  runtimeSession: OAuthRuntimeSession;
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
}): OAuthRuntimeSessionView {
  const { runtimeSession, oauthDebuggerSessions } = params;
  const debuggerSession = oauthDebuggerSessions.get(runtimeSession.oauthDebuggerSessionId);
  const debuggerView = debuggerSession ? oauthDebuggerSessionView(debuggerSession) : undefined;
  const authorizationUrl = debuggerView?.uiHints.authorizationUrl;
  const status = debuggerSession
    ? toRuntimeStatus(debuggerSession.status)
    : runtimeSession.status === 'completed'
    ? 'completed'
    : 'error';
  const accessToken = getAccessToken(debuggerSession);

  return {
    id: runtimeSession.id,
    serverName: runtimeSession.serverName,
    status,
    createdAt: new Date(runtimeSession.createdAt).toISOString(),
    updatedAt: new Date(debuggerSession?.updatedAt ?? runtimeSession.updatedAt).toISOString(),
    oauthDebuggerSessionId: runtimeSession.oauthDebuggerSessionId,
    authorizationUrl,
    authorizeLaunchUrl: authorizationUrl
      ? `/api/oauth-debugger/sessions/${runtimeSession.oauthDebuggerSessionId}/authorize`
      : undefined,
    callbackUrl: debuggerView?.uiHints.callbackUrl,
    hasAccessToken: Boolean(accessToken),
    lastError:
      status === 'error'
        ? debuggerSession?.steps.find((step) => step.status === 'failed')?.outcomeSummary ||
          runtimeSession.lastError ||
          'OAuth flow failed'
        : runtimeSession.lastError
  };
}

export async function createOAuthRuntimeSession(params: {
  serverName: string;
  hostHeader?: string;
  librariesDir: string;
  runtimeSessions: OAuthRuntimeSessionsMap;
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
}): Promise<OAuthRuntimeSessionView> {
  const libraries = readLibraries(params.librariesDir);
  const serverConfig = libraries.servers[params.serverName] as EvalConfig['servers'][string] | undefined;
  if (!serverConfig) {
    throw new Error(`Server '${params.serverName}' not found in libraries`);
  }
  if (serverConfig.auth?.type !== 'oauth_authorization_code') {
    throw new Error(
      `Server '${params.serverName}' is not configured with oauth_authorization_code auth`
    );
  }

  const config: OAuthDebuggerSessionConfigInput = {
    profile: 'latest',
    target: { serverName: params.serverName },
    registrationMethod: 'pre_registered',
    clientConfig: {
      preRegistered: {
        clientId: serverConfig.auth.client_id,
        clientSecret: serverConfig.auth.client_secret
      }
    },
    runtime: {
      redirectMode: 'local_callback',
      scopes: splitScopes(serverConfig.auth.scope),
      usePkce: true,
      codeChallengeMethod: 'S256'
    },
    display: {
      showSensitiveValues: false
    }
  };

  const debuggerSession = createOAuthDebuggerSession({
    config,
    serverConfig
  });
  params.oauthDebuggerSessions.set(debuggerSession.id, debuggerSession);

  const runtimeSession: OAuthRuntimeSession = {
    id: makeRuntimeSessionId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    serverName: params.serverName,
    oauthDebuggerSessionId: debuggerSession.id,
    status: 'configuring'
  };
  params.runtimeSessions.set(runtimeSession.id, runtimeSession);

  void startOrResumeOAuthDebuggerSession({
    session: debuggerSession,
    appBaseUrl: appBaseUrl(params.hostHeader)
  });

  return oauthRuntimeSessionView({
    runtimeSession,
    oauthDebuggerSessions: params.oauthDebuggerSessions
  });
}

export async function submitOAuthRuntimeCallback(params: {
  runtimeSession: OAuthRuntimeSession;
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
  redirectUrl?: string;
  code?: string;
  state?: string;
  hostHeader?: string;
}): Promise<void> {
  const debuggerSession = params.oauthDebuggerSessions.get(params.runtimeSession.oauthDebuggerSessionId);
  if (!debuggerSession) {
    throw new Error('Associated OAuth debugger session not found');
  }
  submitManualCallbackToSession({
    session: debuggerSession,
    redirectUrl: params.redirectUrl,
    code: params.code,
    state: params.state
  });
  await startOrResumeOAuthDebuggerSession({
    session: debuggerSession,
    appBaseUrl: appBaseUrl(params.hostHeader)
  });
}

export function stopOAuthRuntimeSession(params: {
  runtimeSession: OAuthRuntimeSession;
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
}): void {
  const debuggerSession = params.oauthDebuggerSessions.get(params.runtimeSession.oauthDebuggerSessionId);
  if (debuggerSession) {
    stopOAuthDebuggerSession(debuggerSession);
  }
  params.runtimeSession.status = 'stopped';
  params.runtimeSession.updatedAt = Date.now();
}

export function resolveRuntimeOAuthAuthHeaders(params: {
  requiredServerNames: string[];
  oauthRuntimeSessionsByServer?: Record<string, string>;
  runtimeSessions: OAuthRuntimeSessionsMap;
  oauthDebuggerSessions: OAuthDebuggerSessionsMap;
}): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const mapping = params.oauthRuntimeSessionsByServer ?? {};

  for (const serverName of params.requiredServerNames) {
    const runtimeSessionId = mapping[serverName];
    if (!runtimeSessionId) {
      throw new Error(
        `OAuth login required for server '${serverName}'. Start an OAuth runtime session first.`
      );
    }
    const runtimeSession = params.runtimeSessions.get(runtimeSessionId);
    if (!runtimeSession || runtimeSession.serverName !== serverName) {
      throw new Error(`OAuth runtime session '${runtimeSessionId}' is invalid for '${serverName}'`);
    }
    const debuggerSession = params.oauthDebuggerSessions.get(runtimeSession.oauthDebuggerSessionId);
    const accessToken = getAccessToken(debuggerSession);
    if (!accessToken) {
      throw new Error(
        `OAuth runtime session '${runtimeSessionId}' for '${serverName}' has no access token yet`
      );
    }
    out[serverName] = {
      authorization: `Bearer ${accessToken}`
    };
  }

  return out;
}
