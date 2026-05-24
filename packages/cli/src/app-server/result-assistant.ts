import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, relative, resolve, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { McpClientManager } from '@inspectr/mcplab-core';
import { throwIfAborted } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import type { ResultAssistantSession } from './result-assistant-domain.js';
import {
  cleanupResultAssistantSessions,
  resultAssistantSessionView,
  touchResultAssistantSession
} from './result-assistant-domain.js';
import { isResultAssistantAutoApprovedTool } from './result-assistant-tools.js';
import { flushDanglingToolCalls } from './assistant-common.js';
import {
  broadcastAssistantSseEvent,
  createAssistantSseEvent,
  endAssistantSseClients,
  serveAssistantSseStream,
  type AssistantSseEventType
} from './assistant-events.js';

export type ResultAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'getRunResults'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromLibraries'
  | 'continueResultAssistantTurn'
  | 'executeResultAssistantToolCall'
  | 'summarizeToolResultForResultAssistant'
  | 'preloadResultAssistantTools'
>;

type ResultAssistantTurnRouteResponse = {
  session: ReturnType<typeof resultAssistantSessionView>;
  response: {
    type: 'assistant_message' | 'tool_call_request';
    text: string;
    pendingToolCall?: ResultAssistantSession['pendingToolCalls'][number];
  };
};

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
    resolveAssistantAgentFromLibraries,
    continueResultAssistantTurn,
    executeResultAssistantToolCall,
    summarizeToolResultForResultAssistant,
    preloadResultAssistantTools
  } = deps;
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const makeMsgId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listReferenceReportsForRun = (runId: string | null) =>
    listMarkdownReportsLinkedToRun(settings.workspaceRoot, runId);
  const publishSessionEvent = (
    session: ResultAssistantSession,
    type: AssistantSseEventType,
    payload: Record<string, unknown> = {}
  ) => {
    broadcastAssistantSseEvent(
      session,
      createAssistantSseEvent(type, {
        sessionId: session.id,
        session: resultAssistantSessionView(session),
        ...payload
      })
    );
  };

  const executePendingToolCall = async (
    session: ResultAssistantSession,
    pending: ResultAssistantSession['pendingToolCalls'][number],
    approvalLabel: string,
    options?: { emitApprovalChatMessage?: boolean; signal?: AbortSignal }
  ): Promise<void> => {
    const emitApprovalChatMessage = options?.emitApprovalChatMessage ?? true;
    pending.status = 'approved';
    publishSessionEvent(session, 'tool_call_approved', { pendingToolCallId: pending.id });
    if (emitApprovalChatMessage) {
      session.chatMessages.push({
        id: makeMsgId(),
        role: 'tool',
        text: `${approvalLabel} tool call ${pending.server}::${pending.tool}`,
        createdAt: new Date().toISOString()
      });
    }
    try {
      const toolResult = await executeResultAssistantToolCall(session, pending, options?.signal);
      pending.resultPreview = summarizeToolResultForResultAssistant(toolResult);
      if (pending.tool === 'mcplab_write_markdown_report' && session.scope === 'run') {
        session.referenceReportsForRun = listReferenceReportsForRun(session.runId);
        session.systemPromptCache = undefined;
      }
      session.llmMessages.push({
        role: 'tool',
        content: pending.resultPreview,
        tool_call_id: pending.id,
        name: pending.publicToolName
      });
      publishSessionEvent(session, 'tool_call_resolved', {
        pendingToolCallId: pending.id,
        pendingToolCall: pending
      });
    } catch (error: unknown) {
      if (options?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      pending.status = 'error';
      pending.error = errorMessage(error);
      session.llmMessages.push({
        role: 'tool',
        content: JSON.stringify({ error: pending.error }),
        tool_call_id: pending.id,
        name: pending.publicToolName
      });
      session.chatMessages.push({
        id: makeMsgId(),
        role: 'tool',
        text: `Tool error (${pending.server}::${pending.tool}): ${pending.error}`,
        createdAt: new Date().toISOString()
      });
      publishSessionEvent(session, 'session_error', {
        pendingToolCallId: pending.id,
        error: pending.error
      });
    }
  };

  const continueWithAutoApprovedReads = async (
    session: ResultAssistantSession,
    signal?: AbortSignal
  ): Promise<ResultAssistantTurnRouteResponse> => {
    throwIfAborted(signal);
    publishSessionEvent(session, 'turn_started');
    let output = await continueResultAssistantTurn(session, signal);
    throwIfAborted(signal);
    for (let i = 0; i < 25; i += 1) {
      throwIfAborted(signal);
      const pending = output.response.pendingToolCall;
      if (
        output.response.type !== 'tool_call_request' ||
        !pending ||
        !isResultAssistantAutoApprovedTool(pending.tool)
      ) {
        if (output.response.type === 'assistant_message') {
          publishSessionEvent(session, 'assistant_message_completed', {
            text: output.response.text
          });
        } else if (
          output.response.type === 'tool_call_request' &&
          output.response.pendingToolCall
        ) {
          publishSessionEvent(session, 'tool_call_requested', {
            pendingToolCallId: output.response.pendingToolCall.id,
            pendingToolCall: output.response.pendingToolCall
          });
        }
        return output;
      }
      publishSessionEvent(session, 'tool_call_requested', {
        pendingToolCallId: pending.id,
        pendingToolCall: pending
      });
      throwIfAborted(signal);
      await executePendingToolCall(session, pending, 'Auto-approved read-only', {
        emitApprovalChatMessage: false,
        signal: signal
      });
      throwIfAborted(signal);
      touchResultAssistantSession(session);
      if (pending.error) break;
      output = await continueResultAssistantTurn(session, signal);
      throwIfAborted(signal);
    }
    return output;
  };

  if (pathname === '/api/result-assistant/sessions' && method === 'POST') {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const body = (await parseBody(req)) as { runId?: unknown; scope?: unknown };
    const requestedScope = String(body.scope ?? '')
      .trim()
      .toLowerCase();
    const scope: 'run' | 'all_runs' = requestedScope === 'all_runs' ? 'all_runs' : 'run';
    const runId = String(body.runId ?? '').trim();
    if (scope === 'run' && !runId) {
      asJson(res, 400, { error: 'runId is required for run-scoped sessions' });
      return true;
    }
    const results = scope === 'run' ? getRunResults(runId, settings.runsDir) : null;
    const libraries = readLibraries(settings.librariesDir);
    const assistantAgentName = pickDefaultAssistantAgentName({
      settingsDefault: settings.scenarioAssistantAgentName,
      agentNames: Object.keys(libraries.agents)
    });
    if (!assistantAgentName) {
      asJson(res, 400, {
        error:
          'No assistant agent available. Add an agent in Libraries > Agents or configure the Scenario Assistant Agent in Settings.'
      });
      return true;
    }
    const agentConfig = resolveAssistantAgentFromLibraries(libraries, assistantAgentName);
    const session: ResultAssistantSession = {
      id: `ras-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scope,
      runId: scope === 'run' ? runId : null,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      selectedAssistantAgentName: assistantAgentName,
      agentConfig,
      resultSummary: results,
      referenceReportsForRun: listReferenceReportsForRun(scope === 'run' ? runId : null),
      mcp: new McpClientManager(),
      tools: [],
      toolPublicMap: new Map(),
      pendingToolCalls: [],
      chatMessages: [],
      llmMessages: [],
      events: [],
      clients: new Set()
    };
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      text:
        scope === 'all_runs'
          ? 'Result Assistant session created for all historical runs.'
          : 'Result Assistant session created.',
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
      publishSessionEvent(session, 'session_warning', { warning: errorMessage(error) });
    }
    resultAssistantSessions.set(session.id, session);
    publishSessionEvent(session, 'session_started');
    asJson(res, 201, { sessionId: session.id, session: resultAssistantSessionView(session) });
    return true;
  }

  if (
    pathname.startsWith('/api/result-assistant/sessions/') &&
    pathname.endsWith('/events') &&
    method === 'GET'
  ) {
    cleanupResultAssistantSessions(resultAssistantSessions);
    const sessionId = pathname
      .replace('/api/result-assistant/sessions/', '')
      .replace('/events', '');
    const session = resultAssistantSessions.get(sessionId);
    if (!session) {
      asJson(res, 404, { error: 'Result Assistant session not found' });
      return true;
    }
    serveAssistantSseStream(req, res, session);
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
    const session = resultAssistantSessions.get(sessionId);
    if (session) {
      publishSessionEvent(session, 'session_finished');
      endAssistantSseClients(session);
    }
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
    const chatMessagesBefore = session.chatMessages.length;
    const llmMessagesBefore = session.llmMessages.length;
    const pendingToolCallsBefore = session.pendingToolCalls.length;
    const abortController = new AbortController();
    const handleClose = () => {
      if (req.complete) return;
      if (res.writableEnded) return;
      abortController.abort();
    };
    req.on('close', handleClose);
    try {
      const body = await parseBody(req);
      const message = String(body.message ?? '').trim();
      throwIfAborted(abortController.signal);
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
      const output = await continueWithAutoApprovedReads(session, abortController.signal);
      throwIfAborted(abortController.signal);
      asJson(res, 200, output);
      return true;
    } catch (error) {
      if (abortController.signal.aborted) {
        session.chatMessages.splice(chatMessagesBefore);
        session.llmMessages.splice(llmMessagesBefore);
        session.pendingToolCalls.splice(pendingToolCallsBefore);
        return true;
      }
      throw error;
    } finally {
      req.off('close', handleClose);
    }
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
    await executePendingToolCall(session, pending, 'Approved', {
      emitApprovalChatMessage: false
    });
    const output = await continueWithAutoApprovedReads(session);
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
    publishSessionEvent(session, 'tool_call_denied', { pendingToolCallId: pending.id });
    publishSessionEvent(session, 'tool_call_resolved', {
      pendingToolCallId: pending.id,
      pendingToolCall: pending
    });
    const output = await continueWithAutoApprovedReads(session);
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

function listMarkdownReportsLinkedToRun(
  workspaceRoot: string,
  runId: string | null
): Array<{
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
}> {
  const root = resolve(workspaceRoot, 'mcplab/reports');
  const out: Array<{
    path: string;
    relativePath: string;
    name: string;
    sizeBytes: number;
    mtime: string;
  }> = [];
  const isMarkdown = (path: string) => path.endsWith('.md') || path.endsWith('.markdown');
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isMarkdown(fullPath)) continue;
      try {
        const st = statSync(fullPath);
        if (!st.isFile()) continue;
        const relPath = relative(root, fullPath).split(sep).join('/');
        const wsPath = relative(workspaceRoot, fullPath).split(sep).join('/');
        const name = basename(fullPath);
        if (runId && !relPath.includes(runId) && !name.includes(runId)) continue;
        out.push({
          path: wsPath,
          relativePath: relPath,
          name,
          sizeBytes: st.size,
          mtime: st.mtime.toISOString()
        });
      } catch {
        // Ignore unreadable files.
      }
    }
  };
  walk(root);
  out.sort((a, b) => {
    if (a.mtime === b.mtime) return a.path.localeCompare(b.path);
    return b.mtime.localeCompare(a.mtime);
  });
  return out.slice(0, 50);
}
