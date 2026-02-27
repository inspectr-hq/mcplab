import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { AppRouteDeps, AppRouteRequestContext, ToolAnalysisJobsMap } from './app-context.js';
import type { ToolAnalysisJob } from './tool-analysis-domain.js';
import {
  createToolAnalysisReportId,
  deleteToolAnalysisReportRecord,
  deleteToolAnalysisReportRecordFromDirs,
  listToolAnalysisReports,
  listToolAnalysisReportsFromDirs,
  readToolAnalysisReportRecord,
  readToolAnalysisReportRecordFromDirs,
  writeToolAnalysisReportRecord
} from './tool-analysis-storage.js';

export type ToolAnalysisRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'addJobEvent'
  | 'sendSseEvent'
  | 'readLibraries'
  | 'discoverMcpToolsForServers'
  | 'runToolAnalysisJob'
>;

function defaultNewToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/tool-analysis');
}

function defaultLegacyToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/tool-analysis-results');
}

function resolveToolAnalysisReadDirs(settings: AppRouteRequestContext['settings']): string[] {
  const dirs = [settings.toolAnalysisResultsDir];
  const expectedNew = defaultNewToolAnalysisResultsDir(settings.workspaceRoot);
  const legacy = defaultLegacyToolAnalysisResultsDir(settings.workspaceRoot);
  if (settings.toolAnalysisResultsDir === expectedNew && legacy !== expectedNew) dirs.push(legacy);
  return dirs;
}

export async function handleToolAnalysisRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  toolAnalysisJobs: ToolAnalysisJobsMap;
  deps: ToolAnalysisRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, toolAnalysisJobs, deps } = params;
  const {
    parseBody,
    asJson,
    addJobEvent,
    sendSseEvent,
    readLibraries,
    discoverMcpToolsForServers,
    runToolAnalysisJob
  } = deps;

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

  if (pathname === '/api/tool-analysis/discover-tools' && method === 'POST') {
    const body = await parseBody(req);
    const serverNames = Array.isArray(body.serverNames)
      ? body.serverNames.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    if (serverNames.length !== 1) {
      asJson(res, 400, { error: 'Select exactly one MCP server for tool analysis' });
      return true;
    }
    const libraries = readLibraries(settings.librariesDir);
    const { servers } = await discoverMcpToolsForServers(libraries.servers, serverNames);
    asJson(res, 200, {
      servers: servers.map((entry) => ({
        serverName: entry.serverName,
        warnings: entry.warnings,
        tools: entry.tools.map((tool) => ({
          name: tool.tool.name,
          description: tool.tool.description,
          inputSchema: tool.tool.inputSchema,
          safetyClassification: tool.safetyClassification,
          classificationReason: tool.classificationReason
        }))
      }))
    });
    return true;
  }

  if (pathname === '/api/tool-analysis/jobs' && method === 'POST') {
    const body = await parseBody(req);
    const serverNames = Array.isArray(body.serverNames)
      ? body.serverNames.map((v: unknown) => String(v).trim()).filter(Boolean)
      : [];
    const modes = {
      metadataReview: Boolean(body?.modes?.metadataReview),
      deeperAnalysis: Boolean(body?.modes?.deeperAnalysis)
    };
    if (serverNames.length !== 1) {
      asJson(res, 400, { error: 'Select exactly one MCP server for tool analysis' });
      return true;
    }
    if (!modes.metadataReview && !modes.deeperAnalysis) {
      asJson(res, 400, { error: 'Select at least one analysis mode' });
      return true;
    }
    const selectedToolsByServer =
      body.selectedToolsByServer && typeof body.selectedToolsByServer === 'object'
        ? (body.selectedToolsByServer as Record<string, string[]>)
        : undefined;
    const deeperOptions = body.deeperAnalysisOptions ?? {};
    const maxParallelTools = Math.max(
      1,
      Math.min(8, Number(body.maxParallelTools ?? deeperOptions.maxParallelTools ?? 2) || 2)
    );
    const jobId = `ta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: ToolAnalysisJob = {
      id: jobId,
      status: 'running',
      events: [],
      clients: new Set(),
      abortController: new AbortController()
    };
    toolAnalysisJobs.set(jobId, job);
    addJobEvent(job, {
      type: 'started',
      ts: new Date().toISOString(),
      payload: {
        serverNames,
        modes,
        assistantAgentName: body.assistantAgentName ? String(body.assistantAgentName) : null,
        maxParallelTools
      }
    });
    void (async () => {
      try {
        await runToolAnalysisJob({
          job,
          settings,
          requestedAssistantAgentName: body.assistantAgentName
            ? String(body.assistantAgentName)
            : undefined,
          serverNames,
          selectedToolsByServer,
          modes,
          deeper: {
            autoRunPolicy: 'read_only_allowlist',
            sampleCallsPerTool: Math.max(
              1,
              Math.min(5, Number(deeperOptions.sampleCallsPerTool ?? 1) || 1)
            ),
            toolCallTimeoutMs: Math.max(
              1000,
              Math.min(60_000, Number(deeperOptions.toolCallTimeoutMs ?? 10_000) || 10_000)
            )
          },
          maxParallelTools
        });
        if (job.result) {
          try {
            const reportId = createToolAnalysisReportId(new Date(job.result.createdAt));
            const savedPath = writeToolAnalysisReportRecord(settings.toolAnalysisResultsDir, {
              recordVersion: 1,
              reportId,
              createdAt: job.result.createdAt,
              sourceJobId: job.id,
              serverNames,
              report: job.result
            });
            job.savedReportId = reportId;
            job.savedReportPath = savedPath;
          } catch (persistError: unknown) {
            addJobEvent(job, {
              type: 'log',
              ts: new Date().toISOString(),
              payload: {
                kind: 'persist',
                message: `Tool analysis completed but report could not be persisted: ${errorMessage(
                  persistError
                )}`
              }
            });
          }
        }
        job.status = 'completed';
        addJobEvent(job, {
          type: 'completed',
          ts: new Date().toISOString(),
          payload: {
            summary: job.result?.summary ?? null,
            savedReportId: job.savedReportId ?? null
          }
        });
      } catch (error: unknown) {
        const aborted = job.abortController.signal.aborted || job.status === 'stopped';
        job.status = aborted ? 'stopped' : 'error';
        addJobEvent(job, {
          type: 'error',
          ts: new Date().toISOString(),
          payload: {
            message: aborted ? 'Tool analysis aborted by user' : errorMessage(error)
          }
        });
      } finally {
        for (const client of job.clients) client.end();
        job.clients.clear();
        setTimeout(() => {
          toolAnalysisJobs.delete(job.id);
        }, 30 * 60_000).unref?.();
      }
    })();
    asJson(res, 202, { jobId });
    return true;
  }

  if (pathname === '/api/tool-analysis-results' && method === 'GET') {
    asJson(res, 200, {
      items: listToolAnalysisReportsFromDirs(resolveToolAnalysisReadDirs(settings))
    });
    return true;
  }

  if (pathname.startsWith('/api/tool-analysis-results/') && method === 'GET') {
    const reportId = pathname.split('/')[3];
    if (!reportId) {
      asJson(res, 400, { error: 'Report id is required' });
      return true;
    }
    const record = readToolAnalysisReportRecordFromDirs(
      resolveToolAnalysisReadDirs(settings),
      reportId
    );
    if (!record) {
      asJson(res, 404, { error: 'Tool analysis report not found' });
      return true;
    }
    asJson(res, 200, record);
    return true;
  }

  if (pathname.startsWith('/api/tool-analysis-results/') && method === 'DELETE') {
    const reportId = pathname.split('/')[3];
    if (!reportId) {
      asJson(res, 400, { error: 'Report id is required' });
      return true;
    }
    const deleted = deleteToolAnalysisReportRecordFromDirs(
      resolveToolAnalysisReadDirs(settings),
      reportId
    );
    if (!deleted) {
      asJson(res, 404, { error: 'Tool analysis report not found' });
      return true;
    }
    asJson(res, 200, { ok: true });
    return true;
  }

  if (
    pathname.startsWith('/api/tool-analysis/jobs/') &&
    pathname.endsWith('/events') &&
    method === 'GET'
  ) {
    const jobId = pathname.split('/')[4];
    const job = toolAnalysisJobs.get(jobId);
    if (!job) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    for (const event of job.events) sendSseEvent(res, event);
    if (job.status !== 'running') {
      res.end();
      return true;
    }
    job.clients.add(res);
    req.on('close', () => {
      job.clients.delete(res);
    });
    return true;
  }

  if (
    pathname.startsWith('/api/tool-analysis/jobs/') &&
    pathname.endsWith('/result') &&
    method === 'GET'
  ) {
    const jobId = pathname.split('/')[4];
    const job = toolAnalysisJobs.get(jobId);
    if (!job) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    if (!job.result) {
      asJson(res, 409, { error: `Job not completed (status=${job.status})` });
      return true;
    }
    asJson(res, 200, { jobId, report: job.result, savedReportId: job.savedReportId });
    return true;
  }

  if (
    pathname.startsWith('/api/tool-analysis/jobs/') &&
    pathname.endsWith('/stop') &&
    method === 'POST'
  ) {
    const jobId = pathname.split('/')[4];
    const job = toolAnalysisJobs.get(jobId);
    if (!job) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    if (job.status !== 'running') {
      asJson(res, 200, { ok: true, status: job.status });
      return true;
    }
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        kind: 'job_control',
        action: 'stop_requested',
        message: 'Stop requested by user'
      }
    });
    job.status = 'stopped';
    job.abortController.abort();
    asJson(res, 200, { ok: true, status: 'stopped' });
    return true;
  }

  return false;
}
