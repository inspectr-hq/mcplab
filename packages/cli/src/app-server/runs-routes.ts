import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join } from 'node:path';
import {
  McpClientManager,
  loadConfig,
  runAll,
  renderSummaryMarkdown,
  type EvalConfig,
  type LlmMessage,
  type RunProgressEvent
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import type { SseEvent } from './jobs.js';
import type { RunQueueState, AppRouteDeps, AppRouteRequestContext } from './app-context.js';

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
  | 'resolveAssistantAgentFromLibraries'
  | 'chatWithAgent'
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
};

type RunJob = {
  id: string;
  status: 'queued' | 'running' | 'stopped' | 'completed' | 'error';
  events: SseEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
  runParams: RunParams;
};

type RunRequestBody = {
  configPath?: unknown;
  runsPerScenario?: unknown;
  scenarioId?: unknown;
  scenarioIds?: unknown;
  agents?: unknown;
  applySnapshotEval?: unknown;
  runNote?: unknown;
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
  deps: RunsRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, jobs, runQueueState, deps } = params;
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
    resolveAssistantAgentFromLibraries,
    chatWithAgent,
    pkgVersion
  } = deps;

  if (pathname === '/api/runs' && method === 'GET') {
    asJson(res, 200, listRuns(settings.runsDir));
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
    if (job.status !== 'running' && job.status !== 'queued') {
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
      .filter((j): j is RunJob => !!j && j.status === 'queued')
      .map((j) => ({
        jobId: j.id,
        status: j.status,
        runParams: {
          configPath: j.runParams.configPath,
          runsPerScenario: j.runParams.runsPerScenario,
          scenarioIds: j.runParams.scenarioIds ?? null,
          agents: j.runParams.requestedAgents ?? null,
          runNote: j.runParams.runNote ?? null
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
              runNote: activeJob.runParams.runNote ?? null
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
    if (job.status !== 'queued') {
      asJson(res, 404, { error: 'Job is not queued' });
      return true;
    }
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
    asJson(res, 200, { ok: true, jobId, status: 'stopped' });
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

    const jobId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const runParamsObj: RunParams = {
      configPath,
      runsPerScenario,
      scenarioId,
      scenarioIds,
      requestedAgents,
      applySnapshotEval,
      runNote
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

    if (!runQueueState.activeJobId) {
      // No active job — start immediately
      job.status = 'running';
      runQueueState.activeJobId = jobId;
      addJobEvent(job, {
        type: 'started',
        ts: new Date().toISOString(),
        payload: {
          configPath,
          runsPerScenario,
          scenarioId: scenarioId ?? null,
          scenarioIds: scenarioIds ?? null,
          agents: requestedAgents ?? null,
          runNote: runNote ?? null
        }
      });
      void executeRunJob(job, settings, jobs, runQueueState, deps);
      asJson(res, 202, { jobId });
    } else {
      // Queue this job
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
          position: runQueueState.queue.length
        }
      });
      asJson(res, 202, { jobId, queued: true, position: runQueueState.queue.length });
    }
    return true;
  }

  if (pathname.startsWith('/api/runs/') && pathname.endsWith('/assistant') && method === 'POST') {
    const runId = pathname.split('/')[3];
    const results = getRunResults(runId, settings.runsDir);
    const body = (await parseBody(req)) as {
      messages?: unknown;
    };
    const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
    const messages: LlmMessage[] = messagesRaw
      .filter((m): m is { role?: unknown; text?: unknown } => !!m && typeof m === 'object')
      .map(
        (m): LlmMessage => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: String(m.text ?? '')
        })
      )
      .filter((m) => m.content.trim().length > 0);
    if (messages.length === 0) {
      asJson(res, 400, { error: 'messages are required' });
      return true;
    }

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

    const scenarioSummaries = results.scenarios.slice(0, 30).map((sc) => ({
      scenario_id: sc.scenario_id,
      agent: sc.agent,
      pass_rate: sc.pass_rate,
      runs: sc.runs.map((r) => ({
        run_index: r.run_index,
        pass: r.pass,
        failures: r.failures,
        tool_calls: r.tool_calls,
        final_text_preview:
          typeof r.final_text === 'string' && r.final_text.length > 600
            ? `${r.final_text.slice(0, 600)}…`
            : r.final_text,
        extracted: r.extracted
      }))
    }));

    const system = [
      'You are the MCP Labs Result Assistant.',
      'Help the user understand MCP evaluation run results, failures, tool behavior, and snapshot drift.',
      'Be concise, practical, and explain what happened and what to check next.',
      'If the user asks for fixes, suggest concrete config/scenario/eval adjustments.',
      'Use markdown for readability when helpful.',
      `Run result context: ${JSON.stringify({
        run_id: results.metadata.run_id,
        timestamp: results.metadata.timestamp,
        run_note: results.metadata.run_note ?? null,
        config_hash: results.metadata.config_hash,
        summary: results.summary,
        snapshot_eval: results.metadata.snapshot_eval ?? null,
        scenarios: scenarioSummaries
      })}`
    ].join('\n');

    try {
      const reply = await chatWithAgent({
        agent: agentConfig,
        messages,
        system
      });
      asJson(res, 200, {
        reply: reply.content ?? '',
        assistantAgentName,
        provider: agentConfig.provider,
        model: agentConfig.model
      });
    } catch (error: unknown) {
      asJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
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

function advanceQueue(
  jobs: Map<string, RunJob>,
  runQueueState: RunQueueState,
  settings: AppRouteRequestContext['settings'],
  deps: RunsRouteDeps
) {
  if (runQueueState.activeJobId) return;
  while (runQueueState.queue.length > 0) {
    const nextId = runQueueState.queue.shift()!;
    const nextJob = jobs.get(nextId);
    if (!nextJob || nextJob.status !== 'queued') continue;
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
        runNote: nextJob.runParams.runNote ?? null
      }
    });
    void executeRunJob(nextJob, settings, jobs, runQueueState, deps);
    return;
  }
}

async function executeRunJob(
  job: RunJob,
  settings: AppRouteRequestContext['settings'],
  jobs: Map<string, RunJob>,
  runQueueState: RunQueueState,
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
    pkgVersion
  } = deps;
  const {
    configPath,
    runsPerScenario,
    scenarioId,
    scenarioIds,
    requestedAgents,
    applySnapshotEval,
    runNote
  } = job.runParams;
  try {
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: { message: `Loading MCP Evaluation config: ${configPath}` }
    });
    const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
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
    const resolvedAgents = resolveRunSelectedAgents(selectedBaseScenarios, requestedAgents);
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
    const expandedConfig = expandConfigForAgents(selectedBaseScenarios, resolvedAgents);
    addJobEvent(job, {
      type: 'log',
      ts: new Date().toISOString(),
      payload: {
        message: `Expanded to ${expandedConfig.scenarios.length} executable scenario run(s) across selected agents`
      }
    });
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
        configHash: loaded.hash,
        cliVersion: pkgVersion,
        runsDir: settings.runsDir,
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
    const aborted = job.abortController.signal.aborted || job.status === 'stopped';
    addJobEvent(job, {
      type: 'error',
      ts: new Date().toISOString(),
      payload: {
        message: aborted
          ? 'Run aborted by user'
          : error instanceof Error
          ? error.message
          : String(error)
      }
    });
    job.status = aborted ? 'stopped' : 'error';
  } finally {
    runQueueState.activeJobId = null;
    for (const client of job.clients) client.end();
    job.clients.clear();
    advanceQueue(jobs, runQueueState, settings, deps);
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
      return `Connecting to ${event.serverCount} MCP server(s) ...`;
    case 'mcp_connect_finished':
      return `Connected to ${event.serverCount} MCP server(s)`;
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
