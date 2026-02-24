import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpClientManager } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import type { ResultAssistantSession } from './result-assistant-domain.js';
import {
  cleanupResultAssistantSessions,
  continueResultAssistantTurn,
  executeResultAssistantToolCall,
  preloadResultAssistantTools,
  resultAssistantSessionView,
  summarizeToolResultForResultAssistant,
  touchResultAssistantSession
} from './result-assistant-domain.js';

export type ResultAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'getRunResults'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromLibraries'
>;

export async function handleResultAssistantRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  resultAssistantSessions: Map<string, ResultAssistantSession>;
  deps: ResultAssistantRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, resultAssistantSessions, deps } = params;
  const {
    parseBody,
    asJson,
    getRunResults,
    readLibraries,
    pickDefaultAssistantAgentName,
    resolveAssistantAgentFromLibraries
  } = deps;
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

  if (pathname === '/api/result-assistant/sessions' && method === 'POST') {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const body = (await parseBody(req)) as { runId?: unknown };
    const runId = String(body.runId ?? '').trim();
    if (!runId) {
      asJson(res, 400, { error: 'runId is required' });
      return true;
    }
    const results = getRunResults(runId, settings.runsDir);
    const libraries = readLibraries(settings.librariesDir);
    const assistantAgentName = pickDefaultAssistantAgentName({
      settingsDefault: settings.scenarioAssistantAgentName,
      agentNames: Object.keys(libraries.agents)
    });
    if (!assistantAgentName) {
      asJson(res, 400, {
        error: 'No assistant agent available. Add an agent in Libraries > Agents or configure the Scenario Assistant Agent in Settings.'
      });
      return true;
    }
    const agentConfig = resolveAssistantAgentFromLibraries(libraries, assistantAgentName);
    const session: ResultAssistantSession = {
      id: `ras-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      selectedAssistantAgentName: assistantAgentName,
      agentConfig,
      resultSummary: results,
      mcp: new McpClientManager(),
      tools: [],
      toolPublicMap: new Map(),
      pendingToolCalls: [],
      chatMessages: [],
      llmMessages: []
    };
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      text: 'Result Assistant session created.',
      createdAt: new Date().toISOString()
    });
    try {
      await preloadResultAssistantTools(session, localMcplabMcpUrl());
    } catch (error) {
      session.chatMessages.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'system',
        text: `Warning: could not preload MCPLab MCP tools: ${errorMessage(error)}`,
        createdAt: new Date().toISOString()
      });
    }
    resultAssistantSessions.set(session.id, session);
    asJson(res, 201, { sessionId: session.id, session: resultAssistantSessionView(session) });
    return true;
  }

  if (pathname.startsWith('/api/result-assistant/sessions/') && method === 'GET') {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const sessionId = pathname.replace('/api/result-assistant/sessions/', '');
    const session = resultAssistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Result Assistant session not found' });
      return true;
    }
    touchResultAssistantSession(session);
    asJson(res, 200, { session: resultAssistantSessionView(session) });
    return true;
  }

  if (pathname.startsWith('/api/result-assistant/sessions/') && method === 'DELETE') {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const sessionId = pathname.replace('/api/result-assistant/sessions/', '');
    resultAssistantSessions.delete(sessionId);
    asJson(res, 200, { ok: true });
    return true;
  }

  if (
    pathname.startsWith('/api/result-assistant/sessions/') &&
    pathname.endsWith('/messages') &&
    method === 'POST'
  ) {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const session = resultAssistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Result Assistant session not found' });
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
    session.llmMessages.push({ role: 'user', content: message });
    const output = await continueResultAssistantTurn(session);
    asJson(res, 200, output);
    return true;
  }

  if (
    pathname.startsWith('/api/result-assistant/sessions/') &&
    pathname.includes('/tool-calls/') &&
    pathname.endsWith('/approve') &&
    method === 'POST'
  ) {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const callId = parts[6];
    const session = resultAssistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Result Assistant session not found' });
      return true;
    }
    const pending = session.pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Result Assistant tool call not found' });
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
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'tool',
      text: `Approved tool call ${pending.server}::${pending.tool}`,
      createdAt: new Date().toISOString()
    });
    try {
      const toolResult = await executeResultAssistantToolCall(session, pending);
      pending.resultPreview = summarizeToolResultForResultAssistant(toolResult);
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
    const output = await continueResultAssistantTurn(session);
    asJson(res, 200, output);
    return true;
  }

  if (
    pathname.startsWith('/api/result-assistant/sessions/') &&
    pathname.includes('/tool-calls/') &&
    pathname.endsWith('/deny') &&
    method === 'POST'
  ) {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const parts = pathname.split('/');
    const sessionId = parts[4];
    const callId = parts[6];
    const session = resultAssistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Result Assistant session not found' });
      return true;
    }
    const pending = session.pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Result Assistant tool call not found' });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    pending.status = 'denied';
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'tool',
      text: `Denied tool call ${pending.server}::${pending.tool}`,
      createdAt: new Date().toISOString()
    });
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
    const output = await continueResultAssistantTurn(session);
    asJson(res, 200, output);
    return true;
  }

  return false;
}

function localMcplabMcpUrl(): string {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = process.env.MCP_PORT || '3011';
  const path = process.env.MCP_PATH || '/mcp';
  return `http://${host}:${port}${path}`;
}
