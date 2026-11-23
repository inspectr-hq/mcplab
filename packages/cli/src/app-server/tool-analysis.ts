import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getMcpResourceToolAccess,
  McpClientManager,
  MCP_READ_RESOURCE_TOOL,
  parseMcpResourceToolRead
} from '@inspectr/mcplab-core';
import type { EvalConfig, McpPreviewRequest, McpPreviewResponse } from '@inspectr/mcplab-core';
import type { AppRouteDeps, AppRouteRequestContext, ToolAnalysisJobsMap } from './app-context.js';
import type { ToolAnalysisJob } from './tool-analysis-domain.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
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
import {
  defaultLegacyToolAnalysisResultsDir,
  defaultNewToolAnalysisResultsDir
} from './workspace-paths.js';

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

function normalizeSafetyClassification(value: unknown): unknown {
  return value === 'read_like' ? 'read_only' : value;
}

function normalizeToolAnalysisReportSafety<
  T extends { servers?: Array<{ tools?: Array<{ safetyClassification?: unknown }> }> }
>(report: T): T {
  if (!report || !Array.isArray(report.servers)) return report;
  for (const server of report.servers) {
    if (!server || !Array.isArray(server.tools)) continue;
    for (const tool of server.tools) {
      if (!tool) continue;
      tool.safetyClassification = normalizeSafetyClassification(tool.safetyClassification);
    }
  }
  return report;
}

function resolveToolAnalysisReadDirs(settings: AppRouteRequestContext['settings']): string[] {
  const dirs = [settings.toolAnalysisResultsDir];
  const expectedNew = defaultNewToolAnalysisResultsDir(settings.workspaceRoot);
  const legacy = defaultLegacyToolAnalysisResultsDir(settings.workspaceRoot);
  if (settings.toolAnalysisResultsDir === expectedNew && legacy !== expectedNew) dirs.push(legacy);
  return dirs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePreviewRequest(body: unknown): McpPreviewRequest | null {
  if (!isRecord(body) || typeof body.serverName !== 'string' || !body.serverName.trim()) {
    return null;
  }
  const serverName = body.serverName.trim();
  if (body.kind === 'resource' && typeof body.uri === 'string') {
    const uri = body.uri.trim();
    if (!/^[a-z][a-z\d+.-]*:[^\s{}]*$/i.test(uri)) return null;
    if (body.via === 'tool') return { kind: 'resource', serverName, uri, via: 'tool' };
    return body.via === undefined ? { kind: 'resource', serverName, uri } : null;
  }
  if (body.kind !== 'prompt' || typeof body.name !== 'string' || !body.name.trim()) return null;
  const args = body.arguments;
  if (args === undefined) return { kind: 'prompt', serverName, name: body.name };
  if (!isRecord(args) || !Object.values(args).every((value) => typeof value === 'string'))
    return null;
  return { kind: 'prompt', serverName, name: body.name, arguments: args as Record<string, string> };
}

export async function handleToolAnalysisRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  toolAnalysisJobs: ToolAnalysisJobsMap;
  oauthSessionManager: OAuthSessionManager;
  deps: ToolAnalysisRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, toolAnalysisJobs, oauthSessionManager, deps } =
    params;
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

  async function analysisConnectionOptions(servers: EvalConfig['servers'], serverNames: string[]) {
    const oauthServers = serverNames.filter(
      (name) =>
        Object.hasOwn(servers, name) && servers[name]?.auth?.type === 'oauth_authorization_code'
    );
    try {
      return {
        serverAuthHeaders:
          oauthServers.length > 0
            ? await oauthSessionManager.getAuthHeadersForServers(oauthServers, req.headers.host)
            : undefined
      };
    } catch (error) {
      if (!(error instanceof OAuthAuthorizationRequiredError)) throw error;
      asJson(res, 401, { error: error.message, oauth: { required: error.details } });
      return null;
    }
  }

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
    const connectionOptions = await analysisConnectionOptions(libraries.servers, serverNames);
    if (!connectionOptions) return true;
    const discoveryOptions = {
      ...connectionOptions,
      ...(serverNames.some(
        (name: string) => libraries.servers[name]?.auth?.type === 'oauth_authorization_code'
      )
        ? {
            refreshOAuthHeaders: async (name: string) => {
              const refreshed = await oauthSessionManager.refreshAfterUnauthorized(name);
              if (!refreshed) {
                return oauthSessionManager.reauthorizeAfterUnauthorized(name, req.headers.host);
              }
              const headers = await oauthSessionManager.getAuthHeadersForServers(
                [name],
                req.headers.host
              );
              return headers[name];
            },
            reauthorizeOAuth: (name: string) =>
              oauthSessionManager.reauthorizeAfterUnauthorized(name, req.headers.host)
          }
        : {}),
      includeCatalog: body.includeCatalog === true,
      ...(body.includeToolResources === true ? { includeToolResources: true } : {})
    };
    let discovered: Awaited<ReturnType<typeof discoverMcpToolsForServers>>;
    try {
      discovered = await discoverMcpToolsForServers(
        libraries.servers,
        serverNames,
        discoveryOptions
      );
    } catch (error: unknown) {
      if (error instanceof OAuthAuthorizationRequiredError) {
        asJson(res, 401, { error: error.message, oauth: { required: error.details } });
        return true;
      }
      throw error;
    }
    const { mcp, servers } = discovered;
    try {
      const mcpServerVersions = mcp.getServerVersions();
      const mcpServerImplementations = mcp.getServerImplementations();
      asJson(res, 200, {
        servers: servers.map((entry) => ({
          serverName: entry.serverName,
          mcpServerVersion: mcpServerVersions[entry.serverName] ?? null,
          mcpServerImplementation: mcpServerImplementations[entry.serverName] ?? null,
          warnings: entry.warnings,
          tokenEstimate: entry.tokenEstimate,
          ...(entry.catalog ? { catalog: entry.catalog } : {}),
          tools: entry.tools.map((tool) => ({
            name: tool.tool.name,
            title: tool.tool.title,
            description: tool.tool.description,
            inputSchema: tool.tool.inputSchema,
            outputSchema: tool.tool.outputSchema,
            safetyClassification: tool.safetyClassification,
            classificationReason: tool.classificationReason
          }))
        }))
      });
    } finally {
      await mcp.disconnectAll();
    }
    return true;
  }

  if (pathname === '/api/tool-analysis/preview' && method === 'POST') {
    const body: unknown = await parseBody(req).catch((error) => {
      if (!(error instanceof SyntaxError)) throw error;
      return null;
    });
    const preview = parsePreviewRequest(body);
    if (!preview) {
      asJson(res, 400, {
        error: 'Provide a server and a resource URI or prompt name with string arguments.'
      });
      return true;
    }
    const { serverName } = preview;
    const { servers } = readLibraries(settings.librariesDir);
    if (!Object.hasOwn(servers, serverName)) {
      asJson(res, 404, { error: `Server '${serverName}' not found.` });
      return true;
    }
    const connectionOptions = await analysisConnectionOptions(servers, [serverName]);
    if (!connectionOptions || res.destroyed) return true;

    const mcp = new McpClientManager();
    const controller = new AbortController();
    const { signal } = controller;
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      await mcp.connectAll({ [serverName]: servers[serverName] }, signal, connectionOptions);
      const features = mcp.getServerFeatures(serverName);
      if (preview.kind === 'resource' && preview.via === 'tool') {
        const tools = features.tools ? await mcp.listTools(serverName, signal) : [];
        const { readArgument } = getMcpResourceToolAccess(tools);
        if (!readArgument) {
          if (!signal.aborted)
            asJson(res, 400, {
              error: 'The server needs a compatible read_resource tool to preview this resource.'
            });
          return true;
        }
        const result = await mcp.callTool(
          serverName,
          MCP_READ_RESOURCE_TOOL,
          { [readArgument]: preview.uri },
          { signal }
        );
        const response: McpPreviewResponse = {
          kind: 'resource',
          contents: parseMcpResourceToolRead(preview.uri, result)
        };
        if (!signal.aborted) asJson(res, 200, response);
        return true;
      }
      const feature = preview.kind === 'resource' ? 'resources' : 'prompts';
      if (!features[feature]) {
        asJson(res, 400, { error: `Server '${serverName}' does not advertise ${feature}.` });
        return true;
      }
      const response: McpPreviewResponse =
        preview.kind === 'resource'
          ? { kind: 'resource', contents: await mcp.readResource(serverName, preview.uri, signal) }
          : {
              kind: 'prompt',
              ...(await mcp.getPrompt(serverName, preview.name, preview.arguments, signal))
            };
      if (!signal.aborted) asJson(res, 200, response);
    } catch (error: unknown) {
      if (!signal.aborted) asJson(res, 502, { error: errorMessage(error) });
    } finally {
      res.off('close', abort);
      await mcp.disconnectAll();
    }
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
          oauthSessionManager,
          hostHeader: req.headers.host,
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
    const url = new URL(
      req.url ?? '/api/tool-analysis-results',
      `http://${req.headers.host ?? 'localhost'}`
    );
    const limitRaw = Number(url.searchParams.get('limit'));
    const offsetRaw = Number(url.searchParams.get('offset'));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const serverFilter = String(url.searchParams.get('server') ?? '').trim();
    const all = listToolAnalysisReportsFromDirs(resolveToolAnalysisReadDirs(settings)).filter(
      (item) => (serverFilter ? item.serverNames.includes(serverFilter) : true)
    );
    const data = all.slice(offset, offset + limit);
    const totalCount = all.length;
    const hasMore = offset + data.length < totalCount;
    const nextOffset = hasMore ? offset + data.length : null;
    const prevOffset = offset > 0 ? Math.max(0, offset - limit) : null;
    asJson(res, 200, {
      object: 'list',
      url: `${pathname}${url.search}`,
      data,
      has_more: hasMore,
      total_count: totalCount,
      next_offset: nextOffset,
      prev_offset: prevOffset
    });
    return true;
  }

  if (pathname === '/api/tool-analysis-results/servers' && method === 'GET') {
    const all = listToolAnalysisReportsFromDirs(resolveToolAnalysisReadDirs(settings));
    const servers = Array.from(new Set(all.flatMap((item) => item.serverNames))).sort((a, b) =>
      a.localeCompare(b)
    );
    asJson(res, 200, { object: 'list', data: servers });
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
    if (record?.report) normalizeToolAnalysisReportSafety(record.report);
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
    res.on('close', () => {
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
    asJson(res, 200, {
      jobId,
      report: normalizeToolAnalysisReportSafety(job.result),
      savedReportId: job.savedReportId
    });
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
