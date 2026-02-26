import 'dotenv/config';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
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
import pkg from '../../package.json' with { type: 'json' };
import type { AppServerOptions, AppSettings, DevMcpServerRuntime } from './types.js';
import type { AppRouteDeps } from './app-context.js';
import { asJson, asText, parseBody } from './http.js';
import { addJobEvent, sendSseEvent } from './jobs.js';
import { maybeStartDevMcpServer } from './dev-mcp.js';
import { applySettingsOverrides, persistSettingsOverrides } from './settings-store.js';
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
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';
import { handleResultAssistantRoutes } from './result-assistant.js';
import { handleSnapshotsRoutes } from './snapshots-routes.js';
import { handleEvalsRoutes } from './evals-routes.js';
import { handleRunsRoutes } from './runs-routes.js';
import { fetchProviderModels } from './provider-models.js';
import {
  cleanupAssistantSessions,
  touchAssistantSession,
  assistantSessionView,
  preloadAssistantTools,
  continueAssistantTurn,
  executeAssistantToolCall,
  summarizeToolResultForAssistant,
  resolveAssistantAgentFromConfig,
  resolveAssistantAgentFromLibraries,
  pickDefaultAssistantAgentName,
  type ScenarioAssistantSession
} from './scenario-assistant-domain.js';
import type { ResultAssistantSession } from './result-assistant-domain.js';
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
import {
  applySnapshotPolicyToRunResult,
  buildSnapshotFromRun,
  compareRunToSnapshot,
  listSnapshots,
  loadSnapshot,
  saveSnapshot
} from '../snapshot.js';

interface JobEvent {
  type: 'started' | 'log' | 'completed' | 'error';
  ts: string;
  payload: Record<string, unknown>;
}

interface RunJob {
  id: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  events: JobEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
}

function resolveRunSelectedAgents(
  config: EvalConfig,
  requestedAgents?: string[]
): string[] | undefined {
  if (requestedAgents && requestedAgents.length > 0) return requestedAgents;
  return config.run_defaults?.selected_agents;
}

function startBrowser(url: string) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

function defaultNewRunsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/evaluation-runs');
}

function defaultNewToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/tool-analysis');
}

function defaultLegacyToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/tool-analysis-results');
}

export async function startAppServer(options: AppServerOptions) {
  const workspaceRoot = process.cwd();
  const settings: AppSettings = {
    workspaceRoot,
    evalsDir: resolve(options.evalsDir),
    runsDir: resolve(options.runsDir),
    snapshotsDir: resolve(options.snapshotsDir),
    toolAnalysisResultsDir: resolve(options.toolAnalysisResultsDir),
    librariesDir: resolve(options.librariesDir)
  };
  mkdirSync(settings.evalsDir, { recursive: true });
  mkdirSync(settings.runsDir, { recursive: true });
  mkdirSync(settings.snapshotsDir, { recursive: true });
  mkdirSync(settings.toolAnalysisResultsDir, { recursive: true });
  mkdirSync(settings.librariesDir, { recursive: true });
  mkdirSync(join(settings.librariesDir, 'scenarios'), { recursive: true });
  applySettingsOverrides(settings);

  const appDist = resolve(workspaceRoot, 'packages', 'app', 'dist');
  const viteDevTarget = 'http://127.0.0.1:8685';
  const devMcp = await maybeStartDevMcpServer(workspaceRoot, options.dev);
  const jobs = new Map<string, RunJob>();
  const toolAnalysisJobs = new Map<string, ToolAnalysisJob>();
  const oauthDebuggerSessions = new Map<string, OAuthDebuggerSession>();
  const assistantSessions = new Map<string, ScenarioAssistantSession>();
  const resultAssistantSessions = new Map<string, ResultAssistantSession>();
  let activeJobId: string | null = null;
  const routeDeps: AppRouteDeps = {
    parseBody,
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
    preloadAssistantTools,
    continueAssistantTurn,
    executeAssistantToolCall,
    summarizeToolResultForAssistant,
    listSnapshots,
    buildSnapshotFromRun,
    saveSnapshot,
    loadSnapshot,
    compareRunToSnapshot,
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
    applySnapshotPolicyToRunResult,
    chatWithAgent,
    pkgVersion: pkg.version
  };

  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
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
          version: pkg.version,
          mcp: devMcp
            ? {
                enabled: true,
                transport: 'streamable-http',
                endpoint: `http://${options.host}:${options.port}${devMcp.path}`,
                upstream: `${devMcp.targetBaseUrl}${devMcp.path}`
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
        if (body.snapshotsDir) {
          settings.snapshotsDir = resolve(String(body.snapshotsDir));
          mkdirSync(settings.snapshotsDir, { recursive: true });
        }
        if (body.librariesDir) {
          settings.librariesDir = resolve(String(body.librariesDir));
          mkdirSync(settings.librariesDir, { recursive: true });
          mkdirSync(join(settings.librariesDir, 'scenarios'), { recursive: true });
          applySettingsOverrides(settings);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'scenarioAssistantAgentName')) {
          const next = String(body.scenarioAssistantAgentName ?? '').trim();
          settings.scenarioAssistantAgentName = next || undefined;
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
          deps: routeDeps
        })
      ) {
        return;
      }

      if (
        await handleSnapshotsRoutes({
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
          jobs,
          activeJobState: {
            get: () => activeJobId,
            set: (value) => {
              activeJobId = value;
            }
          },
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
    devMcp?.stop();
  });

  const url = `http://${options.host}:${options.port}`;
  // eslint-disable-next-line no-console
  console.log(`mcplab app running at ${url}`);
  // eslint-disable-next-line no-console
  console.log(`  evals:   ${settings.evalsDir}`);
  // eslint-disable-next-line no-console
  console.log(`  runs:    ${settings.runsDir}`);
  // eslint-disable-next-line no-console
  console.log(`  tool analysis results: ${settings.toolAnalysisResultsDir}`);
  // eslint-disable-next-line no-console
  console.log(`  libs:    ${settings.librariesDir}`);
  const legacyToolAnalysis = defaultLegacyToolAnalysisResultsDir(settings.workspaceRoot);
  if (
    settings.toolAnalysisResultsDir === defaultNewToolAnalysisResultsDir(settings.workspaceRoot) &&
    existsSync(legacyToolAnalysis)
  ) {
    // eslint-disable-next-line no-console
    console.log(`  legacy tool analysis fallback: ${legacyToolAnalysis}`);
  }
  if (devMcp) {
    // eslint-disable-next-line no-console
    console.log(`  mcp:     ${url}${devMcp.path} -> ${devMcp.targetBaseUrl}${devMcp.path}`);
  }

  if (options.open) {
    startBrowser(url);
  }
}
