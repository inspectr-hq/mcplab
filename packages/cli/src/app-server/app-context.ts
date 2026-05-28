import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppSettings } from './types.js';
import type { parseBody, asHtml, asJson, asText } from './http.js';
import type { addJobEvent, sendSseEvent } from './jobs.js';
import type { readLibraries } from './libraries-store.js';
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
  cleanupAssistantSessions,
  touchAssistantSession,
  assistantSessionView,
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

export interface RunQueueState {
  activeJobId: string | null;
  queue: string[]; // ordered jobIds waiting to run
  isAdvancingQueue: boolean; // re-entrancy lock for async advanceQueue()
  clients: Set<ServerResponse>; // subscribers of /api/runs/queue/events
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

export interface AssistantDeps extends LibraryDeps {
  cleanupAssistantSessions: typeof cleanupAssistantSessions;
  touchAssistantSession: typeof touchAssistantSession;
  assistantSessionView: typeof assistantSessionView;
  ensureInsideRoot: typeof ensureInsideRoot;
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromConfig: typeof resolveAssistantAgentFromConfig;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
}

export interface ResultAssistantDeps extends LibraryDeps {
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
  preloadResultAssistantTools: typeof import('./result-assistant-domain.js').preloadResultAssistantTools;
  continueResultAssistantTurn: typeof import('./result-assistant-domain.js').continueResultAssistantTurn;
  executeResultAssistantToolCall: typeof import('./result-assistant-domain.js').executeResultAssistantToolCall;
  summarizeToolResultForResultAssistant: typeof import('./result-assistant-domain.js').summarizeToolResultForResultAssistant;
}

export interface ScenarioAssistantDeps extends LibraryDeps {
  cleanupAssistantSessions: typeof cleanupAssistantSessions;
  touchAssistantSession: typeof touchAssistantSession;
  assistantSessionView: typeof assistantSessionView;
  ensureInsideRoot: typeof ensureInsideRoot;
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromConfig: typeof resolveAssistantAgentFromConfig;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
  preloadAssistantTools: typeof import('./scenario-assistant-domain.js').preloadAssistantTools;
  continueAssistantTurn: typeof import('./scenario-assistant-domain.js').continueAssistantTurn;
  executeAssistantToolCall: typeof import('./scenario-assistant-domain.js').executeAssistantToolCall;
  summarizeToolResultForAssistant: typeof import('./scenario-assistant-domain.js').summarizeToolResultForAssistant;
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
  resolveRunSelectedAgents: (
    config: EvalConfig,
    requestedAgents?: string[]
  ) => string[] | undefined;
  readLibraries: typeof readLibraries;
  pickDefaultAssistantAgentName: typeof pickDefaultAssistantAgentName;
  resolveAssistantAgentFromLibraries: typeof resolveAssistantAgentFromLibraries;
  chatWithAgent: typeof chatWithAgent;
  pkgVersion: string;
}

export interface AppRouteDeps
  extends HttpDeps,
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
export type AssistantSessionsMap = Map<string, ScenarioAssistantSession>;
export type RunsResults = ResultsJson;
export type RunsList = RunSummary[];
export type ConfigRecords = ConfigRecord[];
