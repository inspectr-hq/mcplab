import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { loadConfig, type AgentConfig, type EvalConfig } from '@inspectr/mcplab-core';
import type {
  AppRouteDeps,
  AppRouteRequestContext,
  ScenarioAssistantSessionsMap
} from './app-context.js';
import {
  setupScenarioAssistantSession,
  type ScenarioAssistantContextInput,
  type ScenarioAssistantSession,
  cleanupScenarioAssistantSessions,
  touchScenarioAssistantSession,
  scenarioAssistantSessionView
} from './scenario-assistant-domain.js';
import { handleAssistantSessionRoutes } from './assistant-session-routes.js';
import {
  broadcastAssistantSseEvent,
  createAssistantSseEvent,
  type AssistantSseEventType
} from './assistant-events.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';

export type ScenarioAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'ensureInsideRoot'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromConfig'
  | 'resolveAssistantAgentFromLibraries'
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
    ensureInsideRoot,
    readLibraries,
    pickDefaultAssistantAgentName,
    resolveAssistantAgentFromConfig,
    resolveAssistantAgentFromLibraries,
    assistantRuntimeFactory
  } = deps;

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
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
    const context = contextRaw as ScenarioAssistantContextInput;
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
    const session: ScenarioAssistantSession = {
      id: `sas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      configPath,
      selectedAssistantAgentName,
      model: agentConfig.model,
      provider: agentConfig.provider,
      toolsLoaded: 0,
      toolServers: [],
      initialMessages: [],
      warnings,
      events: [],
      clients: new Set()
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
    await setupScenarioAssistantSession({
      session,
      agentConfig,
      context,
      serversByName,
      selectedServerNames,
      serverAuthHeaders,
      assistantRuntimeFactory,
      onEvent: (event) => {
        touchScenarioAssistantSession(session);
        publishSessionEvent(session, event.type, event.payload);
      },
      onActivity: () => touchScenarioAssistantSession(session)
    });
    assistantSessions.set(session.id, session);
    publishSessionEvent(session, 'session_started');
    asJson(res, 201, { sessionId: session.id, session: scenarioAssistantSessionView(session) });
    return true;
  }

  return handleAssistantSessionRoutes({
    req,
    res,
    pathname,
    method,
    prefix: '/api/scenario-assistant/sessions',
    assistantLabel: 'Scenario Assistant',
    parseBody,
    asJson,
    sessions: assistantSessions,
    cleanup: () => cleanupScenarioAssistantSessions(assistantSessions),
    touch: touchScenarioAssistantSession,
    view: scenarioAssistantSessionView,
    finish: (session) => publishSessionEvent(session, 'session_finished'),
    approveAll: true
  });
}
