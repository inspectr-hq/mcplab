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
  createTestCaseFile,
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
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';
import { handleResultAssistantRoutes } from './result-assistant.js';
import { handleEvalsRoutes } from './evals-routes.js';
import { handleRunsRoutes } from './runs-routes.js';
import {
  handleGlobalCopilotRun,
  handleGlobalCopilotEvaluationConfigCreateConfirmation,
  handleGlobalCopilotMarkdownReportWriteConfirmation,
  handleGlobalCopilotRunEvaluationConfirmation,
  handleGlobalCopilotToolConfirmation
} from './global-copilot-domain.js';
import { handleGlobalCopilotKit } from './global-copilot-mastra.js';
import { handleGlobalCopilotThreadRoutes } from './global-copilot-threads.js';
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
import { getAppServerVersionInfo } from './version-info.js';
import { resolveEvaluationJudge } from './run-queue-executor.js';

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
  const devMcp = await maybeStartDevMcpServer(workspaceRoot, options.dev, settings.librariesDir);
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
  const runQueueService = createRunQueueService({
    settings,
    oauthSessionManager,
    deps: routeDeps,
    jobs: jobs as any,
    state: runQueueState
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
        if (Object.prototype.hasOwnProperty.call(body, 'globalCopilotAgentName')) {
          const next = String(body.globalCopilotAgentName ?? '').trim();
          settings.globalCopilotAgentName = next || undefined;
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

      if (pathname === '/api/copilotkit') {
        await handleGlobalCopilotKit({ req, res, settings, asJson });
        return;
      }
      if (
        await handleGlobalCopilotThreadRoutes({
          req,
          res,
          pathname,
          method,
          settings,
          parseBody,
          asJson
        })
      ) {
        return;
      }
      if (pathname === '/api/global-copilot/run' && method === 'POST') {
        await handleGlobalCopilotRun({ req, res, settings, parseBody, asJson });
        return;
      }
      if (pathname === '/api/global-copilot/confirm-tool' && method === 'POST') {
        await handleGlobalCopilotToolConfirmation({ req, res, settings, parseBody, asJson });
        return;
      }
      if (pathname === '/api/global-copilot/confirm-run-eval' && method === 'POST') {
        await handleGlobalCopilotRunEvaluationConfirmation({ req, res, parseBody, asJson });
        return;
      }
      if (pathname === '/api/global-copilot/confirm-report-write' && method === 'POST') {
        await handleGlobalCopilotMarkdownReportWriteConfirmation({ req, res, parseBody, asJson });
        return;
      }
      if (pathname === '/api/global-copilot/confirm-evaluation-config-create' && method === 'POST') {
        await handleGlobalCopilotEvaluationConfigCreateConfirmation({ req, res, parseBody, asJson });
        return;
      }

      if (pathname === '/api/libraries' && method === 'GET') {
        asJson(res, 200, readLibraries(settings.librariesDir));
        return;
      }

      if (pathname === '/api/libraries/test-cases' && method === 'POST') {
        const body = await parseBody(req);
        const libraries = readLibraries(settings.librariesDir);
        try {
          const created = createTestCaseFile({
            librariesDir: settings.librariesDir,
            knownServerIds: Object.keys(libraries.servers),
            testCase: {
              id: typeof body.id === 'string' ? body.id : '',
              name: typeof body.name === 'string' ? body.name : undefined,
              servers: Array.isArray(body.servers)
                ? body.servers.filter((server: unknown): server is string => typeof server === 'string')
                : [],
              prompt: typeof body.prompt === 'string' ? body.prompt : '',
              requiredTools: Array.isArray(body.required_tools)
                ? body.required_tools.filter((tool: unknown): tool is string => typeof tool === 'string')
                : undefined,
              responseRegexPatterns: Array.isArray(body.response_regex_patterns)
                ? body.response_regex_patterns.filter((pattern: unknown): pattern is string => typeof pattern === 'string')
                : undefined
            }
          });
          asJson(res, 201, {
            id: created.id,
            path: created.path,
            test_case: created.testCase
          });
        } catch (error) {
          asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
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

  await new Promise<void>((resolveReady) => {
    server.listen(options.port, options.host, () => resolveReady());
  });

  server.on('close', () => {
    runQueueService.closeSubscribers();
    devMcp?.stop();
  });

  const url = `http://${options.host}:${options.port}`;
  const logPrefix = '[mcplab-app]';
  const logPath = (label: string, value: string) => {
    // Keep startup paths visually aligned in terminal output.
    console.log(`${logPrefix}  ${label.padEnd(8)}\t${value}`);
  };
  // eslint-disable-next-line no-console
  console.log(`${logPrefix} App running at ${url}`);
  logPath('evals:', settings.evalsDir);
  logPath('runs:', settings.runsDir);
  logPath('analysis:', settings.toolAnalysisResultsDir);
  logPath('libs:', settings.librariesDir);
  if (devMcp) {
    logPath('mcp:', `${url}${devMcp.path} -> ${devMcp.targetBaseUrl}${devMcp.path}`);
  }

  if (options.open) {
    startBrowser(url);
  }
}
