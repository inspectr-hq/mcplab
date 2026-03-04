import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, relative, resolve, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
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
import { flushDanglingToolCalls } from './assistant-common.js';

export type ResultAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'getRunResults'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromLibraries'
>;

const RESULT_ASSISTANT_AUTO_APPROVE_TOOLS = new Set([
  'mcplab_list_markdown_reports',
  'mcplab_read_markdown_report',
  'mcplab_list_runs',
  'mcplab_read_run_artifact',
  'mcplab_trace_stats',
  'mcplab_trace_get_final_answers',
  'mcplab_trace_get_conversation',
  'mcplab_trace_list_events',
  'mcplab_trace_search',
  'mcplab_list_tool_analysis_results',
  'mcplab_read_tool_analysis_result',
  'mcplab_list_library',
  'mcplab_get_library_item'
]);

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
  const makeMsgId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listReferenceReportsForRun = (runId: string) =>
    listMarkdownReportsLinkedToRun(settings.workspaceRoot, runId);

  const executePendingToolCall = async (
    session: ResultAssistantSession,
    pending: ResultAssistantSession['pendingToolCalls'][number],
    approvalLabel: string,
    options?: { emitApprovalChatMessage?: boolean }
  ): Promise<void> => {
    const emitApprovalChatMessage = options?.emitApprovalChatMessage ?? true;
    pending.status = 'approved';
    if (emitApprovalChatMessage) {
      session.chatMessages.push({
        id: makeMsgId(),
        role: 'tool',
        text: `${approvalLabel} tool call ${pending.server}::${pending.tool}`,
        createdAt: new Date().toISOString()
      });
    }
    try {
      const toolResult = await executeResultAssistantToolCall(session, pending);
      pending.resultPreview = summarizeToolResultForResultAssistant(toolResult);
      if (pending.tool === 'mcplab_write_markdown_report') {
        session.referenceReportsForRun = listReferenceReportsForRun(session.runId);
        session.systemPromptCache = undefined;
      }
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
        id: makeMsgId(),
        role: 'tool',
        text: `Tool error (${pending.server}::${pending.tool}): ${pending.error}`,
        createdAt: new Date().toISOString()
      });
    }
  };

  const continueWithAutoApprovedReads = async (session: ResultAssistantSession) => {
    let output = await continueResultAssistantTurn(session);
    for (let i = 0; i < 10; i += 1) {
      const pending = output.response.pendingToolCall;
      if (output.response.type !== 'tool_call_request' || !pending) break;
      if (!RESULT_ASSISTANT_AUTO_APPROVE_TOOLS.has(pending.tool)) break;
      await executePendingToolCall(session, pending, 'Auto-approved read-only', {
        emitApprovalChatMessage: false
      });
      output = await continueResultAssistantTurn(session);
    }
    if (
      output.response.type === 'tool_call_request' &&
      output.response.pendingToolCall &&
      RESULT_ASSISTANT_AUTO_APPROVE_TOOLS.has(output.response.pendingToolCall.tool)
    ) {
      flushDanglingToolCalls(session.llmMessages);
      throw new Error('Result Assistant exceeded auto-approved tool-call chain limit');
    }
    return output;
  };

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
        error:
          'No assistant agent available. Add an agent in Libraries > Agents or configure the Scenario Assistant Agent in Settings.'
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
      referenceReportsForRun: listReferenceReportsForRun(runId),
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
    flushDanglingToolCalls(session.llmMessages);
    session.llmMessages.push({ role: 'user', content: message });
    const output = await continueWithAutoApprovedReads(session);
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
  runId: string
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
        if (!relPath.includes(runId) && !name.includes(runId)) continue;
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
