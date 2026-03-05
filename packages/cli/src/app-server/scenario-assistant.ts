import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join } from 'node:path';
import {
  McpClientManager,
  loadConfig,
  type AgentConfig,
  type EvalConfig
} from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext, AssistantSessionsMap } from './app-context.js';
import type { ScenarioAssistantSession } from './scenario-assistant-domain.js';
import { flushDanglingToolCalls } from './assistant-common.js';

export type ScenarioAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'cleanupAssistantSessions'
  | 'touchAssistantSession'
  | 'assistantSessionView'
  | 'ensureInsideRoot'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromConfig'
  | 'resolveAssistantAgentFromLibraries'
  | 'preloadAssistantTools'
  | 'continueAssistantTurn'
  | 'executeAssistantToolCall'
  | 'summarizeToolResultForAssistant'
>;

export async function handleScenarioAssistantRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  assistantSessions: AssistantSessionsMap;
  deps: ScenarioAssistantRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, assistantSessions, deps } = params;
  const {
    parseBody,
    asJson,
    cleanupAssistantSessions,
    touchAssistantSession,
    assistantSessionView,
    ensureInsideRoot,
    readLibraries,
    pickDefaultAssistantAgentName,
    resolveAssistantAgentFromConfig,
    resolveAssistantAgentFromLibraries,
    preloadAssistantTools,
    continueAssistantTurn,
    executeAssistantToolCall,
    summarizeToolResultForAssistant
  } = deps;

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
  type SessionPendingCall = ScenarioAssistantSession['pendingToolCalls'][number];
  type SessionContext = ScenarioAssistantSession['context'];

  if (pathname === '/api/scenario-assistant/sessions' && method === 'POST') {
    cleanupAssistantSessions(assistantSessions);
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
    const session: ScenarioAssistantSession = {
      id: `sas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      configPath,
      selectedAssistantAgentName,
      context,
      agentConfig,
      mcp: new McpClientManager(),
      tools: [],
      toolPublicMap: new Map(),
      pendingToolCalls: [],
      chatMessages: [],
      llmMessages: [],
      warnings
    };
    session.chatMessages.push({
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
    await preloadAssistantTools(session, serversByName, selectedServerNames);
    assistantSessions.set(session.id, session);
    asJson(res, 201, { sessionId: session.id, session: assistantSessionView(session) });
    return true;
  }

  if (pathname.startsWith('/api/scenario-assistant/sessions/') && method === 'GET') {
    cleanupAssistantSessions(assistantSessions);
    const sessionId = pathname.replace('/api/scenario-assistant/sessions/', '');
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    touchAssistantSession(session);
    asJson(res, 200, { session: assistantSessionView(session) });
    return true;
  }

  if (pathname.startsWith('/api/scenario-assistant/sessions/') && method === 'DELETE') {
    cleanupAssistantSessions(assistantSessions);
    const sessionId = pathname.replace('/api/scenario-assistant/sessions/', '');
    assistantSessions.delete(sessionId);
    asJson(res, 200, { ok: true });
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.endsWith('/messages') &&
    method === 'POST'
  ) {
    cleanupAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const body = await parseBody(req);
    const message = String(body.message ?? '').trim();
    if (!message) {
      asJson(res, 400, { error: 'message is required' });
      return true;
    }
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      text: message,
      createdAt: new Date().toISOString()
    });
    flushDanglingToolCalls(session.llmMessages);
    session.llmMessages.push({ role: 'user', content: message });
    const output = await continueAssistantTurn(session);
    asJson(res, 200, output);
    return true;
  }

  // Helper: find sibling pending tool call IDs for a given call
  const findSiblingCallIds = (session: ScenarioAssistantSession, callId: string): string[] => {
    const msg = session.chatMessages.find(
      (m) => m.pendingToolCallIds?.includes(callId) ?? m.pendingToolCallId === callId
    );
    return msg?.pendingToolCallIds ?? (msg?.pendingToolCallId ? [msg.pendingToolCallId] : [callId]);
  };

  const allSiblingsResolved = (session: ScenarioAssistantSession, callId: string): boolean => {
    const siblingIds = findSiblingCallIds(session, callId);
    return siblingIds.every((id) => {
      const call = session.pendingToolCalls.find((c: SessionPendingCall) => c.id === id);
      return call && call.status !== 'pending';
    });
  };

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.includes('/tool-calls/') &&
    pathname.endsWith('/approve') &&
    method === 'POST'
  ) {
    cleanupAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const callId = parts[6];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const pending = session.pendingToolCalls.find((call: SessionPendingCall) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Scenario Assistant tool call not found' });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    const body = (await parseBody(req)) as { argumentsOverride?: unknown };
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'argumentsOverride')) {
      pending.arguments = body.argumentsOverride;
    }
    pending.status = 'approved';
    try {
      const toolResult = await executeAssistantToolCall(session, pending);
      pending.resultPreview = summarizeToolResultForAssistant(toolResult);
      session.llmMessages.push({
        role: 'tool',
        content: pending.resultPreview,
        tool_call_id: pending.id,
        name: pending.publicToolName
      });
    } catch (error: unknown) {
      pending.status = 'error';
      pending.error = errorMessage(error);
      session.llmMessages.push({
        role: 'tool',
        content: JSON.stringify({ error: pending.error }),
        tool_call_id: pending.id,
        name: pending.publicToolName
      });
      session.chatMessages.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'tool',
        text: `Tool error (${pending.server}::${pending.tool}): ${pending.error}`,
        createdAt: new Date().toISOString()
      });
    }
    if (allSiblingsResolved(session, callId)) {
      const output = await continueAssistantTurn(session);
      asJson(res, 200, output);
    } else {
      touchAssistantSession(session);
      asJson(res, 200, {
        session: assistantSessionView(session),
        response: { type: 'tool_call_resolved', text: `Approved tool call ${pending.publicToolName}. Waiting for remaining tool calls.` }
      });
    }
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.includes('/tool-calls/') &&
    pathname.endsWith('/deny') &&
    method === 'POST'
  ) {
    cleanupAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const callId = parts[6];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const pending = session.pendingToolCalls.find((call: SessionPendingCall) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Scenario Assistant tool call not found' });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    pending.status = 'denied';
    session.llmMessages.push({
      role: 'tool',
      content: JSON.stringify({
        denied: true,
        reason: 'User denied tool call',
        server: pending.server,
        tool: pending.tool
      }),
      tool_call_id: pending.id,
      name: pending.publicToolName
    });
    if (allSiblingsResolved(session, callId)) {
      const output = await continueAssistantTurn(session);
      asJson(res, 200, output);
    } else {
      touchAssistantSession(session);
      asJson(res, 200, {
        session: assistantSessionView(session),
        response: { type: 'tool_call_resolved', text: `Denied tool call ${pending.publicToolName}. Waiting for remaining tool calls.` }
      });
    }
    return true;
  }

  if (
    pathname.startsWith('/api/scenario-assistant/sessions/') &&
    pathname.includes('/tool-calls/approve-all') &&
    method === 'POST'
  ) {
    cleanupAssistantSessions(assistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const session = assistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Scenario Assistant session not found' });
      return true;
    }
    const pendingCalls = session.pendingToolCalls.filter(
      (call: SessionPendingCall) => call.status === 'pending'
    );
    if (pendingCalls.length === 0) {
      asJson(res, 409, { error: 'No pending tool calls to approve' });
      return true;
    }
    for (const pending of pendingCalls) {
      pending.status = 'approved';
      try {
        const toolResult = await executeAssistantToolCall(session, pending);
        pending.resultPreview = summarizeToolResultForAssistant(toolResult);
        session.llmMessages.push({
          role: 'tool',
          content: pending.resultPreview,
          tool_call_id: pending.id,
          name: pending.publicToolName
        });
      } catch (error: unknown) {
        pending.status = 'error';
        pending.error = errorMessage(error);
        session.llmMessages.push({
          role: 'tool',
          content: JSON.stringify({ error: pending.error }),
          tool_call_id: pending.id,
          name: pending.publicToolName
        });
        session.chatMessages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'tool',
          text: `Tool error (${pending.server}::${pending.tool}): ${pending.error}`,
          createdAt: new Date().toISOString()
        });
      }
    }
    const output = await continueAssistantTurn(session);
    asJson(res, 200, output);
    return true;
  }

  return false;
}
