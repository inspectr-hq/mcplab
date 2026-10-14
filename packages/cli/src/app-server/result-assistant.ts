import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, relative, resolve, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { McpClientManager } from '@inspectr/mcplab-core';
import { throwIfAborted } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import {
  createResultAssistantRuntimeDefinition,
  type PreparedResultAssistantSession,
  type ResultAssistantSession
} from './result-assistant-domain.js';
import {
  cleanupResultAssistantSessions,
  resultAssistantSessionView,
  touchResultAssistantSession
} from './result-assistant-domain.js';
import {
  broadcastAssistantSseEvent,
  createAssistantSseEvent,
  endAssistantSseClients,
  createAssistantRequestAbortController,
  serveAssistantSseStream,
  type AssistantSseEventType
} from './assistant-events.js';
import { createAssistantRuntimeService } from './assistant-service.js';

export type ResultAssistantRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'getRunResults'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'resolveAssistantAgentFromLibraries'
  | 'preloadResultAssistantTools'
  | 'assistantRuntimeFactory'
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
    resolveAssistantAgentFromLibraries,
    preloadResultAssistantTools,
    assistantRuntimeFactory
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
    const mcp = new McpClientManager();
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
      toolsLoaded: 0,
      toolServers: [],
      initialMessages: [],
      events: [],
      clients: new Set()
    };
    const prepared: PreparedResultAssistantSession = {
      ...session,
      mcp,
      tools: [],
      toolPublicMap: new Map()
    };
    session.initialMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      text:
        scope === 'all_runs'
          ? 'Result Assistant session created for all historical runs.'
          : 'Result Assistant session created.',
      createdAt: new Date().toISOString()
    });
    try {
      await preloadResultAssistantTools(prepared, localMcplabMcpUrl());
      session.toolsLoaded = prepared.tools.length;
      session.toolServers = Array.from(
        new Set(prepared.tools.map((tool) => tool.name.split('__')[0]))
      );
    } catch (error) {
      session.initialMessages.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'system',
        text: `Warning: could not preload MCPLab MCP tools: ${errorMessage(error)}`,
        createdAt: new Date().toISOString()
      });
      publishSessionEvent(session, 'session_warning', { warning: errorMessage(error) });
    }
    const runtimeDefinition = createResultAssistantRuntimeDefinition(prepared, () =>
      listReferenceReportsForRun(session.runId)
    );
    runtimeDefinition.onEvent = (event) => {
      touchResultAssistantSession(session);
      publishSessionEvent(session, event.type, event.payload);
    };
    session.runtime = await createAssistantRuntimeService(
      assistantRuntimeFactory,
      runtimeDefinition,
      () => touchResultAssistantSession(session)
    );
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
    resultAssistantSessions.delete(sessionId);
    if (disposeError) asJson(res, 500, { error: errorMessage(disposeError) });
    else asJson(res, 200, { ok: true });
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
      const normalizedResponse =
        response.type !== 'assistant_message'
          ? {
              type: response.type,
              text: response.text,
              pendingToolCall: response.pendingToolCalls[0],
              pendingToolCalls: response.pendingToolCalls
            }
          : response;
      asJson(res, 200, {
        session: resultAssistantSessionView(session),
        response: normalizedResponse
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
    const pending = session
      .runtime!.getSnapshot()
      .pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Result Assistant tool call not found' });
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
      const normalizedResponse = normalizeResultAssistantResponse(response);
      asJson(res, 200, {
        session: resultAssistantSessionView(session),
        response: normalizedResponse
      });
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    } finally {
      abortController.dispose();
    }
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
    const pending = session
      .runtime!.getSnapshot()
      .pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, { error: 'Result Assistant tool call not found' });
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
        session: resultAssistantSessionView(session),
        response: normalizeResultAssistantResponse(response)
      });
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    } finally {
      abortController.dispose();
    }
    return true;
  }

  return false;
}

function normalizeResultAssistantResponse(
  response: import('@inspectr/mcplab-core').AssistantRuntimeResponse
) {
  return response.type === 'assistant_message'
    ? response
    : {
        type: response.type,
        text: response.text,
        pendingToolCall: response.pendingToolCalls[0],
        pendingToolCalls: response.pendingToolCalls
      };
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
