import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, relative, resolve, sep } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import {
  setupResultAssistantSession,
  type ResultAssistantReferenceReport,
  type ResultAssistantSession,
  type ResultAssistantSessionInitializer
} from './result-assistant-domain.js';
import {
  cleanupResultAssistantSessions,
  resultAssistantSessionView,
  touchResultAssistantSession
} from './result-assistant-domain.js';
import { handleAssistantSessionRoutes } from './assistant-session-routes.js';
import {
  broadcastAssistantSseEvent,
  createAssistantSseEvent,
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
        ...(type === 'assistant_message_delta'
          ? {}
          : { session: resultAssistantSessionView(session) }),
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
    const sessionInitializer: ResultAssistantSessionInitializer = {
      id: `ras-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scope,
      runId: scope === 'run' ? runId : null,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      selectedAssistantAgentName: assistantAgentName,
      model: agentConfig.model,
      provider: agentConfig.provider,
      toolsLoaded: 0,
      toolServers: [],
      initialMessages: [],
      clients: new Set()
    };
    sessionInitializer.initialMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      text:
        scope === 'all_runs'
          ? 'Result Assistant session created for all historical runs.'
          : 'Result Assistant session created.',
      createdAt: new Date().toISOString()
    });
    const session = await setupResultAssistantSession({
      session: sessionInitializer,
      agentConfig,
      resultSummary: results,
      referenceReportsForRun: listReferenceReportsForRun(scope === 'run' ? runId : null),
      mcpServerUrl: localMcplabMcpUrl(),
      refreshReports: () => listReferenceReportsForRun(sessionInitializer.runId),
      assistantRuntimeFactory,
      onEvent: (event, readySession) => {
        touchResultAssistantSession(readySession);
        publishSessionEvent(readySession, event.type, event.payload);
      },
      onActivity: touchResultAssistantSession
    });
    resultAssistantSessions.set(session.id, session);
    publishSessionEvent(session, 'session_started');
    asJson(res, 201, { sessionId: session.id, session: resultAssistantSessionView(session) });
    return true;
  }

  return handleAssistantSessionRoutes({
    req,
    res,
    pathname,
    method,
    prefix: '/api/result-assistant/sessions',
    assistantLabel: 'Result Assistant',
    parseBody,
    asJson,
    sessions: resultAssistantSessions,
    cleanup: () => cleanupResultAssistantSessions(resultAssistantSessions),
    touch: touchResultAssistantSession,
    view: resultAssistantSessionView,
    finish: (session) => publishSessionEvent(session, 'session_finished')
  });
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
): ResultAssistantReferenceReport[] {
  const root = resolve(workspaceRoot, 'mcplab/reports');
  const out: ResultAssistantReferenceReport[] = [];
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
