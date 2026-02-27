import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppSettings } from './types.js';
import type { parseBody, asJson, asText } from './http.js';
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
import type {
  cleanupAssistantSessions,
  touchAssistantSession,
  assistantSessionView,
  pickDefaultAssistantAgentName,
  resolveAssistantAgentFromConfig,
  resolveAssistantAgentFromLibraries,
  preloadAssistantTools,
  continueAssistantTurn,
  executeAssistantToolCall,
  summarizeToolResultForAssistant,
  ScenarioAssistantSession
} from './scenario-assistant-domain.js';
import type {
  listSnapshots,
  buildSnapshotFromRun,
  saveSnapshot,
  loadSnapshot,
  compareRunToSnapshot,
  applySnapshotPolicyToRunResult
} from '../snapshot.js';
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

export interface HttpDeps {
  parseBody: typeof parseBody;
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
  preloadAssistantTools: typeof preloadAssistantTools;
  continueAssistantTurn: typeof continueAssistantTurn;
  executeAssistantToolCall: typeof executeAssistantToolCall;
  summarizeToolResultForAssistant: typeof summarizeToolResultForAssistant;
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

export interface SnapshotDeps {
  listSnapshots: typeof listSnapshots;
  buildSnapshotFromRun: typeof buildSnapshotFromRun;
  saveSnapshot: typeof saveSnapshot;
  loadSnapshot: typeof loadSnapshot;
  compareRunToSnapshot: typeof compareRunToSnapshot;
  getRunResults: typeof getRunResults;
  decodeEvalId: typeof decodeEvalId;
  readConfigRecord: typeof readConfigRecord;
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
  loadSnapshot: typeof loadSnapshot;
  compareRunToSnapshot: typeof compareRunToSnapshot;
  applySnapshotPolicyToRunResult: typeof applySnapshotPolicyToRunResult;
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
    AssistantDeps,
    SnapshotDeps,
    ConfigDeps,
    RunDeps {}

export type ToolAnalysisJobsMap = Map<string, ToolAnalysisJob>;
export type OAuthDebuggerSessionsMap = Map<string, OAuthDebuggerSession>;
export type AssistantSessionsMap = Map<string, ScenarioAssistantSession>;
export type RunsResults = ResultsJson;
export type RunsList = RunSummary[];
export type ConfigRecords = ConfigRecord[];
