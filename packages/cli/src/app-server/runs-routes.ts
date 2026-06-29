import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  McpClientManager,
  loadConfig,
  hashConfig,
  runAll,
  renderSummaryMarkdown,
  applyRuntimeServerOverrides,
  type EvalConfig,
  type ScenarioAttachment,
  type ScenarioRunTraceRecord
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import {
  OAuthAuthorizationRequiredError,
  type OAuthSessionManager
} from './oauth-session-manager.js';
import {
  applyLibraryEntries,
  filterScenarioOverridesToSelectedScenarios,
  mergeLibraryEntriesIntoConfig,
  resolveEvaluationJudge
} from './run-queue-executor.js';
import type { RunQueueService } from './run-queue-domain.js';

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
  | 'readLibraries'
  | 'pickDefaultAssistantAgentName'
  | 'pkgVersion'
>;

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
    attachments?: unknown;
    evalRules?: unknown;
    extractRules?: unknown;
  };
};

type LatestPassRatesRequestBody = {
  lastDays?: unknown;
  configs?: Array<{
    id?: unknown;
    sourcePath?: unknown;
    relativePath?: unknown;
    configHash?: unknown;
  }>;
};

type ConfigScenario = EvalConfig['scenarios'][number];

function validatePreviewAttachmentContract(attachment: ScenarioAttachment): void {
  const mediaType = String(attachment.media_type ?? '');
  const isImage = mediaType.startsWith('image/');
  const urlOnly = !!attachment.url && !attachment.data;
  if (urlOnly && !isImage && mediaType !== 'application/pdf') {
    throw new Error(
      'Preview attachment must be image/* or application/pdf when only url is provided'
    );
  }
}

export async function handleRunsRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  runQueueService: RunQueueService;
  oauthSessionManager: OAuthSessionManager;
  deps: RunsRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, runQueueService, oauthSessionManager, deps } =
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
    readLibraries,
    pickDefaultAssistantAgentName,
    pkgVersion
  } = deps;

  if (pathname === '/api/runs' && method === 'GET') {
    const requestUrl = new URL(req.url ?? '/api/runs', 'http://localhost');
    const since = requestUrl.searchParams.get('since') ?? undefined;
    const until = requestUrl.searchParams.get('until') ?? undefined;
    const scenario = requestUrl.searchParams.get('scenario') ?? undefined;
    const lastDaysRaw = requestUrl.searchParams.get('last_days');
    const lastDaysParsed = lastDaysRaw === null ? NaN : Number(lastDaysRaw);
    const lastDays =
      Number.isFinite(lastDaysParsed) && lastDaysParsed > 0
        ? Math.floor(lastDaysParsed)
        : undefined;
    const limitRaw = Number(requestUrl.searchParams.get('limit'));
    const offsetRaw = Number(requestUrl.searchParams.get('offset'));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const all = listRuns(settings.runsDir, {
      since,
      until,
      lastDays,
      scenario
    });
    const data = all.slice(offset, offset + limit);
    const totalCount = all.length;
    const hasMore = offset + data.length < totalCount;
    const nextOffset = hasMore ? offset + data.length : null;
    const prevOffset = offset > 0 ? Math.max(0, offset - limit) : null;
    asJson(res, 200, {
      object: 'list',
      url: `${pathname}${requestUrl.search}`,
      data,
      has_more: hasMore,
      total_count: totalCount,
      next_offset: nextOffset,
      prev_offset: prevOffset
    });
    return true;
  }

  if (pathname === '/api/runs/latest-pass-rates' && method === 'POST') {
    const body = (await parseBody(req)) as LatestPassRatesRequestBody;
    const requestedConfigs = Array.isArray(body.configs) ? body.configs : [];
    const normalizedConfigs = requestedConfigs
      .map((entry) => ({
        id: String(entry?.id ?? '').trim(),
        sourcePath: String(entry?.sourcePath ?? '').trim(),
        relativePath: String(entry?.relativePath ?? '').trim(),
        configHash: String(entry?.configHash ?? '').trim()
      }))
      .filter((entry) => entry.id);
    const lastDaysRaw = Number(body.lastDays);
    const lastDays =
      Number.isFinite(lastDaysRaw) && lastDaysRaw > 0 ? Math.floor(lastDaysRaw) : undefined;
    const summaries = listRuns(settings.runsDir, { lastDays });
    const pending = new Set(normalizedConfigs.map((entry) => entry.id));
    const byConfigId: Record<string, number> = {};
    for (const summary of summaries) {
      if (pending.size === 0) break;
      const summaryPath = String(summary.configPath ?? '').trim();
      const summaryHash = String(summary.configHash ?? '').trim();
      for (const cfg of normalizedConfigs) {
        if (!pending.has(cfg.id)) continue;
        if (
          (cfg.sourcePath && cfg.sourcePath === summaryPath) ||
          (cfg.relativePath && cfg.relativePath === summaryPath) ||
          (cfg.configHash && cfg.configHash === summaryHash)
        ) {
          byConfigId[cfg.id] = summary.passRate;
          pending.delete(cfg.id);
        }
      }
    }
    asJson(res, 200, { byConfigId });
    return true;
  }

  if (pathname.startsWith('/api/runs/') && pathname.endsWith('/trace') && method === 'GET') {
    const runId = pathname.split('/')[3];
    asJson(res, 200, { runId, records: getScenarioRunTraceRecords(runId, settings.runsDir) });
    return true;
  }

  if (pathname.startsWith('/api/runs/jobs/') && pathname.endsWith('/events') && method === 'GET') {
    const jobId = pathname.split('/')[4];
    const job = runQueueService.jobs.get(jobId);
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
    const result = runQueueService.stopJob(jobId, { hostHeader: req.headers.host });
    if (!result) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    asJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/runs/queue' && method === 'GET') {
    asJson(res, 200, runQueueService.getQueueState());
    return true;
  }

  if (pathname === '/api/runs/queue/events' && method === 'GET') {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    runQueueService.subscribeQueue(req, res);
    return true;
  }

  if (
    pathname.startsWith('/api/runs/queue/') &&
    method === 'DELETE' &&
    pathname.split('/').length === 5
  ) {
    const jobId = pathname.split('/')[4];
    const result = runQueueService.removeQueuedJob(jobId, { hostHeader: req.headers.host });
    if (!result) {
      asJson(res, 404, { error: 'Job not found' });
      return true;
    }
    if ('error' in result) {
      asJson(res, result.statusCode, { error: result.error });
      return true;
    }
    asJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/runs/queue/resume' && method === 'POST') {
    runQueueService.resumeBlockedJobs({ hostHeader: req.headers.host });
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
    try {
      const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
      const libraries = readLibraries(settings.librariesDir);
      applyLibraryEntries(loaded, libraries.agents, libraries.servers);
      const selected = scenarioIds?.length
        ? deps.selectScenarioIds(loaded.config, scenarioIds)
        : scenarioId
        ? deps.selectScenarioIds(loaded.config, [scenarioId])
        : loaded.config;
      const filteredScenarioOverrides = filterScenarioOverridesToSelectedScenarios(
        selected,
        scenarioServerOverrides
      );
      applyRuntimeServerOverrides(selected, {
        serverOverrideAll,
        scenarioServerOverrides: filteredScenarioOverrides
      });
    } catch (error) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }

    // Resolve lazily in advanceQueue so runtime overrides are always reflected.
    const oauthServerNames: string[] | undefined = undefined;

    const runParamsObj = {
      configPath,
      runsPerScenario,
      scenarioId,
      scenarioIds,
      requestedAgents,
      runNote,
      oauthServerNames,
      serverOverrideAll,
      scenarioServerOverrides
    };
    const response = runQueueService.enqueueRun(runParamsObj, { hostHeader: req.headers.host });
    asJson(res, 202, response);
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
    const attachments = Array.isArray(scenarioBody?.attachments)
      ? (scenarioBody.attachments as ScenarioAttachment[])
      : [];
    try {
      for (const attachment of attachments) {
        validatePreviewAttachmentContract(attachment);
      }
    } catch (error: unknown) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
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
    let evaluationJudge;
    try {
      evaluationJudge = resolveEvaluationJudge({
        agents: libraries.agents,
        evaluationJudgeAgentName: settings.evaluationJudgeAgentName
      });
    } catch (error: unknown) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
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

    const previewWarnings: string[] = [];
    const coreEval = toCoreEvalRules(evalRules, previewWarnings);
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
          ...(attachments.length > 0 ? { attachments } : {}),
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
        cwd: settings.workspaceRoot,
        mcpServerAuthHeaders,
        evaluationJudge
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
        ...(previewWarnings.length > 0 ? { warnings: previewWarnings } : {}),
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
  evalRules: unknown[],
  warnings: string[] = []
): EvalConfig['scenarios'][number]['eval'] | undefined {
  const requiredTools: string[] = [];
  const forbiddenTools: string[] = [];
  let toolSequence: string[] | undefined;
  let validToolSequenceCount = 0;
  const agentAssertions: Array<{ label: string; prompt: string }> = [];
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
    const rule = raw as {
      type?: unknown;
      value?: unknown;
      path?: unknown;
      equals?: unknown;
      label?: unknown;
      prompt?: unknown;
      sequence?: unknown;
    };
    const type = String(rule.type ?? '').trim();
    const value = String(rule.value ?? '').trim();
    const path = String(rule.path ?? '').trim();
    const label = String(rule.label ?? '').trim();
    const prompt = String(rule.prompt ?? '').trim();
    if (!type) continue;
    if (type === 'required_tool' && value) {
      requiredTools.push(value);
      continue;
    }
    if (type === 'forbidden_tool' && value) {
      forbiddenTools.push(value);
      continue;
    }
    if (type === 'tool_sequence') {
      const sequence = parseToolSequenceRule(rule);
      if (sequence.length > 0) {
        validToolSequenceCount += 1;
        toolSequence = sequence;
      }
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
    if (type === 'agent_check' && label && prompt) {
      agentAssertions.push({ label, prompt });
      continue;
    }
  }

  const hasToolConstraints = requiredTools.length > 0 || forbiddenTools.length > 0;
  const hasToolSequence = Boolean(toolSequence?.length);
  if (validToolSequenceCount > 1) {
    warnings.push(
      'Multiple tool_sequence checks were provided; only the last valid sequence was used.'
    );
  }
  const hasResponseAssertions = responseAssertions.length > 0;
  const hasAgentAssertions = agentAssertions.length > 0;
  if (!hasToolConstraints && !hasToolSequence && !hasResponseAssertions && !hasAgentAssertions)
    return undefined;
  return {
    ...(hasToolConstraints
      ? {
          tool_constraints: {
            ...(requiredTools.length > 0 ? { required_tools: requiredTools } : {}),
            ...(forbiddenTools.length > 0 ? { forbidden_tools: forbiddenTools } : {})
          }
        }
      : {}),
    ...(hasToolSequence ? { tool_sequence: toolSequence } : {}),
    ...(hasResponseAssertions ? { response_assertions: responseAssertions } : {}),
    ...(hasAgentAssertions ? { agent_assertions: agentAssertions } : {})
  };
}

function parseToolSequenceRule(rule: { value?: unknown; sequence?: unknown }): string[] {
  if (Array.isArray(rule.sequence)) {
    return rule.sequence.map((toolName) => String(toolName ?? '').trim()).filter(Boolean);
  }
  const value = String(rule.value ?? '').trim();
  if (!value || value.toLowerCase() === 'tool sequence') return [];
  return value
    .split(/\s*(?:->|,|\n)\s*/)
    .map((toolName) => toolName.trim())
    .filter(Boolean);
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
