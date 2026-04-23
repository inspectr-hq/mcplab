import type { EvalConfig } from '@inspectr/mcplab-core';
import type { OAuthDebuggerSessionsMap, OAuthRuntimeSessionsMap } from './app-context.js';
import { readLibraries } from './libraries-store.js';
import {
  createOAuthRuntimeSession,
  oauthRuntimeSessionView,
  type OAuthRuntimeSessionView
} from './oauth-runtime-domain.js';

const DEFAULT_REFRESH_SKEW_MS = 60_000;

type OAuthServerConfig = EvalConfig['servers'][string] & {
  auth?: { type?: string };
};

interface OAuthTokenState {
  serverName: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post';
  runtimeSessionId?: string;
  runtimeTokenSyncedFromSessionId?: string;
  runtimeTokenSyncedFromDebuggerUpdatedAt?: number;
  ensurePromise?: Promise<OAuthEnsureServerResult>;
  refreshPromise?: Promise<boolean>;
}

export interface OAuthEnsureServerResult {
  serverName: string;
  status: 'ready' | 'auth_required' | 'not_oauth';
  debugState?: 'reused' | 'refreshed' | 'auth_required' | 'not_oauth';
  tokenExpiresAt?: string;
  tokenExpiresInSeconds?: number;
  runtimeSessionId?: string;
  authorizationUrl?: string;
  authorizeLaunchUrl?: string;
  message?: string;
}

export interface OAuthEnsureServersResponse {
  servers: OAuthEnsureServerResult[];
  allReady: boolean;
}

export interface OAuthAuthRequiredDetail {
  serverName: string;
  runtimeSessionId?: string;
  authorizationUrl?: string;
  authorizeLaunchUrl?: string;
  message: string;
}

export class OAuthAuthorizationRequiredError extends Error {
  readonly details: OAuthAuthRequiredDetail[];

  constructor(details: OAuthAuthRequiredDetail[]) {
    const first = details[0]?.message || 'OAuth authorization required';
    super(first);
    this.name = 'OAuthAuthorizationRequiredError';
    this.details = details;
  }
}

function parseExpiresAt(tokenResponse: Record<string, unknown> | undefined): number | undefined {
  if (!tokenResponse) return undefined;
  const raw = tokenResponse.expires_in;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Date.now() + raw * 1000;
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Date.now() + parsed * 1000;
    }
  }
  return undefined;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function tokenExpiryView(state: OAuthTokenState): {
  tokenExpiresAt?: string;
  tokenExpiresInSeconds?: number;
} {
  if (!state.expiresAt) return {};
  return {
    tokenExpiresAt: new Date(state.expiresAt).toISOString(),
    tokenExpiresInSeconds: Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000))
  };
}

export class OAuthSessionManager {
  private states = new Map<string, OAuthTokenState>();

  constructor(
    private readonly params: {
      librariesDir: string;
      runtimeSessions: OAuthRuntimeSessionsMap;
      oauthDebuggerSessions: OAuthDebuggerSessionsMap;
      refreshSkewMs?: number;
    }
  ) {}

  setLibrariesDir(next: string): void {
    this.params.librariesDir = next;
  }

  private get refreshSkewMs(): number {
    return this.params.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  private getServerConfig(serverName: string): OAuthServerConfig | undefined {
    const libraries = readLibraries(this.params.librariesDir);
    return libraries.servers[serverName] as OAuthServerConfig | undefined;
  }

  private getState(serverName: string): OAuthTokenState {
    const existing = this.states.get(serverName);
    if (existing) return existing;
    const created: OAuthTokenState = { serverName };
    this.states.set(serverName, created);
    return created;
  }

  private updateStateFromTokenPayload(
    state: OAuthTokenState,
    tokenResponse: Record<string, unknown>
  ): void {
    const accessToken =
      typeof tokenResponse.access_token === 'string' ? tokenResponse.access_token : undefined;
    if (!accessToken) return;
    state.accessToken = accessToken;
    if (typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token.trim()) {
      state.refreshToken = tokenResponse.refresh_token;
    }
    if (typeof tokenResponse.token_type === 'string' && tokenResponse.token_type.trim()) {
      state.tokenType = tokenResponse.token_type;
    }
    if (typeof tokenResponse.scope === 'string') {
      state.scope = tokenResponse.scope;
    }
    const expiresAt = parseExpiresAt(tokenResponse);
    if (expiresAt) {
      state.expiresAt = expiresAt;
    } else {
      delete state.expiresAt;
    }
  }

  private syncStateFromRuntimeSession(state: OAuthTokenState): void {
    const runtimeSessionId = state.runtimeSessionId;
    if (!runtimeSessionId) return;
    const runtimeSession = this.params.runtimeSessions.get(runtimeSessionId);
    if (!runtimeSession || runtimeSession.serverName !== state.serverName) {
      delete state.runtimeSessionId;
      return;
    }
    const debuggerSession = this.params.oauthDebuggerSessions.get(
      runtimeSession.oauthDebuggerSessionId
    );
    if (!debuggerSession) return;
    const tokenResponse = debuggerSession.context.tokenResponse;
    if (
      tokenResponse &&
      typeof tokenResponse === 'object' &&
      (!state.accessToken ||
        state.runtimeTokenSyncedFromSessionId !== runtimeSessionId ||
        (debuggerSession.updatedAt ?? 0) > (state.runtimeTokenSyncedFromDebuggerUpdatedAt ?? 0))
    ) {
      this.updateStateFromTokenPayload(state, tokenResponse as Record<string, unknown>);
      state.runtimeTokenSyncedFromSessionId = runtimeSessionId;
      state.runtimeTokenSyncedFromDebuggerUpdatedAt = debuggerSession.updatedAt;
    }
    const tokenEndpoint = debuggerSession.context.authServerMetadata?.token_endpoint;
    if (typeof tokenEndpoint === 'string' && tokenEndpoint.trim()) {
      state.tokenEndpoint = tokenEndpoint;
    }
    const resolvedClient = debuggerSession.context.resolvedClient;
    if (resolvedClient?.clientId) {
      state.clientId = resolvedClient.clientId;
      state.clientSecret = resolvedClient.clientSecret;
      const authMethod = resolvedClient.tokenEndpointAuthMethod;
      if (authMethod === 'client_secret_post' || authMethod === 'client_secret_basic') {
        state.tokenEndpointAuthMethod = authMethod;
      }
    }
  }

  private tokenExpiredOrNearExpiry(state: OAuthTokenState): boolean {
    if (!state.accessToken) return true;
    if (!state.expiresAt) return false;
    return state.expiresAt <= Date.now() + this.refreshSkewMs;
  }

  async refreshIfNeeded(serverName: string): Promise<boolean> {
    const state = this.getState(serverName);
    this.syncStateFromRuntimeSession(state);
    if (!this.tokenExpiredOrNearExpiry(state)) return true;
    if (!state.accessToken) return false;
    if (!state.refreshToken) return false;
    if (!state.tokenEndpoint || !state.clientId) return false;

    if (state.refreshPromise) return state.refreshPromise;

    state.refreshPromise = (async () => {
      try {
        const form = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: state.refreshToken!,
          client_id: state.clientId!
        });
        const headers: Record<string, string> = {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        };

        if (state.clientSecret) {
          const method = state.tokenEndpointAuthMethod ?? 'client_secret_basic';
          if (method === 'client_secret_post') {
            form.set('client_secret', state.clientSecret);
          } else {
            headers.authorization = `Basic ${Buffer.from(
              `${state.clientId}:${state.clientSecret}`,
              'utf8'
            ).toString('base64')}`;
          }
        }

        const response = await fetch(state.tokenEndpoint!, {
          method: 'POST',
          headers,
          body: form.toString()
        });
        const text = await response.text();
        let json: Record<string, unknown> | undefined;
        try {
          json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
        } catch {
          json = undefined;
        }
        if (!response.ok || !json) return false;
        this.updateStateFromTokenPayload(state, json);
        return Boolean(state.accessToken);
      } catch {
        return false;
      } finally {
        state.refreshPromise = undefined;
      }
    })();

    return state.refreshPromise;
  }

  private getExistingRuntimeView(state: OAuthTokenState): OAuthRuntimeSessionView | undefined {
    if (!state.runtimeSessionId) return undefined;
    const runtimeSession = this.params.runtimeSessions.get(state.runtimeSessionId);
    if (!runtimeSession || runtimeSession.serverName !== state.serverName) {
      delete state.runtimeSessionId;
      return undefined;
    }
    return oauthRuntimeSessionView({
      runtimeSession,
      oauthDebuggerSessions: this.params.oauthDebuggerSessions
    });
  }

  async ensureServerAuthorized(
    serverName: string,
    hostHeader?: string
  ): Promise<OAuthEnsureServerResult> {
    const serverConfig = this.getServerConfig(serverName);
    if (!serverConfig) {
      return {
        serverName,
        status: 'auth_required',
        debugState: 'auth_required',
        message: `Server '${serverName}' not found in libraries`
      };
    }
    if (serverConfig.auth?.type !== 'oauth_authorization_code') {
      return { serverName, status: 'not_oauth', debugState: 'not_oauth' };
    }

    const state = this.getState(serverName);
    if (state.ensurePromise) return state.ensurePromise;

    state.ensurePromise = (async () => {
      this.syncStateFromRuntimeSession(state);
      if (state.accessToken) {
        const wasNearExpiry = this.tokenExpiredOrNearExpiry(state);
        const refreshed = wasNearExpiry ? await this.refreshIfNeeded(serverName) : true;
        if (refreshed && state.accessToken && !this.tokenExpiredOrNearExpiry(state)) {
          return {
            serverName,
            status: 'ready',
            debugState: wasNearExpiry ? 'refreshed' : 'reused',
            ...tokenExpiryView(state)
          };
        }
      }

      const existing = this.getExistingRuntimeView(state);
      if (existing && existing.status !== 'error' && existing.status !== 'stopped') {
        if (existing.status === 'completed' && existing.hasAccessToken) {
          this.syncStateFromRuntimeSession(state);
          if (state.accessToken) {
            const wasNearExpiry = this.tokenExpiredOrNearExpiry(state);
            const refreshed = wasNearExpiry ? await this.refreshIfNeeded(serverName) : true;
            if (refreshed && state.accessToken) {
              return {
                serverName,
                status: 'ready',
                debugState: wasNearExpiry ? 'refreshed' : 'reused',
                ...tokenExpiryView(state)
              };
            }
          }
        }
        return {
          serverName,
          status: 'auth_required',
          debugState: 'auth_required',
          runtimeSessionId: existing.id,
          authorizationUrl: existing.authorizationUrl,
          authorizeLaunchUrl: existing.authorizeLaunchUrl,
          message: `OAuth login required for server '${serverName}'.`
        };
      }

      const created = await createOAuthRuntimeSession({
        serverName,
        hostHeader,
        librariesDir: this.params.librariesDir,
        runtimeSessions: this.params.runtimeSessions,
        oauthDebuggerSessions: this.params.oauthDebuggerSessions
      });
      state.runtimeSessionId = created.id;
      return {
        serverName,
        status: 'auth_required',
        debugState: 'auth_required',
        runtimeSessionId: created.id,
        authorizationUrl: created.authorizationUrl,
        authorizeLaunchUrl: created.authorizeLaunchUrl,
        message: `OAuth login required for server '${serverName}'.`
      };
    })();

    try {
      return await state.ensurePromise;
    } finally {
      state.ensurePromise = undefined;
    }
  }

  async ensureServersAuthorized(
    serverNames: string[],
    hostHeader?: string
  ): Promise<OAuthEnsureServersResponse> {
    const uniqueNames = Array.from(new Set(serverNames.filter(Boolean)));
    const servers: OAuthEnsureServerResult[] = [];
    for (const serverName of uniqueNames) {
      servers.push(await this.ensureServerAuthorized(serverName, hostHeader));
    }
    return {
      servers,
      allReady: servers.every(
        (server) => server.status === 'ready' || server.status === 'not_oauth'
      )
    };
  }

  async getAuthHeadersForServers(
    serverNames: string[],
    hostHeader?: string
  ): Promise<Record<string, Record<string, string>>> {
    const uniqueNames = Array.from(new Set(serverNames.filter(Boolean)));
    const headers: Record<string, Record<string, string>> = {};
    const authRequired: OAuthAuthRequiredDetail[] = [];

    for (const serverName of uniqueNames) {
      const result = await this.ensureServerAuthorized(serverName, hostHeader);
      if (result.status === 'not_oauth') continue;
      if (result.status === 'auth_required') {
        authRequired.push({
          serverName,
          runtimeSessionId: result.runtimeSessionId,
          authorizationUrl: result.authorizationUrl,
          authorizeLaunchUrl: result.authorizeLaunchUrl,
          message: result.message || `OAuth login required for server '${serverName}'.`
        });
        continue;
      }
      const state = this.getState(serverName);
      this.syncStateFromRuntimeSession(state);
      if (!state.accessToken) {
        authRequired.push({
          serverName,
          runtimeSessionId: state.runtimeSessionId,
          message: `OAuth login required for server '${serverName}'.`
        });
        continue;
      }
      headers[serverName] = bearer(state.accessToken);
    }

    if (authRequired.length > 0) {
      throw new OAuthAuthorizationRequiredError(authRequired);
    }

    return headers;
  }

  noteRuntimeSession(serverName: string, runtimeSessionId: string): void {
    const state = this.getState(serverName);
    if (state.runtimeSessionId !== runtimeSessionId) {
      delete state.runtimeTokenSyncedFromSessionId;
      delete state.runtimeTokenSyncedFromDebuggerUpdatedAt;
    }
    state.runtimeSessionId = runtimeSessionId;
  }
}
