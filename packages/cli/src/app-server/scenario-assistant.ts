import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join } from 'node:path';
import {
  McpClientManager,
  loadConfig,
  type AgentConfig,
  type EvalConfig,
  throwIfAborted
} from '@inspectr/mcplab-core';
import type {
  AppRouteDeps,
  AppRouteRequestContext,
  ScenarioAssistantSessionsMap
} from './app-context.js';
import {
  createScenarioAssistantRuntimeDefinition,
  type ScenarioAssistantSession
} from './scenario-assistant-domain.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
import {
  broadcastAssistantSseEvent,
  createAssistantSseEvent,
  endAssistantSseClients,
  createAssistantRequestAbortController,
  serveAssistantSseStream,
  type AssistantSseEventType
} from './assistant-events.js';
import { createAssistantRuntimeService } from './assistant-service.js';

export type ScenarioAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'cleanupScenarioAssistantSessions'
  | 'touchScenarioAssistantSession'
  | 'scenarioAssistantSessionView'
  | 'ensureInsideRoot'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromConfig'
  | 'resolveAssistantAgentFromLibraries'
  | 'preloadScenarioAssistantTools'
  | 'assistantRuntimeFactory'
>;

export async function handleScenarioAssistantRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  assistantSessions: ScenarioAssistantSessionsMap;
  oauthSessionManager: OAuthSessionManager;
  deps: ScenarioAssistantRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, assistantSessions, oauthSessionManager, deps } =
    params;
  const {
    parseBody,
    asJson,
    cleanupScenarioAssistantSessions,
    touchScenarioAssistantSession,
    scenarioAssistantSessionView,
    ensureInsideRoot,
    readLibraries,
    pickDefaultAssistantAgentName,
    resolveAssistantAgentFromConfig,
    resolveAssistantAgentFromLibraries,
    preloadScenarioAssistantTools,
    assistantRuntimeFactory
  } = deps;

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
  type SessionContext = ScenarioAssistantSession['context'];
  const publishSessionEvent = (
    session: ScenarioAssistantSession,
    type: AssistantSseEventType,
    payload: Record<string, unknown> = {}
  ) => {
    broadcastAssistantSseEvent(
      session,
      createAssistantSseEvent(type, {
        sessionId: session.id,
        session: scenarioAssistantSessionView(session),
        ...payload
      })
    );
  };

  if (pathname === '/api/scenario-assistant/sessions' && method === 'POST') {
    cleanupScenarioAssistantSessions(assistantSessions);
    const body = (await parseBody(req)) as {
      configPath?: unknown;
      scenarioId?: unknown;
      selectedAssistantAgentName?: unknown;
      context?: unknown;
    };
    const configPathRaw = body.configPath ? String(body.configPath).trim() : '';
    const scenarioId = String(body.scenarioId ?? '').trim();
    const requestedAssistantAgentName = String(body.selectedAssistantAgentName ?? '').trim();
    const contextRaw = body.context ?? {};
    if (!scenarioId) {
      asJson(res, 400, { error: 'scenarioId is required' });
      return true;
    }
    if (
      !contextRaw ||
      typeof contextRaw !== 'object' ||
      !('scenario' in contextRaw) ||
      !(contextRaw as { scenario?: unknown }).scenario ||
      typeof (contextRaw as { scenario?: unknown }).scenario !== 'object'
    ) {
      asJson(res, 400, { error: 'context.scenario is required' });
      return true;
    }
    const context = contextRaw as SessionContext;
    let configPath: string | undefined;
    let agentConfig: AgentConfig;
    let serversByName: EvalConfig['servers'];
    let warnings: string[] = [];
    let selectedAssistantAgentName = '';
    if (configPathRaw) {
      configPath = isAbsolute(configPathRaw)
        ? ensureInsideRoot(settings.evalsDir, configPathRaw)
        : ensureInsideRoot(settings.evalsDir, join(settings.evalsDir, configPathRaw));
      if (!existsSync(configPath)) {
        asJson(res, 404, { error: `Config not found: ${configPath}` });
        return true;
      }
      const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
      warnings = [...(loaded.warnings ?? [])];
      selectedAssistantAgentName = pickDefaultAssistantAgentName({
        requested: requestedAssistantAgentName,
        agentNames: Object.keys(loaded.config.agents)
      });
      if (!selectedAssistantAgentName) {
        asJson(res, 400, {
          error: 'No agents available for Scenario Assistant in this MCP Evaluation.'
        });
        return true;
      }
      agentConfig = resolveAssistantAgentFromConfig(loaded.config, selectedAssistantAgentName);
      serversByName = loaded.config.servers;
    } else {
      const libraries = readLibraries(settings.librariesDir);
      selectedAssistantAgentName = pickDefaultAssistantAgentName({
        requested: requestedAssistantAgentName,
        settingsDefault: settings.scenarioAssistantAgentName,
        agentNames: Object.keys(libraries.agents)
      });
      if (!selectedAssistantAgentName) {
        asJson(res, 400, {
          error: 'No library agents available for Scenario Assistant. Add an agent first.'
        });
        return true;
      }
      agentConfig = resolveAssistantAgentFromLibraries(libraries, selectedAssistantAgentName);
      serversByName = libraries.servers;
    }
    const mcp = new McpClientManager();
    const session: ScenarioAssistantSession = {
      id: `sas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      configPath,
      selectedAssistantAgentName,
      context,
      agentConfig,
      toolsLoaded: 0,
      toolServers: [],
      initialMessages: [],
      warnings,
      events: [],
      clients: new Set(),
      mcp,
      tools: [],
      toolPublicMap: new Map()
    };
    session.initialMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      text: 'Scenario Assistant session created.',
      createdAt: new Date().toISOString()
    });
    const selectedServerNames = Array.from(
      new Set(
        Array.isArray(context.scenario.serverNames)
          ? context.scenario.serverNames.map((v) => String(v))
          : []
      )
    );
    const oauthServerNames = selectedServerNames.filter(
      (serverName) => serversByName[serverName]?.auth?.type === 'oauth_authorization_code'
    );
    let serverAuthHeaders: Record<string, Record<string, string>> | undefined;
    if (oauthServerNames.length > 0) {
      try {
        serverAuthHeaders = await oauthSessionManager.getAuthHeadersForServers(
          oauthServerNames,
          req.headers.host
        );
      } catch (error: unknown) {
        if (error instanceof OAuthAuthorizationRequiredError) {
          asJson(res, 401, { error: error.message, oauth: { required: error.details } });
          return true;
        }
        asJson(res, 400, { error: errorMessage(error) });
        return true;
      }
    }
    for (const warning of warnings) {
      publishSessionEvent(session, 'session_warning', { warning });
    }
    await preloadScenarioAssistantTools(session, serversByName, selectedServerNames, {
      serverAuthHeaders
    });
    session.toolsLoaded = session.tools.length;
    session.toolServers = Array.from(
      new Set(session.tools.map((tool) => tool.name.split('__')[0]))
    );
    const runtimeDefinition = createScenarioAssistantRuntimeDefinition(session);
    runtimeDefinition.onEvent = (event) => {
      touchScenarioAssistantSession(session);
      publishSessionEvent(session, event.type, event.payload);
    };
    session.runtime = await createAssistantRuntimeService(
      assistantRuntimeFactory,
      runtimeDefinition,
      () => touchScenarioAssistantSession(session)
    );
    assistantSessions.set(session.id, session);
    publishSessionEvent(session, 'session_started');
    asJson(res, 201, { sessionId: session.id, session: scenarioAssistantSessionView(session) });
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.endsWith('/events') &&
    method === 'GET'
  ) {
    cleanupScenarioAssistantSessions(assistantSessions);
    const sessionId = pathname
      .replace('/api/scenario-assistant/sessions/', '')
      .replace('/events', '');
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    serveAssistantSseStream(req, res, session);
    return true;
  }

  if (pathname.startsWith('/api/scenario-assistant/sessions/') && method === 'GET') {
    cleanupScenarioAssistantSessions(assistantSessions);
    const sessionId = pathname.replace('/api/scenario-assistant/sessions/', '');
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    touchScenarioAssistantSession(session);
    asJson(res, 200, { session: scenarioAssistantSessionView(session) });
    return true;
  }

  if (pathname.startsWith('/api/scenario-assistant/sessions/') && method === 'DELETE') {
    cleanupScenarioAssistantSessions(assistantSessions);
    const sessionId = pathname.replace('/api/scenario-assistant/sessions/', '');
    const session = assistantSessions.get(sessionId);
    let disposeError: unknown;
    if (session) {
      try {
        await session.runtime?.dispose();
      } catch (error) {
        disposeError = error;
      } finally {
        try {
          publishSessionEvent(session, 'session_finished');
        } finally {
          endAssistantSseClients(session);
        }
      }
    }
    assistantSessions.delete(sessionId);
    if (disposeError) asJson(res, 500, { error: errorMessage(disposeError) });
    else asJson(res, 200, { ok: true });
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.endsWith('/messages') &&
    method === 'POST'
  ) {
    cleanupScenarioAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const abortController = new AbortController();
    const handleClose = () => {
      if (res.writableEnded) return;
      abortController.abort();
    };
    res.on('close', handleClose);
    try {
      const body = await parseBody(req);
      const message = String(body.message ?? '').trim();
      throwIfAborted(abortController.signal);
      if (!message) {
        asJson(res, 400, { error: 'message is required' });
        return true;
      }
      const response = await session.runtime!.sendMessage(message, abortController.signal);
      throwIfAborted(abortController.signal);
      const snapshot = scenarioAssistantSessionView(session);
      asJson(res, 200, {
        session: snapshot,
        response:
          response.type === 'tool_call_request'
            ? {
                type: response.type,
                text: response.text,
                pendingToolCall: response.pendingToolCalls[0],
                pendingToolCalls: response.pendingToolCalls
              }
            : response
      });
      return true;
    } catch (error) {
      if (abortController.signal.aborted) {
        return true;
      }
      throw error;
    } finally {
      res.off('close', handleClose);
    }
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.includes('/tool-calls/') &&
    pathname.endsWith('/approve') &&
    method === 'POST'
  ) {
    cleanupScenarioAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const callId = parts[6];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const pending = session
      .runtime!.getSnapshot()
      .pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Scenario Assistant tool call not found' });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    const abortController = createAssistantRequestAbortController(res);
    try {
      const body = (await parseBody(req)) as { argumentsOverride?: unknown };
      const response = await session.runtime!.resolveToolCalls(
        [
          {
            toolCallId: pending.id,
            decision: 'approve',
            ...(Object.prototype.hasOwnProperty.call(body ?? {}, 'argumentsOverride')
              ? { arguments: body.argumentsOverride }
              : {})
          }
        ],
        abortController.signal
      );
      throwIfAborted(abortController.signal);
      asJson(res, 200, {
        session: scenarioAssistantSessionView(session),
        response:
          response.type === 'tool_call_resolved'
            ? {
                ...response,
                text: `Approved tool call ${pending.publicToolName}. Waiting for remaining tool calls.`
              }
            : response
      });
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    } finally {
      abortController.dispose();
    }
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.includes('/tool-calls/') &&
    pathname.endsWith('/deny') &&
    method === 'POST'
  ) {
    cleanupScenarioAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const callId = parts[6];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const pending = session
      .runtime!.getSnapshot()
      .pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Scenario Assistant tool call not found' });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    const abortController = createAssistantRequestAbortController(res);
    try {
      const response = await session.runtime!.resolveToolCalls(
        [{ toolCallId: pending.id, decision: 'deny' }],
        abortController.signal
      );
      throwIfAborted(abortController.signal);
      asJson(res, 200, {
        session: scenarioAssistantSessionView(session),
        response:
          response.type === 'tool_call_resolved'
            ? {
                ...response,
                text: `Denied tool call ${pending.publicToolName}. Waiting for remaining tool calls.`
              }
            : response
      });
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    } finally {
      abortController.dispose();
    }
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.includes('/tool-calls/approve-all') &&
    method === 'POST'
  ) {
    cleanupScenarioAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const pendingCalls = session
      .runtime!.getSnapshot()
      .pendingToolCalls.filter((call) => call.status === 'pending');
    if (pendingCalls.length === 0) {
      asJson(res, 409, { error: 'No pending tool calls to approve' });
      return true;
    }
    const abortController = createAssistantRequestAbortController(res);
    try {
      const response = await session.runtime!.resolveToolCalls(
        pendingCalls.map((call) => ({ toolCallId: call.id, decision: 'approve' as const })),
        abortController.signal
      );
      throwIfAborted(abortController.signal);
      asJson(res, 200, { session: scenarioAssistantSessionView(session), response });
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    } finally {
      abortController.dispose();
    }
    return true;
  }

  return false;
}
