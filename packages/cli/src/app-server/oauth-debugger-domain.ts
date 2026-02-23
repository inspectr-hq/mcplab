import type { ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { URL } from 'node:url';
import type { EvalConfig } from '@inspectr/mcplab-core';
import { addJobEvent } from './jobs.js';

type SessionStatus =
  | 'configuring'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_browser_callback'
  | 'completed'
  | 'error'
  | 'stopped';

type RegistrationMethod = 'pre_registered' | 'dcr' | 'cimd';

export interface OAuthDebuggerSessionConfigInput {
  profile: 'latest';
  target: {
    serverName: string;
    overrides?: {
      authorizationServerMetadataUrl?: string;
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      registrationEndpoint?: string;
      cimdUrl?: string;
      resourceBaseUrl?: string;
    };
  };
  registrationMethod: RegistrationMethod;
  clientConfig: {
    preRegistered?: {
      clientId: string;
      clientSecret?: string;
      tokenEndpointAuthMethod?: string;
    };
    dcr?: {
      metadata?: Record<string, unknown>;
      tokenEndpointAuthMethod?: string;
    };
    cimd?: {
      cimdUrl?: string;
      expectedClientId?: string;
    };
  };
  runtime: {
    redirectMode: 'local_callback' | 'manual';
    scopes?: string[];
    resource?: string;
    usePkce?: boolean;
    codeChallengeMethod?: 'S256';
    state?: string;
    nonce?: string;
    extraAuthParams?: Record<string, string>;
  };
  display?: {
    showSensitiveValues?: boolean;
  };
}

export interface OAuthNetworkExchange {
  id: string;
  stepId: string;
  kind: 'http';
  phase: 'request' | 'response';
  label: string;
  method?: string;
  url: string;
  headers: Record<string, string>;
  bodyText?: string;
  status?: number;
  durationMs?: number;
  timestamp: string;
  sensitiveFields?: Array<{ path: string; type: 'token' | 'secret' | 'authorization_header' }>;
}

export interface OAuthValidationFinding {
  id: string;
  stepId: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  title: string;
  detail: string;
  specReference?: string;
  recommendation?: string;
}

export interface OAuthDebuggerStepState {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  outcomeSummary?: string;
  teachableMoment?: string;
  networkExchangeIds: string[];
  validationIds: string[];
}

export interface OAuthSequenceEvent {
  id: string;
  ts: string;
  from: 'User' | 'Debugger' | 'Auth Server' | 'Token Endpoint' | 'MCP/Resource';
  to: 'User' | 'Debugger' | 'Auth Server' | 'Token Endpoint' | 'MCP/Resource';
  label: string;
  stepId?: string;
  networkExchangeId?: string;
}

export interface OAuthDebuggerSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  config: {
    profile: 'latest';
    target: OAuthDebuggerSessionConfigInput['target'];
    registrationMethod: RegistrationMethod;
    clientConfig: OAuthDebuggerSessionConfigInput['clientConfig'];
    runtime: Required<
      Pick<
        OAuthDebuggerSessionConfigInput['runtime'],
        'redirectMode' | 'usePkce' | 'codeChallengeMethod'
      >
    > &
      Omit<
        OAuthDebuggerSessionConfigInput['runtime'],
        'redirectMode' | 'usePkce' | 'codeChallengeMethod'
      >;
    display: {
      showSensitiveValues: boolean;
    };
  };
  steps: OAuthDebuggerStepState[];
  validations: OAuthValidationFinding[];
  network: OAuthNetworkExchange[];
  sequence: OAuthSequenceEvent[];
  events: Array<{ type: string; ts: string; payload: Record<string, unknown> }>;
  clients: Set<ServerResponse>;
  abortController: AbortController;
  serverConfig?: EvalConfig['servers'][string];
  context: {
    resourceMetadata?: any;
    authServerMetadata?: any;
    registration?: any;
    resolvedClient?: { clientId: string; clientSecret?: string; tokenEndpointAuthMethod?: string };
    pkce?: { verifier: string; challenge: string; method: 'S256' };
    authorizationRequestUrl?: string;
    callbackResult?: {
      rawUrl?: string;
      code?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
    };
    tokenResponse?: any;
    probeResponse?: { status: number; bodyText: string; url: string };
    callbackUrl?: string;
  };
}

export interface OAuthDebuggerSessionView {
  id: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  profile: 'latest';
  registrationMethod: RegistrationMethod;
  stepStates: OAuthDebuggerStepState[];
  validations: OAuthValidationFinding[];
  network: OAuthNetworkExchange[];
  networkSummary: { requestCount: number; errorCount: number };
  sequence: OAuthSequenceEvent[];
  uiHints: {
    nextAction?: 'start' | 'open_authorize_url' | 'paste_callback_url' | 'none';
    authorizationUrl?: string;
    callbackMode?: 'local_callback' | 'manual';
    callbackUrl?: string;
  };
  summary?: {
    issuer?: string;
    clientId?: string;
    redirectUri?: string;
    tokenEndpointStatus?: number;
    tokenType?: string;
    grantedScopes?: string[];
  };
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const SPEC_BASE = 'https://modelcontextprotocol.io/specification/draft/basic/authorization';

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toBase64Url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pkcePair() {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' as const };
}

function normalizeRuntime(
  runtime: OAuthDebuggerSessionConfigInput['runtime'] | undefined
): OAuthDebuggerSession['config']['runtime'] {
  return {
    redirectMode: runtime?.redirectMode ?? 'local_callback',
    usePkce: runtime?.usePkce !== false,
    codeChallengeMethod: 'S256',
    scopes: runtime?.scopes ?? [],
    resource: runtime?.resource,
    state: runtime?.state,
    nonce: runtime?.nonce,
    extraAuthParams: runtime?.extraAuthParams ?? {}
  };
}

function baseSteps(method: RegistrationMethod): OAuthDebuggerStepState[] {
  const steps: Array<[string, string, string]> = [
    [
      'resolve_target_metadata',
      'Resolve target metadata',
      'Resolve resource and authorization server metadata and endpoints.'
    ]
  ];
  if (method === 'cimd') {
    steps.push([
      'fetch_cimd',
      'Fetch + validate Client ID Metadata Document',
      'Fetch the client metadata document and validate required fields.'
    ]);
  } else {
    steps.push([
      'resolve_registration_source',
      'Resolve/validate client registration source',
      'Validate client information for the selected registration method.'
    ]);
  }
  if (method === 'dcr') {
    steps.push([
      'dynamic_client_registration',
      'Dynamic Client Registration',
      'Register a client dynamically and validate the registration response.'
    ]);
  }
  steps.push(
    [
      'build_authorization_request',
      'Build authorization request',
      'Construct the authorization request URL and validate parameters.'
    ],
    [
      'browser_authorization',
      'Browser authorization step',
      'Open the authorization URL and authenticate/authorize the client.'
    ],
    [
      'receive_authorization_response',
      'Receive authorization response',
      'Capture the redirect callback via local callback or manual paste.'
    ],
    [
      'validate_callback',
      'Validate state and callback semantics',
      'Validate state, code, and authorization response semantics.'
    ],
    [
      'token_exchange',
      'Token exchange',
      'Exchange authorization code for tokens and inspect the token response.'
    ],
    [
      'token_validation',
      'Token response validation',
      'Validate token response fields and protocol expectations.'
    ],
    [
      'resource_probe',
      'Protected resource / MCP probe',
      'Optionally call a protected endpoint with the access token.'
    ],
    [
      'summary',
      'Summary + compliance checks',
      'Summarize validations, failures, and remediation tips.'
    ]
  );
  return steps.map(([id, title, description]) => ({
    id,
    title,
    description,
    status: 'pending',
    networkExchangeIds: [],
    validationIds: []
  }));
}

function step(session: OAuthDebuggerSession, stepId: string): OAuthDebuggerStepState {
  const found = session.steps.find((s) => s.id === stepId);
  if (!found) throw new Error(`Unknown OAuth debugger step: ${stepId}`);
  return found;
}

function emitEvent(session: OAuthDebuggerSession, type: string, payload: Record<string, unknown>) {
  addJobEvent(session, {
    type,
    ts: nowIso(),
    payload
  });
}

function markStepStarted(session: OAuthDebuggerSession, stepId: string) {
  const s = step(session, stepId);
  if (s.status === 'completed' || s.status === 'failed') return;
  s.status = 'active';
  s.startedAt = s.startedAt ?? nowIso();
  session.updatedAt = Date.now();
  emitEvent(session, 'step_started', { stepId, title: s.title });
}

function markStepCompleted(session: OAuthDebuggerSession, stepId: string, outcomeSummary?: string) {
  const s = step(session, stepId);
  s.status = 'completed';
  s.finishedAt = nowIso();
  if (outcomeSummary) s.outcomeSummary = outcomeSummary;
  session.updatedAt = Date.now();
  emitEvent(session, 'step_completed', {
    stepId,
    title: s.title,
    outcomeSummary: outcomeSummary ?? null
  });
}

function markStepFailed(session: OAuthDebuggerSession, stepId: string, message: string) {
  const s = step(session, stepId);
  s.status = 'failed';
  s.finishedAt = nowIso();
  s.outcomeSummary = message;
  session.updatedAt = Date.now();
  emitEvent(session, 'step_failed', { stepId, title: s.title, message });
}

function markStepSkipped(session: OAuthDebuggerSession, stepId: string, reason: string) {
  const s = step(session, stepId);
  s.status = 'skipped';
  s.finishedAt = nowIso();
  s.outcomeSummary = reason;
}

function addValidation(session: OAuthDebuggerSession, finding: Omit<OAuthValidationFinding, 'id'>) {
  const id = makeId('ov');
  const full: OAuthValidationFinding = { id, ...finding };
  session.validations.push(full);
  const s = session.steps.find((stepItem) => stepItem.id === finding.stepId);
  if (s) s.validationIds.push(id);
  emitEvent(session, 'validation', {
    id,
    stepId: finding.stepId,
    severity: finding.severity,
    code: finding.code,
    title: finding.title
  });
  return full;
}

function addSequence(session: OAuthDebuggerSession, event: Omit<OAuthSequenceEvent, 'id' | 'ts'>) {
  session.sequence.push({ id: makeId('seq'), ts: nowIso(), ...event });
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function recordHttp(
  session: OAuthDebuggerSession,
  exchange: Omit<OAuthNetworkExchange, 'id' | 'kind' | 'timestamp'>
) {
  const id = makeId('http');
  const full: OAuthNetworkExchange = {
    id,
    kind: 'http',
    timestamp: nowIso(),
    ...exchange
  };
  session.network.push(full);
  const s = session.steps.find((stepItem) => stepItem.id === exchange.stepId);
  if (s) s.networkExchangeIds.push(id);
  emitEvent(session, full.phase === 'request' ? 'http_request' : 'http_response', {
    id: full.id,
    stepId: full.stepId,
    label: full.label,
    method: full.method ?? null,
    url: full.url,
    status: full.status ?? null
  });
  return full;
}

async function fetchWithTrace(params: {
  session: OAuthDebuggerSession;
  stepId: string;
  label: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  timeoutMs?: number;
}): Promise<{ response: Response; responseText: string; responseJson?: any }> {
  const {
    session,
    stepId,
    label,
    url,
    method = 'GET',
    headers = {},
    bodyText,
    timeoutMs = 15_000
  } = params;
  recordHttp(session, {
    stepId,
    phase: 'request',
    label,
    method,
    url,
    headers,
    bodyText,
    sensitiveFields: []
  });
  addSequence(session, {
    from: 'Debugger',
    to: label.toLowerCase().includes('token')
      ? 'Token Endpoint'
      : label.toLowerCase().includes('probe')
        ? 'MCP/Resource'
        : 'Auth Server',
    label,
    stepId
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: bodyText,
      signal: controller.signal
    });
    const responseText = await response.text();
    let responseJson: any;
    try {
      responseJson = responseText ? JSON.parse(responseText) : undefined;
    } catch {
      // non-json response
    }
    recordHttp(session, {
      stepId,
      phase: 'response',
      label,
      url,
      headers: headersToObject(response.headers),
      status: response.status,
      bodyText: responseText,
      durationMs: Date.now() - startedAt,
      sensitiveFields: []
    });
    return { response, responseText, responseJson };
  } finally {
    clearTimeout(timer);
  }
}

function requiredString(value: unknown, error: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(error);
  return text;
}

function inferResourceMetadataUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = '/.well-known/oauth-protected-resource';
  u.search = '';
  return u.toString();
}

function inferAuthServerMetadataUrl(issuerOrBase: string): string {
  const u = new URL(issuerOrBase);
  u.pathname = '/.well-known/oauth-authorization-server';
  u.search = '';
  return u.toString();
}

function localCallbackUrl(session: OAuthDebuggerSession, appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/api/oauth-debugger/sessions/${session.id}/callback`;
}

function buildAuthorizationUrl(session: OAuthDebuggerSession): string {
  const authEndpoint =
    session.config.target.overrides?.authorizationEndpoint ||
    session.context.authServerMetadata?.authorization_endpoint;
  if (!authEndpoint) throw new Error('Authorization endpoint not resolved');
  const resolvedClient = session.context.resolvedClient;
  if (!resolvedClient?.clientId) throw new Error('Client not resolved');
  const callbackUrl = requiredString(session.context.callbackUrl, 'Callback URL not set');
  const state = session.config.runtime.state || toBase64Url(randomBytes(16));
  session.config.runtime.state = state;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: resolvedClient.clientId,
    redirect_uri: callbackUrl,
    state
  });
  if ((session.config.runtime.scopes ?? []).length > 0) {
    params.set('scope', (session.config.runtime.scopes ?? []).join(' '));
  }
  if (session.config.runtime.resource) {
    params.set('resource', session.config.runtime.resource);
  }
  if (session.config.runtime.usePkce) {
    session.context.pkce = session.context.pkce ?? pkcePair();
    params.set('code_challenge', session.context.pkce.challenge);
    params.set('code_challenge_method', session.context.pkce.method);
  }
  if (session.config.runtime.nonce) params.set('nonce', session.config.runtime.nonce);
  for (const [key, value] of Object.entries(session.config.runtime.extraAuthParams ?? {})) {
    if (value != null && `${value}` !== '') params.set(key, String(value));
  }
  const url = new URL(authEndpoint);
  url.search = params.toString();
  session.context.authorizationRequestUrl = url.toString();
  return url.toString();
}

function parseCallbackInput(input: { redirectUrl?: string; code?: string; state?: string }) {
  if (input.redirectUrl) {
    const parsed = new URL(input.redirectUrl);
    return {
      rawUrl: input.redirectUrl,
      code: parsed.searchParams.get('code') ?? undefined,
      state: parsed.searchParams.get('state') ?? undefined,
      error: parsed.searchParams.get('error') ?? undefined,
      errorDescription: parsed.searchParams.get('error_description') ?? undefined
    };
  }
  return {
    code: input.code,
    state: input.state
  };
}

function resolvedClientFromConfig(session: OAuthDebuggerSession) {
  if (session.config.registrationMethod === 'pre_registered') {
    const c = session.config.clientConfig.preRegistered;
    if (!c?.clientId) throw new Error('pre-registered client_id is required');
    session.context.resolvedClient = {
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      tokenEndpointAuthMethod: c.tokenEndpointAuthMethod
    };
    return;
  }
  if (session.config.registrationMethod === 'cimd') {
    const reg = session.context.registration;
    const clientId = reg?.client_id ?? session.config.clientConfig.cimd?.expectedClientId;
    if (!clientId)
      throw new Error('CIMD did not provide client_id and no expectedClientId was set');
    session.context.resolvedClient = {
      clientId,
      tokenEndpointAuthMethod:
        reg?.token_endpoint_auth_method ?? session.config.clientConfig.cimd?.expectedClientId
    };
    return;
  }
  // dcr handled after registration call
}

async function stepResolveTargetMetadata(session: OAuthDebuggerSession) {
  const stepId = 'resolve_target_metadata';
  markStepStarted(session, stepId);
  const server = session.serverConfig;
  if (!server) throw new Error(`MCP server '${session.config.target.serverName}' not found`);
  const resourceMetadataUrl = session.config.target.overrides?.authorizationServerMetadataUrl
    ? undefined
    : inferResourceMetadataUrl(session.config.target.overrides?.resourceBaseUrl || server.url);
  if (resourceMetadataUrl) {
    try {
      const { response, responseJson, responseText } = await fetchWithTrace({
        session,
        stepId,
        label: 'Protected Resource Metadata',
        url: resourceMetadataUrl
      });
      if (!response.ok) {
        addValidation(session, {
          stepId,
          severity: 'warning',
          code: 'resource_metadata_fetch_failed',
          title: 'Resource metadata fetch failed',
          detail: `Protected resource metadata returned HTTP ${response.status}.`,
          recommendation:
            'Provide manual endpoint overrides or verify the protected resource metadata URL.'
        });
      } else {
        session.context.resourceMetadata = responseJson ?? { raw: responseText };
      }
    } catch (error: unknown) {
      addValidation(session, {
        stepId,
        severity: 'warning',
        code: 'resource_metadata_unreachable',
        title: 'Protected resource metadata unreachable',
        detail: error instanceof Error ? error.message : String(error),
        recommendation:
          'Check the MCP server URL and network connectivity, or use manual endpoint overrides.'
      });
    }
  }

  const authMetadataUrl =
    session.config.target.overrides?.authorizationServerMetadataUrl ||
    (session.context.resourceMetadata?.authorization_servers?.[0]
      ? inferAuthServerMetadataUrl(
          String(session.context.resourceMetadata.authorization_servers[0])
        )
      : session.context.resourceMetadata?.authorization_server
        ? inferAuthServerMetadataUrl(String(session.context.resourceMetadata.authorization_server))
        : undefined);

  if (authMetadataUrl) {
    const { response, responseJson, responseText } = await fetchWithTrace({
      session,
      stepId,
      label: 'Authorization Server Metadata',
      url: authMetadataUrl
    });
    if (!response.ok) {
      throw new Error(`Authorization server metadata request failed (${response.status})`);
    }
    session.context.authServerMetadata = responseJson ?? { raw: responseText };
  } else {
    session.context.authServerMetadata = {};
    addValidation(session, {
      stepId,
      severity: 'warning',
      code: 'auth_metadata_missing',
      title: 'Authorization metadata URL not discovered',
      detail:
        'Could not derive authorization server metadata URL automatically from the selected MCP server.',
      recommendation: 'Use Advanced overrides to set authorization/token/registration endpoints.'
    });
  }

  if (session.config.target.overrides?.authorizationEndpoint) {
    session.context.authServerMetadata = {
      ...(session.context.authServerMetadata ?? {}),
      authorization_endpoint: session.config.target.overrides.authorizationEndpoint
    };
  }
  if (session.config.target.overrides?.tokenEndpoint) {
    session.context.authServerMetadata = {
      ...(session.context.authServerMetadata ?? {}),
      token_endpoint: session.config.target.overrides.tokenEndpoint
    };
  }
  if (session.config.target.overrides?.registrationEndpoint) {
    session.context.authServerMetadata = {
      ...(session.context.authServerMetadata ?? {}),
      registration_endpoint: session.config.target.overrides.registrationEndpoint
    };
  }

  markStepCompleted(session, stepId, 'Metadata resolution finished');
}

async function stepResolveRegistrationSource(session: OAuthDebuggerSession) {
  const stepId = 'resolve_registration_source';
  if (!session.steps.some((s) => s.id === stepId)) return;
  markStepStarted(session, stepId);
  resolvedClientFromConfig(session);
  if (session.context.resolvedClient?.clientId) {
    markStepCompleted(
      session,
      stepId,
      `Client ${session.context.resolvedClient.clientId} resolved`
    );
    return;
  }
  markStepCompleted(session, stepId, 'Registration source deferred');
}

async function stepFetchCimd(session: OAuthDebuggerSession) {
  const stepId = 'fetch_cimd';
  if (!session.steps.some((s) => s.id === stepId)) return;
  markStepStarted(session, stepId);
  const cimdUrl =
    session.config.clientConfig.cimd?.cimdUrl || session.config.target.overrides?.cimdUrl;
  if (!cimdUrl) throw new Error('CIMD URL is required for CIMD registration method');
  const { response, responseJson, responseText } = await fetchWithTrace({
    session,
    stepId,
    label: 'Client ID Metadata Document',
    url: cimdUrl
  });
  if (!response.ok) {
    throw new Error(`CIMD request failed (${response.status})`);
  }
  session.context.registration = responseJson ?? { raw: responseText };
  const clientId = session.context.registration?.client_id;
  if (!clientId) {
    addValidation(session, {
      stepId,
      severity: 'error',
      code: 'cimd_missing_client_id',
      title: 'CIMD missing client_id',
      detail: 'The Client ID Metadata Document does not contain a client_id.',
      specReference: SPEC_BASE
    });
  }
  resolvedClientFromConfig(session);
  markStepCompleted(session, stepId, `Fetched CIMD${clientId ? ` for ${clientId}` : ''}`);
}

async function stepDcr(session: OAuthDebuggerSession) {
  const stepId = 'dynamic_client_registration';
  if (!session.steps.some((s) => s.id === stepId)) return;
  markStepStarted(session, stepId);
  const registrationEndpoint = session.context.authServerMetadata?.registration_endpoint;
  if (!registrationEndpoint) {
    throw new Error('Registration endpoint not available for DCR');
  }
  const redirectUri = requiredString(session.context.callbackUrl, 'Callback URL not set');
  const bodyObj = {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: session.config.clientConfig.dcr?.tokenEndpointAuthMethod ?? 'none',
    client_name: 'MCP Lab OAuth Debugger',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    ...(session.config.clientConfig.dcr?.metadata ?? {})
  };
  const bodyText = JSON.stringify(bodyObj);
  const { response, responseJson, responseText } = await fetchWithTrace({
    session,
    stepId,
    label: 'Dynamic Client Registration',
    url: String(registrationEndpoint),
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    bodyText
  });
  if (!response.ok) {
    throw new Error(`DCR failed (${response.status})`);
  }
  session.context.registration = responseJson ?? { raw: responseText };
  const clientId = session.context.registration?.client_id;
  if (!clientId) {
    throw new Error('DCR response missing client_id');
  }
  session.context.resolvedClient = {
    clientId: String(clientId),
    clientSecret:
      typeof session.context.registration?.client_secret === 'string'
        ? session.context.registration.client_secret
        : undefined,
    tokenEndpointAuthMethod:
      session.context.registration?.token_endpoint_auth_method ??
      session.config.clientConfig.dcr?.tokenEndpointAuthMethod
  };
  markStepCompleted(session, stepId, `DCR created client ${clientId}`);
}

async function stepBuildAuthorizationRequest(session: OAuthDebuggerSession) {
  const stepId = 'build_authorization_request';
  markStepStarted(session, stepId);
  const authUrl = buildAuthorizationUrl(session);
  addValidation(session, {
    stepId,
    severity: 'info',
    code: 'auth_url_built',
    title: 'Authorization request constructed',
    detail: 'Authorization request URL was built successfully.',
    specReference: SPEC_BASE
  });
  markStepCompleted(session, stepId, authUrl);
}

async function stepBrowserAuthorizationPause(session: OAuthDebuggerSession) {
  const stepId = 'browser_authorization';
  markStepStarted(session, stepId);
  const authUrl = session.context.authorizationRequestUrl;
  if (!authUrl) throw new Error('Authorization URL not built');
  addSequence(session, {
    from: 'User',
    to: 'Auth Server',
    label: 'Open authorization URL',
    stepId
  });
  if (session.config.runtime.redirectMode === 'manual') {
    session.status = 'waiting_for_user';
    emitEvent(session, 'waiting_for_user', {
      stepId,
      nextAction: 'paste_callback_url',
      authorizationUrl: authUrl
    });
    markStepCompleted(session, stepId, 'Waiting for manual callback paste');
  } else {
    session.status = 'waiting_for_browser_callback';
    emitEvent(session, 'waiting_for_browser_callback', {
      stepId,
      nextAction: 'open_authorize_url',
      authorizationUrl: authUrl,
      callbackUrl: session.context.callbackUrl ?? null
    });
    markStepCompleted(session, stepId, 'Waiting for browser callback');
  }
}

function stepReceiveAuthorizationResponse(session: OAuthDebuggerSession) {
  const stepId = 'receive_authorization_response';
  markStepStarted(session, stepId);
  if (!session.context.callbackResult) {
    throw new Error('No authorization response callback captured');
  }
  markStepCompleted(session, stepId, 'Authorization response captured');
}

function stepValidateCallback(session: OAuthDebuggerSession) {
  const stepId = 'validate_callback';
  markStepStarted(session, stepId);
  const cb = session.context.callbackResult;
  if (!cb) throw new Error('No callback result');
  if (cb.error) {
    addValidation(session, {
      stepId,
      severity: 'error',
      code: 'authorization_error',
      title: 'Authorization server returned an error',
      detail: `${cb.error}${cb.errorDescription ? `: ${cb.errorDescription}` : ''}`,
      recommendation:
        'Inspect the authorization request parameters and client registration details.'
    });
    throw new Error(`Authorization error: ${cb.error}`);
  }
  if (!cb.code) {
    addValidation(session, {
      stepId,
      severity: 'error',
      code: 'missing_code',
      title: 'Missing authorization code',
      detail: 'The callback did not include an authorization code.',
      specReference: SPEC_BASE
    });
    throw new Error('Authorization code missing from callback');
  }
  if (session.config.runtime.state && cb.state !== session.config.runtime.state) {
    addValidation(session, {
      stepId,
      severity: 'error',
      code: 'state_mismatch',
      title: 'State mismatch',
      detail: `Expected state '${session.config.runtime.state}' but received '${cb.state ?? ''}'.`,
      recommendation:
        'Verify redirect handling and ensure the authorization response belongs to this session.'
    });
    throw new Error('State mismatch');
  }
  addValidation(session, {
    stepId,
    severity: 'info',
    code: 'callback_validated',
    title: 'Authorization callback validated',
    detail: 'Authorization code and state semantics look valid.',
    specReference: SPEC_BASE
  });
  markStepCompleted(session, stepId, 'Callback validation passed');
}

async function stepTokenExchange(session: OAuthDebuggerSession) {
  const stepId = 'token_exchange';
  markStepStarted(session, stepId);
  const tokenEndpoint = session.context.authServerMetadata?.token_endpoint;
  if (!tokenEndpoint) throw new Error('Token endpoint not resolved');
  const client = session.context.resolvedClient;
  if (!client?.clientId) throw new Error('Client not resolved');
  const cb = session.context.callbackResult;
  if (!cb?.code) throw new Error('Authorization code missing');
  const redirectUri = requiredString(session.context.callbackUrl, 'Callback URL not set');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: cb.code,
    redirect_uri: redirectUri,
    client_id: client.clientId
  });
  if (session.config.runtime.usePkce && session.context.pkce?.verifier) {
    form.set('code_verifier', session.context.pkce.verifier);
  }
  if (session.config.runtime.resource) form.set('resource', session.config.runtime.resource);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json'
  };
  if (client.clientSecret) {
    const authMethod = client.tokenEndpointAuthMethod ?? 'client_secret_basic';
    if (authMethod === 'client_secret_post') {
      form.set('client_secret', client.clientSecret);
    } else {
      headers.authorization = `Basic ${Buffer.from(
        `${client.clientId}:${client.clientSecret}`,
        'utf8'
      ).toString('base64')}`;
    }
  }
  const { response, responseJson, responseText } = await fetchWithTrace({
    session,
    stepId,
    label: 'Token request',
    url: String(tokenEndpoint),
    method: 'POST',
    headers,
    bodyText: form.toString()
  });
  session.context.tokenResponse = responseJson ?? { raw: responseText, status: response.status };
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status})`);
  }
  markStepCompleted(session, stepId, `Token response HTTP ${response.status}`);
}

function stepTokenValidation(session: OAuthDebuggerSession) {
  const stepId = 'token_validation';
  markStepStarted(session, stepId);
  const token = session.context.tokenResponse;
  if (!token || typeof token !== 'object') throw new Error('Token response missing');
  if (!('access_token' in token)) {
    addValidation(session, {
      stepId,
      severity: 'error',
      code: 'token_missing_access_token',
      title: 'Token response missing access_token',
      detail: 'Token endpoint response did not include access_token.',
      recommendation: 'Inspect token endpoint response and OAuth server configuration.'
    });
    throw new Error('Token response missing access_token');
  }
  if (!('token_type' in token)) {
    addValidation(session, {
      stepId,
      severity: 'warning',
      code: 'token_missing_token_type',
      title: 'Token response missing token_type',
      detail: 'Token response did not include token_type.',
      recommendation: 'Most clients expect token_type (typically Bearer).'
    });
  }
  addValidation(session, {
    stepId,
    severity: 'info',
    code: 'token_response_validated',
    title: 'Token response validated',
    detail: 'Token response includes access_token and basic fields.',
    specReference: SPEC_BASE
  });
  markStepCompleted(session, stepId, 'Token validation complete');
}

async function stepResourceProbe(session: OAuthDebuggerSession) {
  const stepId = 'resource_probe';
  markStepStarted(session, stepId);
  const accessToken =
    typeof session.context.tokenResponse?.access_token === 'string'
      ? session.context.tokenResponse.access_token
      : undefined;
  const probeUrl = session.config.target.overrides?.resourceBaseUrl || session.serverConfig?.url;
  if (!accessToken || !probeUrl) {
    markStepSkipped(session, stepId, 'No access token or probe URL available');
    emitEvent(session, 'log', {
      message: 'Skipping protected probe (missing access token or probe URL)'
    });
    return;
  }
  try {
    const { response, responseText } = await fetchWithTrace({
      session,
      stepId,
      label: 'Protected resource probe',
      url: probeUrl,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json'
      }
    });
    session.context.probeResponse = {
      status: response.status,
      bodyText: responseText,
      url: probeUrl
    };
    if (!response.ok) {
      addValidation(session, {
        stepId,
        severity: 'warning',
        code: 'probe_not_ok',
        title: 'Protected probe returned non-success',
        detail: `Protected probe returned HTTP ${response.status}.`,
        recommendation:
          'Verify audience/resource, scopes, and token issuer expectations on the MCP server.'
      });
    } else {
      addValidation(session, {
        stepId,
        severity: 'info',
        code: 'probe_ok',
        title: 'Protected probe succeeded',
        detail: 'The bearer token was accepted by the probe endpoint.'
      });
    }
    markStepCompleted(session, stepId, `Probe HTTP ${response.status}`);
  } catch (error: unknown) {
    addValidation(session, {
      stepId,
      severity: 'warning',
      code: 'probe_failed',
      title: 'Protected probe failed',
      detail: error instanceof Error ? error.message : String(error),
      recommendation:
        'If this endpoint is not a protected HTTP resource, ignore this warning or override resourceBaseUrl.'
    });
    markStepCompleted(session, stepId, 'Probe failed (captured as warning)');
  }
}

function stepSummary(session: OAuthDebuggerSession) {
  const stepId = 'summary';
  markStepStarted(session, stepId);
  const hasErrors = session.validations.some((v) => v.severity === 'error');
  if (hasErrors) {
    addValidation(session, {
      stepId,
      severity: 'info',
      code: 'summary_failed',
      title: 'OAuth debugger summary',
      detail: 'One or more blocking validation errors were found.',
      recommendation: 'Review failed steps and network exchanges to identify the protocol mismatch.'
    });
  } else {
    addValidation(session, {
      stepId,
      severity: 'info',
      code: 'summary_ok',
      title: 'OAuth debugger summary',
      detail: 'Flow completed without blocking validation errors.'
    });
  }
  markStepCompleted(
    session,
    stepId,
    hasErrors ? 'Completed with validation errors' : 'Completed successfully'
  );
}

function resetPendingStepStatesForResume(session: OAuthDebuggerSession) {
  // no-op for now; step runner checks status
}

function nextPendingStep(session: OAuthDebuggerSession): OAuthDebuggerStepState | undefined {
  return session.steps.find((s) => s.status === 'pending');
}

export function cleanupOAuthDebuggerSessions(
  sessions: Map<string, OAuthDebuggerSession>,
  now = Date.now()
) {
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function createOAuthDebuggerSession(params: {
  config: OAuthDebuggerSessionConfigInput;
  serverConfig?: EvalConfig['servers'][string];
}): OAuthDebuggerSession {
  const runtime = normalizeRuntime(params.config.runtime);
  const serverOauth =
    params.serverConfig?.auth?.type === 'oauth_authorization_code'
      ? params.serverConfig.auth
      : undefined;
  const clientConfig: OAuthDebuggerSessionConfigInput['clientConfig'] =
    params.config.registrationMethod === 'pre_registered'
      ? {
          ...params.config.clientConfig,
          preRegistered: {
            clientId:
              params.config.clientConfig.preRegistered?.clientId || serverOauth?.client_id || '',
            clientSecret:
              params.config.clientConfig.preRegistered?.clientSecret ?? serverOauth?.client_secret,
            tokenEndpointAuthMethod:
              params.config.clientConfig.preRegistered?.tokenEndpointAuthMethod
          }
        }
      : params.config.clientConfig;
  const session: OAuthDebuggerSession = {
    id: makeId('oauthdbg'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'configuring',
    config: {
      profile: 'latest',
      target: params.config.target,
      registrationMethod: params.config.registrationMethod,
      clientConfig,
      runtime: {
        ...runtime,
        scopes:
          runtime.scopes && runtime.scopes.length > 0
            ? runtime.scopes
            : serverOauth?.scope
              ? serverOauth.scope.split(/\s+/).filter(Boolean)
              : []
      },
      display: {
        showSensitiveValues: params.config.display?.showSensitiveValues !== false
      }
    },
    steps: baseSteps(params.config.registrationMethod),
    validations: [],
    network: [],
    sequence: [],
    events: [],
    clients: new Set(),
    abortController: new AbortController(),
    serverConfig: params.serverConfig,
    context: {}
  };
  return session;
}

export function oauthDebuggerSessionView(session: OAuthDebuggerSession): OAuthDebuggerSessionView {
  const errorCount = session.network.filter(
    (n) => n.phase === 'response' && typeof n.status === 'number' && n.status >= 400
  ).length;
  const token =
    session.context.tokenResponse && typeof session.context.tokenResponse === 'object'
      ? (session.context.tokenResponse as Record<string, unknown>)
      : undefined;
  return {
    id: session.id,
    status: session.status,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    profile: session.config.profile,
    registrationMethod: session.config.registrationMethod,
    stepStates: session.steps,
    validations: session.validations,
    network: session.network,
    networkSummary: {
      requestCount: session.network.filter((n) => n.phase === 'request').length,
      errorCount
    },
    sequence: session.sequence,
    uiHints: {
      nextAction:
        session.status === 'configuring'
          ? 'start'
          : session.status === 'waiting_for_user'
            ? 'paste_callback_url'
            : session.status === 'waiting_for_browser_callback'
              ? 'open_authorize_url'
              : 'none',
      authorizationUrl: session.context.authorizationRequestUrl,
      callbackMode: session.config.runtime.redirectMode,
      callbackUrl: session.context.callbackUrl
    },
    summary: {
      issuer:
        session.context.authServerMetadata?.issuer ?? session.context.resourceMetadata?.issuer,
      clientId: session.context.resolvedClient?.clientId,
      redirectUri: session.context.callbackUrl,
      tokenEndpointStatus: session.network
        .filter((n) => n.label === 'Token request' && n.phase === 'response')
        .slice(-1)[0]?.status,
      tokenType: typeof token?.token_type === 'string' ? token.token_type : undefined,
      grantedScopes:
        typeof token?.scope === 'string'
          ? String(token.scope).split(/\s+/).filter(Boolean)
          : undefined
    }
  };
}

export async function startOrResumeOAuthDebuggerSession(params: {
  session: OAuthDebuggerSession;
  appBaseUrl: string;
}) {
  const { session, appBaseUrl } = params;
  if (session.status === 'stopped') throw new Error('Session already stopped');
  session.updatedAt = Date.now();
  session.context.callbackUrl = localCallbackUrl(session, appBaseUrl);
  if (session.status === 'configuring') {
    emitEvent(session, 'started', {
      sessionId: session.id,
      registrationMethod: session.config.registrationMethod,
      profile: session.config.profile
    });
  }
  session.status = 'running';
  resetPendingStepStatesForResume(session);

  while (true) {
    if (session.abortController.signal.aborted) {
      session.status = 'stopped';
      emitEvent(session, 'stopped', { message: 'OAuth debug session stopped by user' });
      return;
    }

    const pending = nextPendingStep(session);
    if (!pending) {
      session.status = 'completed';
      emitEvent(session, 'completed', {
        summary: oauthDebuggerSessionView(session).summary ?? null
      });
      return;
    }
    try {
      switch (pending.id) {
        case 'resolve_target_metadata':
          await stepResolveTargetMetadata(session);
          break;
        case 'resolve_registration_source':
          await stepResolveRegistrationSource(session);
          break;
        case 'fetch_cimd':
          await stepFetchCimd(session);
          break;
        case 'dynamic_client_registration':
          await stepDcr(session);
          break;
        case 'build_authorization_request':
          await stepBuildAuthorizationRequest(session);
          break;
        case 'browser_authorization':
          await stepBrowserAuthorizationPause(session);
          return;
        case 'receive_authorization_response':
          if (!session.context.callbackResult) {
            session.status =
              session.config.runtime.redirectMode === 'manual'
                ? 'waiting_for_user'
                : 'waiting_for_browser_callback';
            return;
          }
          stepReceiveAuthorizationResponse(session);
          break;
        case 'validate_callback':
          stepValidateCallback(session);
          break;
        case 'token_exchange':
          await stepTokenExchange(session);
          break;
        case 'token_validation':
          stepTokenValidation(session);
          break;
        case 'resource_probe':
          await stepResourceProbe(session);
          break;
        case 'summary':
          stepSummary(session);
          break;
        default:
          markStepSkipped(session, pending.id, 'Unsupported step in v1');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      markStepFailed(session, pending.id, message);
      session.status = 'error';
      emitEvent(session, 'error', { message });
      return;
    }
  }
}

export function submitManualCallbackToSession(params: {
  session: OAuthDebuggerSession;
  redirectUrl?: string;
  code?: string;
  state?: string;
}) {
  const parsed = parseCallbackInput({
    redirectUrl: params.redirectUrl,
    code: params.code,
    state: params.state
  });
  params.session.context.callbackResult = parsed;
  params.session.updatedAt = Date.now();
  emitEvent(params.session, 'log', {
    message: 'Manual callback input received.'
  });
}

export function submitBrowserCallbackToSession(params: {
  session: OAuthDebuggerSession;
  rawUrl: string;
}) {
  params.session.context.callbackResult = parseCallbackInput({ redirectUrl: params.rawUrl });
  params.session.updatedAt = Date.now();
  emitEvent(params.session, 'log', { message: 'Browser callback captured.' });
}

export function stopOAuthDebuggerSession(session: OAuthDebuggerSession) {
  if (
    session.status === 'running' ||
    session.status === 'waiting_for_user' ||
    session.status === 'waiting_for_browser_callback'
  ) {
    session.abortController.abort();
    session.status = 'stopped';
    session.updatedAt = Date.now();
    emitEvent(session, 'stopped', { message: 'Stop requested by user' });
  }
}

export function oauthDebuggerExportMarkdown(session: OAuthDebuggerSession): string {
  const view = oauthDebuggerSessionView(session);
  const lines: string[] = [];
  lines.push('# OAuth Debugger Report');
  lines.push('');
  lines.push(`- Session ID: ${view.id}`);
  lines.push(`- Status: ${view.status}`);
  lines.push(`- Profile: ${view.profile}`);
  lines.push(`- Registration method: ${view.registrationMethod}`);
  lines.push(`- Target MCP server: ${session.config.target.serverName}`);
  lines.push('');
  lines.push('## Steps');
  for (const s of view.stepStates) {
    lines.push(`- ${s.title}: ${s.status}${s.outcomeSummary ? ` — ${s.outcomeSummary}` : ''}`);
  }
  lines.push('');
  lines.push('## Findings');
  if (view.validations.length === 0) {
    lines.push('- No validation findings recorded.');
  } else {
    for (const v of view.validations) {
      lines.push(`- [${v.severity}] (${v.stepId}) ${v.title}: ${v.detail}`);
      if (v.recommendation) lines.push(`  - Recommendation: ${v.recommendation}`);
    }
  }
  lines.push('');
  lines.push('## Network');
  for (const n of view.network.filter((e) => e.phase === 'response')) {
    lines.push(`- ${n.label}: ${n.status ?? '-'} ${n.url}`);
  }
  return `${lines.join('\n')}\n`;
}

export function oauthDebuggerExportRawTrace(session: OAuthDebuggerSession): string {
  const lines: string[] = [];
  for (const ex of session.network) {
    if (ex.phase === 'request') {
      lines.push(`> ${ex.label}`);
      lines.push(`> ${ex.method ?? 'GET'} ${ex.url}`);
      for (const [k, v] of Object.entries(ex.headers)) lines.push(`> ${k}: ${v}`);
      if (ex.bodyText) lines.push(`>\n${ex.bodyText}`);
    } else {
      lines.push(`< ${ex.label}`);
      lines.push(`< ${ex.status ?? '-'} ${ex.url}`);
      for (const [k, v] of Object.entries(ex.headers)) lines.push(`< ${k}: ${v}`);
      if (ex.bodyText) lines.push(`<\n${ex.bodyText}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
