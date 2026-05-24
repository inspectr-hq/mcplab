import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  McpClientManager,
  loadConfig,
  hashConfig,
  runAll,
  renderSummaryMarkdown,
  applyRuntimeServerOverrides,
  type EvalConfig,
  type RunProgressEvent
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import type { SseEvent } from './jobs.js';
import type { RunQueueState, AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
import { selectScenarioIds } from './runs-store.js';
import { readLibraries as readLibrariesFromStore } from './libraries-store.js';

export type RunsRouteDeps = Pick<
  AppRouteDeps,
  | 'parseBody'
  | 'asJson'
  | 'addJobEvent'
  | 'sendSseEvent'
  | 'ensureInsideRoot'
  | 'listRuns'
  | 'getRunResults'
  | 'getScenarioRunTraceRecords'
  | 'selectScenarioIds'
  | 'expandConfigForAgents'
  | 'resolveRunSelectedAgents'
  | 'loadSnapshot'
  | 'compareRunToSnapshot'
  | 'applySnapshotPolicyToRunResult'
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'pkgVersion'
>;

type RunParams = {
  configPath: string;
  runsPerScenario: number;
  scenarioId?: string;
  scenarioIds?: string[];
  requestedAgents?: string[];
  applySnapshotEval: boolean;
  runNote?: string;
  oauthServerNames?: string[]; // cached at enqueue time to avoid re-parsing config
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
};

type RunJob = {
  id: string;
  status: 'queued' | 'blocked_auth' | 'running' | 'stopped' | 'completed' | 'error';
  events: SseEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
  runParams: RunParams;
  blockedAuthServers?: string[]; // actual missing-token subset set when blocked
};

export function mergeLibraryEntriesIntoConfig(
  config: EvalConfig,
  libraryAgents: EvalConfig['agents'],
  libraryServers: EvalConfig['servers']
): EvalConfig {
  return {
    ...config,
    agents: { ...libraryAgents, ...config.agents },
    servers: { ...libraryServers, ...config.servers }
  };
}

export function applyLibraryEntries(
  loaded: { config: EvalConfig; hash: string },
  libraryAgents: EvalConfig['agents'],
  libraryServers: EvalConfig['servers']
): void {
  loaded.config = mergeLibraryEntriesIntoConfig(loaded.config, libraryAgents, libraryServers);
  loaded.hash = hashConfig(loaded.config);
}

// Backward-compatible exports used by existing tests/imports.
export function mergeLibraryAgentsIntoConfig(
  config: EvalConfig,
  libraryAgents: EvalConfig['agents']
): EvalConfig {
  return mergeLibraryEntriesIntoConfig(config, libraryAgents, {});
}

export function applyLibraryAgents(
  loaded: { config: EvalConfig; hash: string },
  libraryAgents: EvalConfig['agents']
): void {
  applyLibraryEntries(loaded, libraryAgents, {});
}

type RunRequestBody = {
  configPath?: unknown;
  runsPerScenario?: unknown;
  scenarioId?: unknown;
  scenarioIds?: unknown;
  agents?: unknown;
  applySnapshotEval?: unknown;
  runNote?: unknown;
  serverOverrideAll?: unknown;
  scenarioServerOverrides?: unknown;
};

type PreviewRunRequestBody = {
  selectedAgentName?: unknown;
  scenario?: {
    id?: unknown;
    name?: unknown;
    prompt?: unknown;
    serverNames?: unknown;
    evalRules?: unknown;
    extractRules?: unknown;
  };
};

type ConfigScenario = EvalConfig['scenarios'][number];

export async function handleRunsRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  jobs: Map<string, RunJob>;
  runQueueState: RunQueueState;
  oauthSessionManager: OAuthSessionManager;
  deps: RunsRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, jobs, runQueueState, oauthSessionManager, deps } =
    params;
  const {
    parseBody,
    asJson,
    addJobEvent,
    sendSseEvent,
    ensureInsideRoot,
    listRuns,
    getRunResults,
    getScenarioRunTraceRecords,
    selectScenarioIds,
    expandConfigForAgents,
    resolveRunSelectedAgents,
    loadSnapshot,
    compareRunToSnapshot,
    applySnapshotPolicyToRunResult,
    readLibraries,
    pickDefaultAssistantAgentName,
    pkgVersion
  } = deps;

  if (pathname === '/api/runs' && method === 'GET') {
    const requestUrl = new URL(req.url ?? '/api/runs', 'http://localhost');
    const since = requestUrl.searchParams.get('since') ?? undefined;
    const until = requestUrl.searchParams.get('until') ?? undefined;
    const lastDaysRaw = requestUrl.searchParams.get('last_days');
    const lastDaysParsed = lastDaysRaw === null ? NaN : Number(lastDaysRaw);
    const lastDays =
      Number.isFinite(lastDaysParsed) && lastDaysParsed > 0
        ? Math.floor(lastDaysParsed)
        : undefined;
    asJson(
      res,
      200,
      listRuns(settings.runsDir, {
        since,
        until,
        lastDays
      })
    );
    return true;
  }

  if (pathname.startsWith('/api/runs/') && pathname.endsWith('/trace') && method === 'GET') {
    const runId = pathname.split('/')[3];
    asJson(res, 200, { runId, records: getScenarioRunTraceRecords(runId, settings.runsDir) });
    return true;
  }

  if (pathname.startsWith('/api/runs/jobs/') && pathname.endsWith('/events') && method === 'GET') {
    const jobId = pathname.split('/')[4];
    const job = jobs.get(jobId);
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
    if (job.status !== 'running' && job.status !== 'queued' && job.status !== 'blocked_auth') {
      res.end();
      return true;
    }
    job.clients.add(res);
    req.on('close', () => {
      job.clients.delete(res);
    });
    return true;
  }

  if (pathname.startsWith('/api/runs/jobs/') && pathname.endsWith('/stop') && method === 'POST') {
    const jobId = pathname.split('/')[4];
    const job = jobs.get(jobId);
    if (!job) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    if (job.status === 'queued') {
      const idx = runQueueState.queue.indexOf(jobId);
      if (idx !== -1) runQueueState.queue.splice(idx, 1);
      job.status = 'stopped';
      addJobEvent(job, {
        type: 'error',
        ts: new Date().toISOString(),
        payload: { message: 'Run stopped before it started' }
      });
      for (const client of job.clients) client.end();
      job.clients.clear();
      asJson(res, 200, { ok: true, status: 'stopped' });
      return true;
    }
    if (job.status !== 'running') {
      asJson(res, 200, { ok: true, status: job.status });
      return true;
    }
    job.abortController.abort();
    job.status = 'stopped';
    asJson(res, 200, { ok: true, status: 'stopped' });
    return true;
  }

  if (pathname === '/api/runs/queue' && method === 'GET') {
    const activeJob = runQueueState.activeJobId ? jobs.get(runQueueState.activeJobId) : null;
    const queuedEntries = runQueueState.queue
      .map((id) => jobs.get(id))
      .filter((j): j is RunJob => !!j && (j.status === 'queued' || j.status === 'blocked_auth'))
      .map((j) => ({
        jobId: j.id,
        status: j.status,
        blockedReason: j.status === 'blocked_auth' ? ('oauth_required' as const) : undefined,
        requiredServers: j.status === 'blocked_auth' ? j.blockedAuthServers ?? [] : undefined,
        runParams: {
          configPath: j.runParams.configPath,
          runsPerScenario: j.runParams.runsPerScenario,
          scenarioIds: j.runParams.scenarioIds ?? null,
          agents: j.runParams.requestedAgents ?? null,
          runNote: j.runParams.runNote ?? null,
          serverOverrideAll: j.runParams.serverOverrideAll ?? null,
          scenarioServerOverrides: j.runParams.scenarioServerOverrides ?? null
        }
      }));
    asJson(res, 200, {
      active: activeJob
        ? {
            jobId: activeJob.id,
            status: activeJob.status,
            runParams: {
              configPath: activeJob.runParams.configPath,
              runsPerScenario: activeJob.runParams.runsPerScenario,
              scenarioIds: activeJob.runParams.scenarioIds ?? null,
              agents: activeJob.runParams.requestedAgents ?? null,
              runNote: activeJob.runParams.runNote ?? null,
              serverOverrideAll: activeJob.runParams.serverOverrideAll ?? null,
              scenarioServerOverrides: activeJob.runParams.scenarioServerOverrides ?? null
            }
          }
        : null,
      queued: queuedEntries
    });
    return true;
  }

  if (
    pathname.startsWith('/api/runs/queue/') &&
    method === 'DELETE' &&
    pathname.split('/').length === 5
  ) {
    const jobId = pathname.split('/')[4];
    const job = jobs.get(jobId);
    if (!job) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    if (job.status === 'running') {
      asJson(res, 400, { error: 'Cannot remove a running job. Use the /stop endpoint instead.' });
      return true;
    }
    if (job.status !== 'queued' && job.status !== 'blocked_auth') {
      asJson(res, 404, { error: 'Job is not queued' });
      return true;
    }
    const wasBlocked = job.status === 'blocked_auth';
    const idx = runQueueState.queue.indexOf(jobId);
    if (idx !== -1) runQueueState.queue.splice(idx, 1);
    job.status = 'stopped';
    addJobEvent(job, {
      type: 'error',
      ts: new Date().toISOString(),
      payload: { message: 'Removed from queue by user' }
    });
    for (const client of job.clients) client.end();
    job.clients.clear();
    if (wasBlocked) {
      void advanceQueue(jobs, runQueueState, settings, oauthSessionManager, deps);
    }
    asJson(res, 200, { ok: true, jobId, status: 'stopped' });
    return true;
  }

  if (pathname === '/api/runs/queue/resume' && method === 'POST') {
    void advanceQueue(jobs, runQueueState, settings, oauthSessionManager, deps);
    asJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/runs' && method === 'POST') {
    const body = (await parseBody(req)) as RunRequestBody;
    const configPathRaw = String(body.configPath ?? '');
    const runsPerScenario = Number(body.runsPerScenario ?? 1);
    const scenarioId = body.scenarioId ? String(body.scenarioId) : undefined;
    const scenarioIds = Array.isArray(body.scenarioIds)
      ? body.scenarioIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : undefined;
    const requestedAgents = Array.isArray(body.agents)
      ? body.agents.map((agent: unknown) => String(agent).trim()).filter(Boolean)
      : undefined;
    const applySnapshotEval = body.applySnapshotEval !== false;
    const runNoteRaw = typeof body.runNote === 'string' ? body.runNote.trim() : '';
    const runNote = runNoteRaw ? runNoteRaw.slice(0, 500) : undefined;
    const serverOverrideAll = Array.isArray(body.serverOverrideAll)
      ? body.serverOverrideAll.map((id: unknown) => String(id).trim()).filter(Boolean)
      : undefined;
    if (
      Array.isArray(body.serverOverrideAll) &&
      (!serverOverrideAll || serverOverrideAll.length === 0)
    ) {
      asJson(res, 400, { error: 'serverOverrideAll must include at least one server id' });
      return true;
    }
    if (
      body.scenarioServerOverrides !== undefined &&
      (typeof body.scenarioServerOverrides !== 'object' ||
        body.scenarioServerOverrides === null ||
        Array.isArray(body.scenarioServerOverrides))
    ) {
      asJson(res, 400, {
        error: 'scenarioServerOverrides must be an object of scenarioId -> string[]'
      });
      return true;
    }
    let scenarioServerOverrides: Record<string, string[]> | undefined;
    if (body.scenarioServerOverrides && typeof body.scenarioServerOverrides === 'object') {
      const normalizedEntries: Array<[string, string[]]> = [];
      for (const [rawScenarioId, rawServerIds] of Object.entries(
        body.scenarioServerOverrides as Record<string, unknown>
      )) {
        const scenarioOverrideId = String(rawScenarioId).trim();
        if (!scenarioOverrideId) continue;
        if (!Array.isArray(rawServerIds)) {
          asJson(res, 400, {
            error: `scenarioServerOverrides.${scenarioOverrideId} must be an array of server ids`
          });
          return true;
        }
        normalizedEntries.push([
          scenarioOverrideId,
          rawServerIds.map((id: unknown) => String(id).trim()).filter(Boolean)
        ]);
      }
      scenarioServerOverrides = Object.fromEntries(normalizedEntries);
    }
    if (!configPathRaw) {
      asJson(res, 400, { error: 'configPath is required' });
      return true;
    }
    if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
      asJson(res, 400, { error: 'runsPerScenario must be a positive number' });
      return true;
    }

    const configPath = isAbsolute(configPathRaw)
      ? ensureInsideRoot(settings.evalsDir, configPathRaw)
      : ensureInsideRoot(settings.evalsDir, join(settings.evalsDir, configPathRaw));
    if (!existsSync(configPath)) {
      asJson(res, 404, { error: `Config not found: ${configPath}` });
      return true;
    }

    // Resolve lazily in advanceQueue so runtime overrides are always reflected.
    const oauthServerNames: string[] | undefined = undefined;

    const jobId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const runParamsObj: RunParams = {
      configPath,
      runsPerScenario,
      scenarioId,
      scenarioIds,
      requestedAgents,
      applySnapshotEval,
      runNote,
      oauthServerNames,
      serverOverrideAll,
      scenarioServerOverrides
    };
    const job: RunJob = {
      id: jobId,
      status: 'queued',
      events: [],
      clients: new Set(),
      abortController: new AbortController(),
      runParams: runParamsObj
    };
    jobs.set(jobId, job);

    if (runQueueState.activeJobId) {
      // Another job is running — queue and emit position
      runQueueState.queue.push(jobId);
      addJobEvent(job, {
        type: 'queued',
        ts: new Date().toISOString(),
        payload: {
          configPath,
          runsPerScenario,
          scenarioId: scenarioId ?? null,
          scenarioIds: scenarioIds ?? null,
          agents: requestedAgents ?? null,
          runNote: runNote ?? null,
          serverOverrideAll: serverOverrideAll ?? null,
          scenarioServerOverrides: scenarioServerOverrides ?? null,
          position: runQueueState.queue.length
        }
      });
      asJson(res, 202, { jobId, queued: true, position: runQueueState.queue.length });
    } else {
      // No active job — add to queue and let advanceQueue handle start (with OAuth pre-check)
      runQueueState.queue.push(jobId);
      asJson(res, 202, { jobId });
      void advanceQueue(jobs, runQueueState, settings, oauthSessionManager, deps);
    }
    return true;
  }

  if (pathname === '/api/runs/preview' && method === 'POST') {
    const body = (await parseBody(req)) as PreviewRunRequestBody;
    const scenarioBody = body.scenario;
    const scenarioId = String(scenarioBody?.id ?? '').trim();
    const scenarioName = String(scenarioBody?.name ?? '').trim();
    const scenarioPrompt = String(scenarioBody?.prompt ?? '').trim();
    const serverNames = Array.isArray(scenarioBody?.serverNames)
      ? scenarioBody.serverNames.map((name) => String(name).trim()).filter(Boolean)
      : [];
    const evalRules = Array.isArray(scenarioBody?.evalRules) ? scenarioBody.evalRules : [];
    const extractRules = Array.isArray(scenarioBody?.extractRules) ? scenarioBody.extractRules : [];
    if (!scenarioId) {
      asJson(res, 400, { error: 'scenario.id is required' });
      return true;
    }
    if (!scenarioPrompt) {
      asJson(res, 400, { error: 'scenario.prompt is required' });
      return true;
    }
    if (serverNames.length === 0) {
      asJson(res, 400, { error: 'scenario.serverNames must include at least one server' });
      return true;
    }

    const libraries = readLibraries(settings.librariesDir);
    const selectedAgentName = pickDefaultAssistantAgentName({
      requested: String(body.selectedAgentName ?? '').trim(),
      settingsDefault: settings.scenarioAssistantAgentName,
      agentNames: Object.keys(libraries.agents)
    });
    if (!selectedAgentName) {
      asJson(res, 400, { error: 'No agent available for preview execution' });
      return true;
    }
    const agent = libraries.agents[selectedAgentName];
    if (!agent) {
      asJson(res, 400, { error: `Agent not found: ${selectedAgentName}` });
      return true;
    }

    const servers: EvalConfig['servers'] = {};
    for (const serverName of serverNames) {
      const server = libraries.servers[serverName];
      if (!server) {
        asJson(res, 400, { error: `Server not found in libraries: ${serverName}` });
        return true;
      }
      servers[serverName] = server;
    }

    const oauthServerNames = serverNames.filter(
      (serverName) => servers[serverName]?.auth?.type === 'oauth_authorization_code'
    );
    let mcpServerAuthHeaders: Record<string, Record<string, string>> | undefined;
    if (oauthServerNames.length > 0) {
      try {
        mcpServerAuthHeaders = await oauthSessionManager.getAuthHeadersForServers(
          oauthServerNames,
          req.headers.host
        );
      } catch (error: unknown) {
        if (error instanceof OAuthAuthorizationRequiredError) {
          asJson(res, 401, { error: error.message, oauth: { required: error.details } });
          return true;
        }
        asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
    }

    const coreEval = toCoreEvalRules(evalRules);
    const coreExtract = toCoreExtractRules(extractRules);
    const previewConfigBase: EvalConfig = {
      name: `Preview ${scenarioId}`,
      servers,
      agents: { [selectedAgentName]: agent },
      scenarios: [
        {
          id: scenarioId,
          ...(scenarioName ? { name: scenarioName } : {}),
          servers: serverNames,
          prompt: scenarioPrompt,
          ...(coreEval ? { eval: coreEval } : {}),
          ...(coreExtract.length > 0 ? { extract: coreExtract } : {})
        }
      ]
    };
    const expandedPreviewConfig = expandConfigForAgents(previewConfigBase, [selectedAgentName]);
    const previewRunsRoot = mkdtempSync(join(tmpdir(), 'mcplab-preview-'));

    try {
      const { results } = await runAll(expandedPreviewConfig, {
        runsPerScenario: 1,
        configHash: hashConfig(previewConfigBase),
        cliVersion: pkgVersion,
        runsDir: resolve(previewRunsRoot),
        mcpServerAuthHeaders
      });
      const scenario = results.scenarios[0];
      const run = scenario?.runs?.[0];
      const traceRecords = getScenarioRunTraceRecords(results.metadata.run_id, previewRunsRoot);
      const traceRecord =
        traceRecords.find(
          (record) => record.scenario_id === scenarioId && record.agent === selectedAgentName
        ) ?? traceRecords[0];
      asJson(res, 200, {
        runId: results.metadata.run_id,
        scenario: {
          scenarioId,
          agent: selectedAgentName,
          run: run ?? null,
          traceRecord: traceRecord ?? null
        }
      });
    } catch (error: unknown) {
      asJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      rmSync(previewRunsRoot, { recursive: true, force: true });
    }
    return true;
  }

  if (
    pathname.startsWith('/api/runs/') &&
    pathname.endsWith('/assistant/apply-report') &&
    method === 'POST'
  ) {
    const runId = pathname.split('/')[3];
    // Validate run exists before writing a report for it.
    getRunResults(runId, settings.runsDir);
    const body = (await parseBody(req)) as {
      markdown?: unknown;
      outputPath?: unknown;
      overwrite?: unknown;
    };
    const markdown = String(body.markdown ?? '');
    const outputPath =
      String(body.outputPath ?? '').trim() || defaultResultAssistantReportPath(runId, new Date());
    const overwrite = Boolean(body.overwrite);
    if (!markdown.trim()) {
      asJson(res, 400, { error: 'markdown is required' });
      return true;
    }

    try {
      const mcp = new McpClientManager();
      const serverName = 'mcplab';
      await mcp.connectAll({
        [serverName]: {
          transport: 'http',
          url: localMcplabMcpUrl()
        }
      });
      const toolResult = await mcp.callTool(serverName, 'mcplab_write_markdown_report', {
        output_path: outputPath,
        markdown,
        overwrite
      });
      const structured =
        toolResult && typeof toolResult === 'object' && 'structuredContent' in (toolResult as any)
          ? (toolResult as any).structuredContent
          : undefined;
      asJson(res, 200, {
        ok: true,
        runId,
        outputPath,
        tool: 'mcplab_write_markdown_report',
        result: toolResult,
        path:
          structured &&
          typeof structured === 'object' &&
          typeof (structured as any).path === 'string'
            ? (structured as any).path
            : undefined
      });
    } catch (error: unknown) {
      asJson(res, 500, {
        error:
          error instanceof Error
            ? `${error.message}. Ensure the MCPLab MCP server is running and exposes mcplab_write_markdown_report.`
            : String(error)
      });
    }
    return true;
  }

  if (pathname.startsWith('/api/runs/') && method === 'GET') {
    const runId = pathname.replace('/api/runs/', '');
    asJson(res, 200, { runId, results: getRunResults(runId, settings.runsDir) });
    return true;
  }

  if (pathname.startsWith('/api/runs/') && pathname.endsWith('/note') && method === 'PATCH') {
    const runId = pathname.replace('/api/runs/', '').replace('/note', '');
    if (!runId || runId.includes('/')) {
      asJson(res, 400, { error: 'Invalid run id' });
      return true;
    }
    const body = (await parseBody(req)) as { runNote?: unknown };
    const runNoteRaw = typeof body.runNote === 'string' ? body.runNote.trim() : '';
    const runNote = runNoteRaw ? runNoteRaw.slice(0, 500) : undefined;
    const runDir = ensureInsideRoot(settings.runsDir, join(settings.runsDir, runId));
    if (!existsSync(runDir)) {
      asJson(res, 404, { error: 'Run not found' });
      return true;
    }
    const results = getRunResults(runId, settings.runsDir);
    if (runNote) {
      results.metadata.run_note = runNote;
    } else {
      delete results.metadata.run_note;
    }
    writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    writeFileSync(join(runDir, 'report.html'), renderReport(results), 'utf8');
    writeFileSync(join(runDir, 'summary.md'), renderSummaryMarkdown(results), 'utf8');
    asJson(res, 200, { ok: true, runId, runNote: runNote ?? null });
    return true;
  }

  if (pathname.startsWith('/api/runs/') && method === 'DELETE') {
    const runId = pathname.replace('/api/runs/', '');
    if (!runId || runId.includes('/')) {
      asJson(res, 400, { error: 'Invalid run id' });
      return true;
    }
    const runDir = ensureInsideRoot(settings.runsDir, join(settings.runsDir, runId));
    if (!existsSync(runDir)) {
      asJson(res, 404, { error: 'Run not found' });
      return true;
    }
    rmSync(runDir, { recursive: true, force: true });
    asJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

function toCoreEvalRules(
  evalRules: unknown[]
): EvalConfig['scenarios'][number]['eval'] | undefined {
  const requiredTools: string[] = [];
  const forbiddenTools: string[] = [];
  const responseAssertions: Array<
    | { type: 'contains'; value: string }
    | { type: 'not_contains'; value: string }
    | { type: 'starts_with'; value: string }
    | { type: 'ends_with'; value: string }
    | { type: 'equals'; value: string }
    | { type: 'regex'; pattern: string }
    | { type: 'jsonpath'; path: string; equals?: string | number | boolean }
    | { type: 'jsonpath_exists'; path: string }
    | { type: 'jsonpath_not_exists'; path: string }
  > = [];

  for (const raw of evalRules) {
    if (!raw || typeof raw !== 'object') continue;
    const rule = raw as { type?: unknown; value?: unknown; path?: unknown; equals?: unknown };
    const type = String(rule.type ?? '').trim();
    const value = String(rule.value ?? '').trim();
    const path = String(rule.path ?? '').trim();
    if (!type) continue;
    if (type === 'required_tool' && value) {
      requiredTools.push(value);
      continue;
    }
    if (type === 'forbidden_tool' && value) {
      forbiddenTools.push(value);
      continue;
    }
    if (type === 'response_contains' && value) {
      responseAssertions.push({ type: 'contains', value });
      continue;
    }
    if (type === 'response_not_contains' && value) {
      responseAssertions.push({ type: 'not_contains', value });
      continue;
    }
    if (type === 'response_starts_with' && value) {
      responseAssertions.push({ type: 'starts_with', value });
      continue;
    }
    if (type === 'response_ends_with' && value) {
      responseAssertions.push({ type: 'ends_with', value });
      continue;
    }
    if (type === 'response_equals' && value) {
      responseAssertions.push({ type: 'equals', value });
      continue;
    }
    if (type === 'response_regex' && value) {
      responseAssertions.push({ type: 'regex', pattern: value });
      continue;
    }
    if (type === 'response_jsonpath' && path) {
      const assertion: { type: 'jsonpath'; path: string; equals?: string | number | boolean } = {
        type: 'jsonpath',
        path
      };
      const equals = (rule as { equals?: unknown }).equals;
      if (typeof equals === 'string' || typeof equals === 'number' || typeof equals === 'boolean') {
        assertion.equals = equals;
      }
      responseAssertions.push(assertion);
      continue;
    }
    if (type === 'response_jsonpath_exists' && path) {
      responseAssertions.push({ type: 'jsonpath_exists', path });
      continue;
    }
    if (type === 'response_jsonpath_not_exists' && path) {
      responseAssertions.push({ type: 'jsonpath_not_exists', path });
      continue;
    }
  }

  const hasToolConstraints = requiredTools.length > 0 || forbiddenTools.length > 0;
  const hasResponseAssertions = responseAssertions.length > 0;
  if (!hasToolConstraints && !hasResponseAssertions) return undefined;
  return {
    ...(hasToolConstraints
      ? {
          tool_constraints: {
            ...(requiredTools.length > 0 ? { required_tools: requiredTools } : {}),
            ...(forbiddenTools.length > 0 ? { forbidden_tools: forbiddenTools } : {})
          }
        }
      : {}),
    ...(hasResponseAssertions ? { response_assertions: responseAssertions } : {})
  };
}

function toCoreExtractRules(
  extractRules: unknown[]
): Array<{ name: string; from: 'final_text'; regex: string }> {
  const rules: Array<{ name: string; from: 'final_text'; regex: string }> = [];
  for (const raw of extractRules) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { name?: unknown; pattern?: unknown };
    const name = String(item.name ?? '').trim();
    const pattern = String(item.pattern ?? '').trim();
    if (!name || !pattern) continue;
    rules.push({ name, from: 'final_text', regex: pattern });
  }
  return rules;
}

function resolveOAuthServersForJob(job: RunJob, librariesDir: string): string[] {
  if (job.runParams.oauthServerNames !== undefined) return job.runParams.oauthServerNames;
  try {
    const loaded = loadConfig(job.runParams.configPath, { bundleRoot: librariesDir });
    const libraries = readLibrariesFromStore(librariesDir);
    applyLibraryEntries(loaded, libraries.agents, libraries.servers);
    const selected = job.runParams.scenarioIds?.length
      ? selectScenarioIds(loaded.config, job.runParams.scenarioIds)
      : job.runParams.scenarioId
      ? selectScenarioIds(loaded.config, [job.runParams.scenarioId])
      : loaded.config;
    const withOverrides = applyRuntimeServerOverrides(selected, {
      serverOverrideAll: job.runParams.serverOverrideAll,
      scenarioServerOverrides: job.runParams.scenarioServerOverrides
    });
    const effectiveServers = new Set(
      withOverrides.scenarios.flatMap((scenario) => scenario.servers)
    );
    const names = Array.from(effectiveServers).filter((name) => {
      const config = withOverrides.servers?.[name];
      return config?.auth?.type === 'oauth_authorization_code';
    });
    job.runParams.oauthServerNames = names;
    return names;
  } catch (error) {
    console.warn(
      `[mcplab] Failed to resolve OAuth servers for queued job '${job.id}': ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}

async function advanceQueue(
  jobs: Map<string, RunJob>,
  runQueueState: RunQueueState,
  settings: AppRouteRequestContext['settings'],
  oauthSessionManager: OAuthSessionManager,
  deps: RunsRouteDeps
): Promise<void> {
  if (runQueueState.activeJobId) return;
  if (runQueueState.isAdvancingQueue) return;
  runQueueState.isAdvancingQueue = true;
  try {
    while (runQueueState.queue.length > 0) {
      const nextId = runQueueState.queue[0]; // peek — do not shift yet
      const nextJob = jobs.get(nextId);
      if (!nextJob || (nextJob.status !== 'queued' && nextJob.status !== 'blocked_auth')) {
        runQueueState.queue.shift();
        continue;
      }

      // Pre-check OAuth before starting
      const oauthServers = resolveOAuthServersForJob(nextJob, settings.librariesDir);
      if (oauthServers.length > 0) {
        const authStatus = oauthSessionManager.checkServersAuthStatus(oauthServers);
        const needsAuth = authStatus.filter((s) => s.status === 'auth_required');
        if (needsAuth.length > 0) {
          const needsAuthNames = needsAuth.map((s) => s.name);
          nextJob.blockedAuthServers = needsAuthNames; // always refresh to current missing subset
          if (nextJob.status !== 'blocked_auth') {
            nextJob.status = 'blocked_auth';
          }
          deps.addJobEvent(nextJob, {
            type: 'oauth_required',
            ts: new Date().toISOString(),
            payload: {
              jobId: nextJob.id,
              servers: needsAuthNames,
              message: `OAuth login required for server(s): ${needsAuthNames.join(', ')}.`
            }
          });
          return; // pause — frontend must call /api/runs/queue/resume after auth
        }
      }

      // OAuth ready (or not required) — start the job
      runQueueState.queue.shift();
      nextJob.status = 'running';
      runQueueState.activeJobId = nextId;
      deps.addJobEvent(nextJob, {
        type: 'started',
        ts: new Date().toISOString(),
        payload: {
          configPath: nextJob.runParams.configPath,
          runsPerScenario: nextJob.runParams.runsPerScenario,
          scenarioId: nextJob.runParams.scenarioId ?? null,
          scenarioIds: nextJob.runParams.scenarioIds ?? null,
          agents: nextJob.runParams.requestedAgents ?? null,
          runNote: nextJob.runParams.runNote ?? null,
          serverOverrideAll: nextJob.runParams.serverOverrideAll ?? null,
          scenarioServerOverrides: nextJob.runParams.scenarioServerOverrides ?? null
        }
      });
      void executeRunJob(nextJob, settings, jobs, runQueueState, oauthSessionManager, deps);
      return;
    }
  } finally {
    runQueueState.isAdvancingQueue = false;
  }
}

async function executeRunJob(
  job: RunJob,
  settings: AppRouteRequestContext['settings'],
  jobs: Map<string, RunJob>,
  runQueueState: RunQueueState,
  oauthSessionManager: OAuthSessionManager,
  deps: RunsRouteDeps
) {
  const {
    addJobEvent,
    selectScenarioIds,
    expandConfigForAgents,
    resolveRunSelectedAgents,
    loadSnapshot,
    compareRunToSnapshot,
    applySnapshotPolicyToRunResult,
    readLibraries,
    pkgVersion
  } = deps;
  const {
    configPath,
    runsPerScenario,
    scenarioId,
    scenarioIds,
    requestedAgents,
    applySnapshotEval,
    runNote,
    serverOverrideAll,
    scenarioServerOverrides
  } = job.runParams;
  try {
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: { message: `Loading MCP Evaluation config: ${configPath}` }
    });
    const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
    const { agents: libraryAgents, servers: libraryServers } = readLibraries(settings.librariesDir);
    applyLibraryEntries(loaded, libraryAgents, libraryServers);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Loaded config (${loaded.config.scenarios.length} scenario(s), ${
          Object.keys(loaded.config.agents ?? {}).length
        } agent(s), ${Object.keys(loaded.config.servers ?? {}).length} server(s))`
      }
    });
    for (const warning of loaded.warnings ?? []) {
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: warning }
      });
    }
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message:
          scenarioIds && scenarioIds.length > 0
            ? `Selecting requested scenarios: ${scenarioIds.join(', ')}`
            : scenarioId
            ? `Selecting requested scenario: ${scenarioId}`
            : 'Using all scenarios from config'
      }
    });
    const selectedBaseScenarios = selectScenarioIds(
      loaded.config,
      scenarioIds && scenarioIds.length > 0 ? scenarioIds : scenarioId ? [scenarioId] : undefined
    );
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Selected ${selectedBaseScenarios.scenarios.length} base scenario(s)`
      }
    });
    const runtimeOverriddenConfig = applyRuntimeServerOverrides(selectedBaseScenarios, {
      serverOverrideAll,
      scenarioServerOverrides
    });
    const effectiveConfigHash = hashConfig(runtimeOverriddenConfig);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Applied runtime server overrides: global=${
          serverOverrideAll?.length ?? 0
        } scenario-specific=${Object.keys(scenarioServerOverrides ?? {}).length}`
      }
    });
    const effectiveScenarioServers = runtimeOverriddenConfig.scenarios
      .map((scenario) => `${scenario.id}=[${scenario.servers.join(', ')}]`)
      .join('; ');
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Effective MCP servers per scenario: ${effectiveScenarioServers || '(none)'}`
      }
    });
    const resolvedAgents = resolveRunSelectedAgents(runtimeOverriddenConfig, requestedAgents);
    const resolvedAgentList = Array.isArray(resolvedAgents) ? resolvedAgents : [];
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message:
          requestedAgents && requestedAgents.length > 0
            ? `Using requested agents: ${resolvedAgentList.join(', ')}`
            : `Using resolved default agents: ${resolvedAgentList.join(', ')}`
      }
    });
    const expandedConfig = expandConfigForAgents(runtimeOverriddenConfig, resolvedAgents);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Expanded to ${expandedConfig.scenarios.length} executable scenario run(s) across selected agents`
      }
    });
    const usedServerNames = new Set(
      expandedConfig.scenarios.flatMap((scenario) => scenario.servers)
    );
    const oauthServers = Array.from(usedServerNames).filter(
      (serverName) => expandedConfig.servers[serverName]?.auth?.type === 'oauth_authorization_code'
    );
    const mcpServerAuthHeaders =
      oauthServers.length > 0
        ? await oauthSessionManager.getAuthHeadersForServers(oauthServers)
        : undefined;
    if (oauthServers.length > 0) {
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `OAuth runtime credentials resolved for server(s): ${oauthServers.join(', ')}`
        }
      });
    }
    const cwdBefore = process.cwd();
    process.chdir(settings.workspaceRoot);
    try {
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `Running evaluation (${runsPerScenario} run(s) per scenario) ...`
        }
      });
      if (runNote) {
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: { message: `Run note: ${runNote}` }
        });
      }
      const { runDir, results } = await runAll(expandedConfig, {
        runsPerScenario,
        scenarioId,
        runNote,
        configHash: effectiveConfigHash,
        cliVersion: pkgVersion,
        runsDir: settings.runsDir,
        mcpServerAuthHeaders,
        signal: job.abortController.signal,
        onProgress: async (event: RunProgressEvent) => {
          const message = formatRunProgressMessage(event);
          if (!message) return;
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: { message }
          });
        }
      });
      const relativeConfigPathRaw = relative(settings.evalsDir, configPath);
      const relativeConfigPath = relativeConfigPathRaw.replace(/\\/g, '/').replace(/^\.\/+/, '');
      results.metadata.config_path = relativeConfigPath || configPath;
      if (loaded.config.name && loaded.config.name.trim().length > 0) {
        results.metadata.config_name = loaded.config.name.trim();
      }
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `Evaluation execution finished (run id: ${results.metadata.run_id})`
        }
      });
      if (applySnapshotEval && expandedConfig.snapshot_eval?.enabled) {
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: { message: 'Applying snapshot evaluation policy ...' }
        });
        const policy = expandedConfig.snapshot_eval;
        const enabledScenarioIds = new Set(
          selectedBaseScenarios.scenarios
            .filter((scenario: ConfigScenario) => scenario.snapshot_eval?.enabled !== false)
            .map((scenario: ConfigScenario) => scenario.id)
        );
        const scenarioBaselineMap = new Map<string, string>();
        for (const scenario of selectedBaseScenarios.scenarios) {
          if (scenario.snapshot_eval?.enabled === false) continue;
          const baselineId =
            scenario.snapshot_eval?.baseline_snapshot_id ?? policy.baseline_snapshot_id;
          if (baselineId) scenarioBaselineMap.set(scenario.id, baselineId);
        }
        const scenariosWithoutBaseline = selectedBaseScenarios.scenarios
          .filter((scenario: ConfigScenario) => scenario.snapshot_eval?.enabled !== false)
          .filter(
            (scenario: ConfigScenario) =>
              !(scenario.snapshot_eval?.baseline_snapshot_id ?? policy.baseline_snapshot_id)
          )
          .map((scenario: ConfigScenario) => scenario.id);
        if (scenariosWithoutBaseline.length > 0) {
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: `Snapshot eval enabled but no baseline configured for scenarios: ${scenariosWithoutBaseline.join(
                ', '
              )}`
            }
          });
        }
        const comparisons: ReturnType<RunsRouteDeps['compareRunToSnapshot']>[] = [];
        const scenarioIdsByBaseline = new Map<string, string[]>();
        for (const [scenarioIdItem, baselineId] of scenarioBaselineMap) {
          const list = scenarioIdsByBaseline.get(baselineId) ?? [];
          list.push(scenarioIdItem);
          scenarioIdsByBaseline.set(baselineId, list);
        }
        for (const [baselineId, scenarioIdsForBaseline] of scenarioIdsByBaseline) {
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: `Comparing ${scenarioIdsForBaseline.length} scenario(s) to snapshot baseline '${baselineId}'`
            }
          });
          const snapshot = loadSnapshot(baselineId, settings.snapshotsDir);
          const fullComparison = compareRunToSnapshot(results, snapshot);
          comparisons.push({
            ...fullComparison,
            scenario_results: fullComparison.scenario_results.filter((row) =>
              scenarioIdsForBaseline.includes(row.scenario_id)
            )
          });
        }
        if (comparisons.length > 0) {
          applySnapshotPolicyToRunResult({ results, comparisons, policy, enabledScenarioIds });
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: `Snapshot evaluation applied (${comparisons.length} baseline comparison group(s))`
            }
          });
        } else {
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: 'Snapshot evaluation enabled, but no baseline comparisons were applied'
            }
          });
        }
      } else if (applySnapshotEval) {
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: {
            message: 'Snapshot evaluation requested, but config snapshot evaluation is disabled'
          }
        });
      } else {
        addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: {
            message: 'Snapshot evaluation skipped for this run (disabled in run request)'
          }
        });
      }
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: `Writing results to ${runDir}` }
      });
      writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
      writeFileSync(join(runDir, 'report.html'), renderReport(results), 'utf8');
      writeFileSync(join(runDir, 'summary.md'), renderSummaryMarkdown(results), 'utf8');
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `Run finished: ${results.summary.total_runs} run(s), pass rate ${Math.round(
            results.summary.pass_rate * 100
          )}%`
        }
      });
      addJobEvent(job, {
        type: 'completed',
        ts: new Date().toISOString(),
        payload: {
          runId: results.metadata.run_id,
          runDir,
          summary: results.summary,
          snapshotEval: results.metadata.snapshot_eval ?? null
        }
      });
      job.status = 'completed';
    } finally {
      process.chdir(cwdBefore);
    }
  } catch (error: unknown) {
    const normalizedError =
      error instanceof OAuthAuthorizationRequiredError
        ? new Error(error.details[0]?.message || error.message)
        : error;
    const aborted = job.abortController.signal.aborted || job.status === 'stopped';
    addJobEvent(job, {
      type: 'error',
      ts: new Date().toISOString(),
      payload: {
        message: aborted
          ? 'Run aborted by user'
          : normalizedError instanceof Error
          ? normalizedError.message
          : String(normalizedError)
      }
    });
    job.status = aborted ? 'stopped' : 'error';
  } finally {
    runQueueState.activeJobId = null;
    for (const client of job.clients) client.end();
    job.clients.clear();
    advanceQueue(jobs, runQueueState, settings, oauthSessionManager, deps);
    pruneOldJobs(jobs, runQueueState);
  }
}

function pruneOldJobs(jobs: Map<string, RunJob>, runQueueState: RunQueueState) {
  const maxAgeMs = 30 * 60_000;
  const now = Date.now();
  const activeIds = new Set([runQueueState.activeJobId, ...runQueueState.queue].filter(Boolean));
  for (const [id, job] of jobs) {
    if (activeIds.has(id)) continue;
    if (job.status !== 'completed' && job.status !== 'error' && job.status !== 'stopped') continue;
    const lastEvent = job.events[job.events.length - 1];
    if (!lastEvent) continue;
    if (now - new Date(lastEvent.ts).getTime() > maxAgeMs) {
      jobs.delete(id);
    }
  }
}

function formatRunProgressMessage(event: RunProgressEvent): string | null {
  switch (event.type) {
    case 'run_started':
      return `Run initialized (id: ${event.runId}, ${event.totalScenarioRuns} scenario run(s))`;
    case 'mcp_connect_started':
      return `Connecting to ${event.serverCount} MCP server(s): ${event.serverNames.join(
        ', '
      )} ...`;
    case 'mcp_connect_finished':
      return `Connected to ${event.serverCount} MCP server(s): ${event.serverNames.join(', ')}`;
    case 'scenario_run_started':
      return `Scenario ${event.scenarioRunIndex}/${event.totalScenarioRuns} started: ${
        event.scenarioId
      } [agent=${event.agentName}, run=${event.runIndex + 1}/${event.runsPerScenario}]`;
    case 'scenario_run_finished':
      return `Scenario ${event.scenarioRunIndex}/${event.totalScenarioRuns} finished: ${
        event.scenarioId
      } [agent=${event.agentName}] -> ${event.pass ? 'PASS' : 'FAIL'} (${
        event.toolCallCount
      } tool call(s))`;
    case 'agent_progress': {
      const p = event.event;
      switch (p.type) {
        case 'llm_request_started':
          return `LLM turn ${p.turn + 1} started for ${p.scenarioId} [${p.agentName}] (${
            p.provider
          }/${p.model})`;
        case 'llm_response_received':
          return `LLM turn ${p.turn + 1} response for ${p.scenarioId} [${p.agentName}] (text=${
            p.hasText ? 'yes' : 'no'
          }, tool_calls=${p.toolCallCount})`;
        case 'tool_call_started':
          return `Tool call started: ${p.server}.${p.tool} (turn ${p.turn + 1})`;
        case 'tool_call_finished':
          return `Tool call ${p.ok ? 'finished' : 'failed'}: ${p.server}.${p.tool} in ${
            p.durationMs
          }ms`;
        case 'final_answer':
          return `Final answer produced for ${p.scenarioId} [${p.agentName}] (text=${
            p.hasText ? 'yes' : 'no'
          })`;
        default:
          return null;
      }
    }
    case 'run_finished':
      return `Run finished (id: ${event.runId})`;
    default:
      return null;
  }
}

function localMcplabMcpUrl(): string {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = process.env.MCP_PORT || '3011';
  const path = process.env.MCP_PATH || '/mcp';
  return `http://${host}:${port}${path}`;
}

function defaultResultAssistantReportPath(runId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
  return `mcplab/reports/result-assistant/${runId}-${stamp}.md`;
}
