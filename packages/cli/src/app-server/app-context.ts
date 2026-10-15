import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppSettings } from './types.js';
import type { parseBody, asHtml, asJson, asText } from './http.js';
import type { addJobEvent, sendSseEvent } from './jobs.js';
import type { readLibraries } from './libraries-store.js';
import type { RunQueueState } from './run-queue-state.js';
import type {
  discoverMcpToolsForServers,
  runToolAnalysisJob,
  ToolAnalysisJob
} from './tool-analysis-domain.js';
import type {
  cleanupOAuthDebuggerSessions,
  oauthDebuggerSessionView,
  createOAuthDebuggerSession,
  startOrResumeOAuthDebuggerSession,
  submitManualCallbackToSession,
  submitBrowserCallbackToSession,
  stopOAuthDebuggerSession,
  oauthDebuggerExportMarkdown,
  oauthDebuggerExportRawTrace,
  OAuthDebuggerSession
} from './oauth-debugger-domain.js';
import type { OAuthRuntimeSession } from './oauth-runtime-domain.js';
import type {
  cleanupScenarioAssistantSessions,
  touchScenarioAssistantSession,
  scenarioAssistantSessionView,
  pickDefaultAssistantAgentName,
  resolveAssistantAgentFromConfig,
  resolveAssistantAgentFromLibraries,
  ScenarioAssistantSession
} from './scenario-assistant-domain.js';
import type {
  getRunResults,
  listRuns,
  getScenarioRunTraceRecords,
  selectScenarioIds
} from './runs-store.js';
import type { decodeEvalId, ensureInsideRoot, safeFileName } from './store-utils.js';
import type { readConfigRecord, readConfigRecordOrInvalid, listConfigs } from './config-store.js';
import type { RunSummary } from './runs-store.js';
import type { ConfigRecord } from './config-store.js';
import type {
  ResultsJson,
  EvalConfig,
  ExecutableEvalConfig,
  AssistantRuntimeFactory,
  chatWithAgent
} from '@inspectr/mcplab-core';

export interface AppRouteRequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppSettings;
}

export interface ActiveJobState {
  get(): string | null;
  set(value: string | null): void;
}

export interface HttpDeps {
  parseBody: typeof parseBody;
  asHtml: typeof asHtml;
  asJson: typeof asJson;
  asText: typeof asText;
}

export interface JobStreamDeps {
  addJobEvent: typeof addJobEvent;
  sendSseEvent: typeof sendSseEvent;
}

export interface LibraryDeps {
  readLibraries: typeof readLibraries;
}

export interface ToolAnalysisDeps extends LibraryDeps {
  discoverMcpToolsForServers: typeof discoverMcpToolsForServers;
  runToolAnalysisJob: typeof runToolAnalysisJob;
}

export interface ResultAssistantDeps extends LibraryDeps {
  assistantRuntimeFactory: AssistantRuntimeFactory;
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
  preloadResultAssistantTools: typeof import('./result-assistant-domain.js').preloadResultAssistantTools;
}

export interface ScenarioAssistantDeps extends LibraryDeps {
  assistantRuntimeFactory: AssistantRuntimeFactory;
  cleanupScenarioAssistantSessions: typeof cleanupScenarioAssistantSessions;
  touchScenarioAssistantSession: typeof touchScenarioAssistantSession;
  scenarioAssistantSessionView: typeof scenarioAssistantSessionView;
  ensureInsideRoot: typeof ensureInsideRoot;
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromConfig: typeof resolveAssistantAgentFromConfig;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
  preloadScenarioAssistantTools: typeof import('./scenario-assistant-domain.js').preloadScenarioAssistantTools;
}

export interface OAuthDebuggerDeps extends LibraryDeps {
  cleanupOAuthDebuggerSessions: typeof cleanupOAuthDebuggerSessions;
  oauthDebuggerSessionView: typeof oauthDebuggerSessionView;
  createOAuthDebuggerSession: typeof createOAuthDebuggerSession;
  startOrResumeOAuthDebuggerSession: typeof startOrResumeOAuthDebuggerSession;
  submitManualCallbackToSession: typeof submitManualCallbackToSession;
  submitBrowserCallbackToSession: typeof submitBrowserCallbackToSession;
  stopOAuthDebuggerSession: typeof stopOAuthDebuggerSession;
  oauthDebuggerExportMarkdown: typeof oauthDebuggerExportMarkdown;
  oauthDebuggerExportRawTrace: typeof oauthDebuggerExportRawTrace;
}

export interface ConfigDeps {
  listConfigs: typeof listConfigs;
  safeFileName: typeof safeFileName;
  ensureInsideRoot: typeof ensureInsideRoot;
  decodeEvalId: typeof decodeEvalId;
  readConfigRecord: typeof readConfigRecord;
  readConfigRecordOrInvalid: typeof readConfigRecordOrInvalid;
}

export interface RunDeps {
  ensureInsideRoot: typeof ensureInsideRoot;
  listRuns: typeof listRuns;
  getRunResults: typeof getRunResults;
  getScenarioRunTraceRecords: typeof getScenarioRunTraceRecords;
  selectScenarioIds: typeof selectScenarioIds;
  expandConfigForAgents: (config: EvalConfig, requestedAgents?: string[]) => ExecutableEvalConfig;
  resolveRunSelectedAgents: (config: EvalConfig, requestedAgents?: string[]) => string[];
  readLibraries: typeof readLibraries;
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
  chatWithAgent: typeof chatWithAgent;
  pkgVersion: string;
}

export interface AppRouteDeps
  extends
    HttpDeps,
    JobStreamDeps,
    ToolAnalysisDeps,
    OAuthDebuggerDeps,
    ResultAssistantDeps,
    ScenarioAssistantDeps,
    ConfigDeps,
    RunDeps {}

export type ToolAnalysisJobsMap = Map<string, ToolAnalysisJob>;
export type OAuthDebuggerSessionsMap = Map<string, OAuthDebuggerSession>;
export type OAuthRuntimeSessionsMap = Map<string, OAuthRuntimeSession>;
export type ScenarioAssistantSessionsMap = Map<string, ScenarioAssistantSession>;
export type RunsResults = ResultsJson;
export type RunsList = RunSummary[];
export type ConfigRecords = ConfigRecord[];
