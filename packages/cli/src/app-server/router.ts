import dotenv from 'dotenv';
dotenv.config();
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  AgentConfig,
  EvalConfig,
  ExecutableEvalConfig,
  LlmMessage,
  ResultsJson,
  ToolDef
} from '@inspectr/mcplab-core';
import {
  chatWithAgent,
  expandConfigForAgents,
  loadConfig,
  McpClientManager,
  runAll
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import type { AppServerOptions, AppSettings, DevMcpServerRuntime } from './types.js';
import type { AppRouteDeps } from './app-context.js';
import { asHtml, asJson, asText, parseBody } from './http.js';
import { addJobEvent, sendSseEvent } from './jobs.js';
import { maybeStartDevMcpServer } from './dev-mcp.js';
import {
  applySettingsOverrides,
  normalizeQueueWorkerCount,
  persistSettingsOverrides
} from './settings-store.js';
import { proxyToVite, serveStatic } from './static-serving.js';
import { readConfigRecord, readConfigRecordOrInvalid, listConfigs } from './config-store.js';
import { readLibraries, writeLibraries } from './libraries-store.js';
import {
  listRuns,
  getRunResults,
  selectScenarioIds,
  getScenarioRunTraceRecords
} from './runs-store.js';
import { decodeEvalId, ensureInsideRoot, safeFileName } from './store-utils.js';
import { handleToolAnalysisRoutes } from './tool-analysis.js';
import { handleMarkdownReportsRoutes } from './markdown-reports.js';
import { handleOAuthDebuggerRoutes } from './oauth-debugger.js';
import { handleOAuthRuntimeRoutes } from './oauth-runtime-routes.js';
import { formatCliStartupLine } from '../cli-branding.js';
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';
import { handleResultAssistantRoutes } from './result-assistant.js';
import { handleEvalsRoutes } from './evals-routes.js';
import { handleRunsRoutes } from './runs-routes.js';
import { createRunQueueService } from './run-queue-domain.js';
import { createRunQueueState, type RunJob, type RunQueueState } from './run-queue-state.js';
import { fetchProviderModels } from './provider-models.js';
import {
  cleanupAssistantSessions,
  touchAssistantSession,
  assistantSessionView,
  resolveAssistantAgentFromConfig,
  resolveAssistantAgentFromLibraries,
  pickDefaultAssistantAgentName,
  type ScenarioAssistantSession,
  preloadAssistantTools,
  continueAssistantTurn,
  executeAssistantToolCall,
  summarizeToolResultForAssistant
} from './scenario-assistant-domain.js';
import {
  preloadResultAssistantTools,
  continueResultAssistantTurn,
  executeResultAssistantToolCall,
  summarizeToolResultForResultAssistant,
  type ResultAssistantSession
} from './result-assistant-domain.js';
import {
  discoverMcpToolsForServers,
  runToolAnalysisJob,
  type ToolAnalysisJob
} from './tool-analysis-domain.js';
import {
  cleanupOAuthDebuggerSessions,
  oauthDebuggerSessionView,
  createOAuthDebuggerSession,
  startOrResumeOAuthDebuggerSession,
  submitManualCallbackToSession,
  submitBrowserCallbackToSession,
  stopOAuthDebuggerSession,
  oauthDebuggerExportMarkdown,
  oauthDebuggerExportRawTrace,
  type OAuthDebuggerSession
} from './oauth-debugger-domain.js';
import type { OAuthRuntimeSession } from './oauth-runtime-domain.js';
import { OAuthSessionManager } from './oauth-session-manager.js';
import { resolveRunSelectedAgents } from './run-agent-selection.js';
import { resolveAppDist } from './app-dist.js';
import { startBrowser } from './browser-launch.js';
import { formatLangSmithStatus, isLangSmithEnabled } from '../cli-branding.js';
import { getAppServerVersionInfo } from './version-info.js';
import { resolveEvaluationJudge } from './run-queue-executor.js';
import { LiveTestService } from './live-tests.js';
import { handleLiveTestRoutes } from './live-tests-routes.js';
import { persistAppRunArtifacts } from './app-run-artifacts.js';
import { createRoverConnectionService } from './rover-connection.js';
import type { RoverSocketMessage } from './rover-connection.js';
import { aggregateEvaluationGroupResults } from './evaluation-group-results.js';

const { cliVersion: pkgVersion, mcpServerPackageVersion: mcpServerPkgVersion } =
  getAppServerVersionInfo();

export async function startAppServer(options: AppServerOptions) {
  // Re-read .env before each connection so new/changed vars are picked up,
  // but do NOT override vars already set by the environment (CI, runtime, etc.)
  McpClientManager.onBeforeConnect = () => dotenv.config();
  const workspaceRoot = process.cwd();
  const settings: AppSettings = {
    workspaceRoot,
    evalsDir: resolve(options.evalsDir),
    runsDir: resolve(options.runsDir),
    toolAnalysisResultsDir: resolve(options.toolAnalysisResultsDir),
    librariesDir: resolve(options.librariesDir),
    defaultQueueWorkers: 1
  };
  mkdirSync(settings.evalsDir, { recursive: true });
  mkdirSync(settings.runsDir, { recursive: true });
  mkdirSync(settings.toolAnalysisResultsDir, { recursive: true });
  mkdirSync(settings.librariesDir, { recursive: true });
  mkdirSync(join(settings.librariesDir, 'test-cases'), { recursive: true });
  applySettingsOverrides(settings);

  const appDist = resolveAppDist(workspaceRoot);
  const viteDevTarget = 'http://127.0.0.1:8685';
  const devMcp = await maybeStartDevMcpServer(workspaceRoot, options.dev);
  const jobs = new Map<string, RunJob>();
  const toolAnalysisJobs = new Map<string, ToolAnalysisJob>();
  const oauthDebuggerSessions = new Map<string, OAuthDebuggerSession>();
  const oauthRuntimeSessions = new Map<string, OAuthRuntimeSession>();
  const oauthSessionManager = new OAuthSessionManager({
    librariesDir: settings.librariesDir,
    runtimeSessions: oauthRuntimeSessions,
    oauthDebuggerSessions
  });
  const assistantSessions = new Map<string, ScenarioAssistantSession>();
  const resultAssistantSessions = new Map<string, ResultAssistantSession>();
  const liveTestService = new LiveTestService({
    runsDir: settings.runsDir,
    cliVersion: pkgVersion,
    readScenarios: () => readLibraries(settings.librariesDir).scenarios,
    persist: persistAppRunArtifacts,
    getEvaluationJudge: () => {
      const libraries = readLibraries(settings.librariesDir);
      return resolveEvaluationJudge({
        agents: libraries.agents,
        evaluationJudgeAgentName: settings.evaluationJudgeAgentName
      });
    }
  });
  const runQueueState: RunQueueState = createRunQueueState(settings.defaultQueueWorkers);
  const routeDeps: AppRouteDeps = {
    parseBody,
    asHtml,
    asJson,
    asText,
    addJobEvent,
    sendSseEvent,
    readLibraries,
    discoverMcpToolsForServers,
    runToolAnalysisJob,
    cleanupOAuthDebuggerSessions,
    oauthDebuggerSessionView,
    createOAuthDebuggerSession,
    startOrResumeOAuthDebuggerSession,
    submitManualCallbackToSession,
    submitBrowserCallbackToSession,
    stopOAuthDebuggerSession,
    oauthDebuggerExportMarkdown,
    oauthDebuggerExportRawTrace,
    cleanupAssistantSessions,
    touchAssistantSession,
    assistantSessionView,
    ensureInsideRoot,
    pickDefaultAssistantAgentName,
    resolveAssistantAgentFromConfig,
    resolveAssistantAgentFromLibraries,
    preloadResultAssistantTools,
    continueResultAssistantTurn,
    executeResultAssistantToolCall,
    summarizeToolResultForResultAssistant,
    preloadAssistantTools,
    continueAssistantTurn,
    executeAssistantToolCall,
    summarizeToolResultForAssistant,
    getRunResults,
    decodeEvalId,
    readConfigRecord,
    listConfigs,
    safeFileName,
    readConfigRecordOrInvalid,
    listRuns,
    getScenarioRunTraceRecords,
    selectScenarioIds,
    expandConfigForAgents,
    resolveRunSelectedAgents,
    chatWithAgent,
    pkgVersion
  };
  const completedEvaluationGroups = new Set<string>();
  const runQueueService = createRunQueueService({
    settings,
    oauthSessionManager,
    deps: routeDeps,
    jobs: jobs as any,
    state: runQueueState,
    sendRoverMessage: (message) => roverConnection.send(message),
    assignRoverJob: (provider) => {
      const assigned = runQueueService.assignRoverJob(provider, (message: RoverSocketMessage) => roverConnection.send(message));
      if (assigned) activeRoverJobId = assigned.id;
      return assigned;
    },
    onEvaluationGroupComplete: (groupId, groupJobs) => {
      if (completedEvaluationGroups.has(groupId)) return;
      const childResults = groupJobs
        .map((job) => job.resultRunId)
        .filter((runId): runId is string => Boolean(runId))
        .map((runId) => getRunResults(runId, settings.runsDir));
      if (childResults.length !== groupJobs.length) return;
      completedEvaluationGroups.add(groupId);
      const parentRunId = `group-${Date.now()}-${groupId.slice(0, 8)}`;
      const results = aggregateEvaluationGroupResults({ groupId, runId: parentRunId, children: childResults });
      persistAppRunArtifacts({ runDir: join(settings.runsDir, parentRunId), results });
      console.log(`[mcplab-app] Evaluation group completed: ${groupId} (${parentRunId})`);
      return parentRunId;
    }
  });
  let activeRoverJobId: string | null = null;
  const roverConnection = createRoverConnectionService({
    log: (message) => console.log(message),
    onRegister: (connection) => {
      const assigned = runQueueService.assignRoverJob(connection.registration.provider, (message: RoverSocketMessage) => roverConnection.send(message));
      activeRoverJobId = assigned?.id ?? null;
      if (!assigned) console.log(`[mcplab-app] Rover connected, no queued ${connection.registration.provider} jobs`);
    },
    onMessage: (connection, message) => {
      if (message.type === 'register_update' && !activeRoverJobId) {
        const assigned = runQueueService.assignRoverJob(connection.registration.provider, (payload: RoverSocketMessage) => roverConnection.send(payload));
        activeRoverJobId = assigned?.id ?? null;
      }
      if (message.type === 'progress' && typeof message.jobId === 'string') {
        const job = jobs.get(message.jobId);
        if (job?.runParams.executionType === 'rover') {
          if (typeof message.completed === 'number' && typeof message.total === 'number') {
            job.roverProgress = {
              completed: Math.max(0, Math.min(message.completed, message.total)),
              total: Math.max(0, message.total),
              ...(typeof message.currentScenarioId === 'string' ? { currentScenarioId: message.currentScenarioId } : {}),
              ...(typeof message.lastDurationMs === 'number' ? { lastDurationMs: Math.max(0, message.lastDurationMs) } : {}),
              ...(typeof message.error === 'string' ? { error: message.error } : {})
            };
          }
          addJobEvent(job, { type: 'log', ts: new Date().toISOString(), payload: { message: String(message.message ?? 'Rover progress') } });
        }
      }
      if (message.type === 'complete' && typeof message.jobId === 'string') {
        runQueueService.completeRoverJob(message.jobId, { runId: message.runId, outcome: message.outcome, provider: connection.registration.provider });
        if (activeRoverJobId === message.jobId) activeRoverJobId = null;
        const next = runQueueService.assignRoverJob(connection.registration.provider, (payload: RoverSocketMessage) => roverConnection.send(payload));
        if (next) activeRoverJobId = next.id;
      }
    },
    onDisconnect: () => {
      if (activeRoverJobId) runQueueService.pauseRoverJob(activeRoverJobId);
      activeRoverJobId = null;
    }
  });

  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, MCP-Session-Id, Last-Event-ID, Accept'
      );
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      if (
        devMcp &&
        pathname === devMcp.path &&
        (method === 'GET' || method === 'POST' || method === 'DELETE')
      ) {
        await proxyToVite(req, res, devMcp.targetBaseUrl, pathname, url.search);
        return;
      }

      if (pathname === '/api/health' && method === 'GET') {
        asJson(res, 200, {
          ok: true,
          version: pkgVersion,
          mcp: devMcp
            ? {
                enabled: true,
                transport: 'streamable-http',
                host: devMcp.host,
                port: devMcp.port,
                path: devMcp.path,
                proxyUrl: `http://${options.host}:${options.port}${devMcp.path}`,
                directUrl: `${devMcp.targetBaseUrl}${devMcp.path}`,
                serverPackageVersion: mcpServerPkgVersion,
                environment: {
                  MCP_HOST: devMcp.host,
                  MCP_PORT: String(devMcp.port),
                  MCP_PATH: devMcp.path
                }
              }
            : { enabled: false }
        });
        return;
      }

      if (pathname === '/api/providers/models' && method === 'GET') {
        const provider = String(url.searchParams.get('provider') ?? '').trim();
        if (!provider) {
          asJson(res, 400, { error: 'provider is required (anthropic|openai|azure)' });
          return;
        }
        try {
          asJson(res, 200, await fetchProviderModels(provider));
        } catch (error: unknown) {
          asJson(res, 400, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      if (pathname === '/api/settings' && method === 'GET') {
        asJson(res, 200, settings);
        return;
      }

      if (pathname === '/api/rover/status' && method === 'GET') {
        const connection = roverConnection.connection();
        asJson(res, 200, {
          connected: Boolean(connection),
          ...(connection
          ? {
                provider: connection.registration.provider,
                pageUrl: connection.registration.pageUrl,
                connectedAt: connection.connectedAt,
                lastSeenAt: connection.lastSeenAt,
                activeJobId: activeRoverJobId
              }
            : {})
        });
        return;
      }

      if (pathname === '/api/rover/open' && method === 'POST') {
        const body = await parseBody(req);
        const jobId = String(body.jobId ?? '').trim();
        const job = runQueueService.jobs.get(jobId);
        if (!job || job.runParams.executionType !== 'rover' || !job.runParams.roverAgent) {
          asJson(res, 404, { error: 'Rover job not found.' });
          return;
        }
        startBrowser(job.runParams.roverAgent.url);
        asJson(res, 200, { ok: true, url: job.runParams.roverAgent.url });
        return;
      }

      const roverResumeMatch = pathname.match(/^\/api\/rover\/jobs\/([^/]+)\/resume$/);
      if (roverResumeMatch && method === 'POST') {
        const resumed = runQueueService.resumeRoverJob(decodeURIComponent(roverResumeMatch[1]!));
        asJson(res, resumed ? 200 : 404, { ok: resumed });
        return;
      }

      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await parseBody(req);
        if (body.evalsDir) {
          settings.evalsDir = resolve(String(body.evalsDir));
          mkdirSync(settings.evalsDir, { recursive: true });
        }
        if (body.runsDir) {
          settings.runsDir = resolve(String(body.runsDir));
          mkdirSync(settings.runsDir, { recursive: true });
        }
        if (body.librariesDir) {
          settings.librariesDir = resolve(String(body.librariesDir));
          mkdirSync(settings.librariesDir, { recursive: true });
          mkdirSync(join(settings.librariesDir, 'test-cases'), { recursive: true });
          applySettingsOverrides(settings);
          runQueueService.setWorkerCount(settings.defaultQueueWorkers, {
            hostHeader: req.headers.host
          });
          oauthSessionManager.setLibrariesDir(settings.librariesDir);
        }
        let settingsChanged = false;
        if (Object.prototype.hasOwnProperty.call(body, 'scenarioAssistantAgentName')) {
          const next = String(body.scenarioAssistantAgentName ?? '').trim();
          settings.scenarioAssistantAgentName = next || undefined;
          settingsChanged = true;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'evaluationJudgeAgentName')) {
          const next = String(body.evaluationJudgeAgentName ?? '').trim();
          if (next) {
            try {
              resolveEvaluationJudge({
                agents: readLibraries(settings.librariesDir).agents,
                evaluationJudgeAgentName: next
              });
            } catch (error: unknown) {
              asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
              return;
            }
          }
          settings.evaluationJudgeAgentName = next || undefined;
          settingsChanged = true;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'defaultQueueWorkers')) {
          settings.defaultQueueWorkers = normalizeQueueWorkerCount(body.defaultQueueWorkers);
          runQueueService.setWorkerCount(settings.defaultQueueWorkers, {
            hostHeader: req.headers.host
          });
          settingsChanged = true;
        }
        if (settingsChanged) {
          persistSettingsOverrides(settings);
        }
        asJson(res, 200, settings);
        return;
      }

      if (pathname === '/api/libraries' && method === 'GET') {
        asJson(res, 200, readLibraries(settings.librariesDir));
        return;
      }

      if (pathname === '/api/libraries' && method === 'PUT') {
        const body = await parseBody(req);
        writeLibraries(settings.librariesDir, {
          servers: (body.servers as EvalConfig['servers']) ?? {},
          agents: (body.agents as EvalConfig['agents']) ?? {},
          scenarios: (body.scenarios as EvalConfig['scenarios']) ?? []
        });
        asJson(res, 200, { ok: true });
        return;
      }

      if (
        await handleOAuthRuntimeRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          runtimeSessions: oauthRuntimeSessions,
          oauthDebuggerSessions,
          oauthSessionManager,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleOAuthDebuggerRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          oauthDebuggerSessions,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleMarkdownReportsRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleToolAnalysisRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          toolAnalysisJobs,
          oauthSessionManager,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleResultAssistantRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          resultAssistantSessions,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleScenarioAssistantRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          assistantSessions,
          oauthSessionManager,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleEvalsRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleLiveTestRoutes({
          req,
          res,
          pathname,
          method,
          service: liveTestService,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleRunsRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          runQueueService,
          oauthSessionManager,
          deps: routeDeps
        })
      ) {
        return;
      }

      if (pathname.startsWith('/api/')) {
        asJson(res, 404, { error: 'Not found' });
        return;
      }

      if (options.dev) {
        await proxyToVite(req, res, viteDevTarget, pathname, url.search);
        return;
      }

      serveStatic({
        appDist,
        pathname,
        res,
        ensureInsideRoot,
        asText
      });
    } catch (error: unknown) {
      asJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (!roverConnection.upgrade(req, socket, head)) socket.destroy();
  });

  await new Promise<void>((resolveReady) => {
    server.listen(options.port, options.host, () => resolveReady());
  });

  server.on('close', () => {
    runQueueService.closeSubscribers();
    roverConnection.close();
    devMcp?.stop();
  });

  const url = `http://${options.host}:${options.port}`;
  const logPrefix = '[mcplab-app]';
  const logPath = (label: string, value: string) => {
    // Keep startup paths visually aligned in terminal output.
    console.log(formatCliStartupLine(label, value));
  };
  // eslint-disable-next-line no-console
  console.log(`${logPrefix} App running at ${url}`);
  logPath('evals:', settings.evalsDir);
  logPath('runs:', settings.runsDir);
  logPath('analysis:', settings.toolAnalysisResultsDir);
  logPath('libs:', settings.librariesDir);
  if (isLangSmithEnabled()) {
    logPath('langsmith:', formatLangSmithStatus());
  }
  if (devMcp) {
    logPath('mcp:', `${url}${devMcp.path} -> ${devMcp.targetBaseUrl}${devMcp.path}`);
  }

  if (options.open) {
    startBrowser(url);
  }
}
