import type { EvalConfig, EvalResult, EvalRule, ScenarioRun } from '@/types/eval';
import type {
  AgentConfig as CoreAgentConfig,
  EvalConfig as CoreEvalConfig,
  SourceEvalConfig as CoreSourceEvalConfig,
  ResultsJson as CoreResultsJson,
  Scenario as CoreScenario,
  ScenarioAggregate as CoreScenarioAggregate,
  ScenarioRunResult as CoreScenarioRun,
  ScenarioRunTraceRecord as CoreScenarioRunTraceRecord,
  ServerAuthBearer as CoreServerAuthBearer,
  ServerAuthOauthAuthorizationCode as CoreServerAuthOauthAuthorizationCode,
  ServerAuthOauthClientCredentials as CoreServerAuthOauth,
  ServerConfig as CoreServerConfig,
  TraceMessage as CoreTraceMessage,
  TraceMessageContentBlock as CoreTraceMessageContentBlock,
  HealthMcpConnectionInfo,
  QueueEntry,
  QueueResponse,
  RunQueueEvent
} from '@inspectr/mcplab-core';

export type {
  CoreServerAuthBearer,
  CoreServerAuthOauth,
  CoreServerAuthOauthAuthorizationCode,
  CoreServerConfig,
  CoreAgentConfig,
  CoreScenario,
  CoreEvalConfig,
  CoreSourceEvalConfig,
  CoreScenarioRun,
  CoreScenarioAggregate,
  CoreResultsJson,
  HealthMcpConnectionInfo
};

export type TraceMessageContentBlock = CoreTraceMessageContentBlock;
export type ScenarioRunTraceMessage = CoreTraceMessage;
export type ScenarioRunTraceRecord = CoreScenarioRunTraceRecord;

export interface WorkspaceConfigRecord {
  id: string;
  name: string;
  path: string;
  relativePath?: string;
  suitePath?: string;
  mtime: string;
  hash: string;
  config: CoreSourceEvalConfig;
  error?: string;
  warnings?: string[];
}

export interface WorkspaceRunSummary {
  runId: string;
  path: string;
  timestamp: string;
  runNote?: string;
  configHash: string;
  configPath?: string;
  configName?: string;
  toolTokensTotal?: number | null;
  scenarioIds?: string[];
  scenarioNames?: string[];
  rerunAgents?: string[];
  rerunScenarioIds?: string[];
  rerunServerOverrideAll?: string[];
  rerunScenarioServerOverrides?: Record<string, string[]>;
  totalScenarios: number;
  totalRuns: number;
  passRate: number;
  avgToolCalls: number;
  avgLatencyMs: number;
}

export interface ListEnvelope<T> {
  object: 'list';
  url: string;
  data: T[];
  has_more: boolean;
  total_count: number;
  next_offset: number | null;
  prev_offset: number | null;
}

export interface MarkdownReportSummary {
  reportId: string;
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
}

export interface MarkdownReportContent {
  reportId: string;
  root: string;
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
  content: string;
}

export interface RunJobEvent {
  type: 'started' | 'log' | 'completed' | 'error' | 'queued' | 'oauth_required' | (string & {});
  ts: string;
  payload: Record<string, unknown>;
}

export type { QueueEntry, QueueResponse };
export type RunQueueSseEvent =
  | RunQueueEvent
  | { type: 'connected' | 'error'; ts: string; payload: Record<string, unknown> };

export interface ProviderModelsResponse {
  provider: 'anthropic' | 'openai' | 'azure';
  items: string[];
  kind: 'models' | 'deployments';
  source: string;
}

// Source of truth for mcp field shape: packages/core/src/types.ts HealthMcpConnectionInfo
export interface WorkspaceHealthResponse {
  ok: boolean;
  version: string;
  mcp: HealthMcpConnectionInfo;
}

export interface WorkspaceSettings {
  workspaceRoot: string;
  evalsDir: string;
  runsDir: string;
  librariesDir: string;
  scenarioAssistantAgentName?: string;
}

export interface LibraryBundle {
  servers: EvalConfig['servers'];
  agents: EvalConfig['agents'];
  scenarios: EvalConfig['scenarios'];
}

export interface CoreLibraryBundle {
  servers: CoreEvalConfig['servers'];
  agents: CoreEvalConfig['agents'];
  scenarios: CoreEvalConfig['scenarios'];
}

export interface ScenarioAssistantSuggestionBundle {
  prompt?: { replacement: string; rationale?: string };
  evalRules?: {
    replacement: Array<{
      type: EvalRule['type'];
      value?: string;
      path?: string;
      equals?: string | number | boolean;
    }>;
    rationale?: string;
  };
  extractRules?: {
    replacement: Array<{ name: string; pattern: string }>;
    rationale?: string;
  };
  notes?: string[];
}

export interface ScenarioAssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  pendingToolCallId?: string;
  pendingToolCallIds?: string[];
  toolRequestServer?: string;
  toolRequestName?: string;
  toolRequestPublicName?: string;
}

export interface ScenarioAssistantPendingToolCall {
  id: string;
  server: string;
  tool: string;
  publicToolName: string;
  arguments: unknown;
  status: 'pending' | 'approved' | 'denied' | 'error';
  createdAt: string;
  resultPreview?: string;
  error?: string;
}

export interface ScenarioAssistantSessionView {
  id: string;
  createdAt: string;
  updatedAt: string;
  selectedAssistantAgentName: string;
  model: string;
  provider: string;
  warnings: string[];
  toolsLoaded: number;
  toolServers: string[];
  messages: ScenarioAssistantMessage[];
  pendingToolCalls: ScenarioAssistantPendingToolCall[];
}

export interface ScenarioAssistantTurnResponse {
  type: 'assistant_message' | 'tool_call_request' | 'tool_call_resolved';
  text: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  pendingToolCall?: ScenarioAssistantPendingToolCall;
  pendingToolCalls?: ScenarioAssistantPendingToolCall[];
}

export interface ResultAssistantApplyReportResponse {
  ok: boolean;
  runId: string;
  outputPath: string;
  tool: string;
  path?: string;
  result: unknown;
}

export interface ResultAssistantSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  pendingToolCallId?: string;
  toolRequestServer?: string;
  toolRequestName?: string;
  toolRequestPublicName?: string;
}

export interface ResultAssistantPendingToolCall {
  id: string;
  server: string;
  tool: string;
  publicToolName: string;
  arguments: unknown;
  status: 'pending' | 'approved' | 'denied' | 'error';
  createdAt: string;
  resultPreview?: string;
  error?: string;
}

export interface ResultAssistantSessionView {
  id: string;
  scope: 'run' | 'all_runs';
  runId: string | null;
  createdAt: string;
  updatedAt: string;
  selectedAssistantAgentName: string;
  model: string;
  provider: string;
  messages: ResultAssistantSessionMessage[];
  pendingToolCalls: ResultAssistantPendingToolCall[];
}

export interface ResultAssistantTurnResponse {
  type: 'assistant_message' | 'tool_call_request';
  text: string;
  pendingToolCall?: ResultAssistantPendingToolCall;
}

export type AssistantSseEventType =
  | 'session_started'
  | 'turn_started'
  | 'tool_call_requested'
  | 'tool_call_approved'
  | 'tool_call_denied'
  | 'tool_call_resolved'
  | 'assistant_message_completed'
  | 'session_warning'
  | 'session_error'
  | 'session_finished';

export interface AssistantSseEvent<TSession> {
  type: AssistantSseEventType;
  ts: string;
  payload: Record<string, unknown> & {
    sessionId: string;
    session: TSession;
  };
}

export type ResultAssistantSseEvent = AssistantSseEvent<ResultAssistantSessionView>;
export type ScenarioAssistantSseEvent = AssistantSseEvent<ScenarioAssistantSessionView>;

export interface ScenarioPreviewCoreRunResponse {
  runId: string;
  scenario: {
    scenarioId: string;
    agent: string;
    run: CoreScenarioRun | null;
    traceRecord: ScenarioRunTraceRecord | null;
  };
}

export interface ScenarioPreviewResult {
  runId: string;
  scenarioId: string;
  agentName: string;
  run: ScenarioRun;
}

export interface ToolAnalysisFinding {
  id: string;
  scope:
    | 'tool_name'
    | 'description'
    | 'schema'
    | 'ergonomics'
    | 'safety'
    | 'eval_readiness'
    | 'execution';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  suggestion?: string;
}

export interface ToolAnalysisToolReport {
  serverName: string;
  toolName: string;
  publicToolName: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  safetyClassification: 'read_only' | 'unsafe_or_unknown';
  classificationReason: string;
  metadataReview?: {
    strengths: string[];
    issues: ToolAnalysisFinding[];
    suggestedDescription?: string;
    suggestedSchemaChanges: Array<{
      type:
        | 'description'
        | 'parameter'
        | 'required'
        | 'enum'
        | 'constraints'
        | 'examples'
        | 'naming';
      summary: string;
      before?: string;
      after?: string;
    }>;
    evalReadinessNotes: string[];
  };
  deeperAnalysis?: {
    attempted: boolean;
    skippedReason?: string;
    sampleCalls: Array<{
      callIndex: number;
      arguments: unknown;
      ok: boolean;
      durationMs?: number;
      resultPreview?: string;
      error?: string;
      observations: string[];
      issues: ToolAnalysisFinding[];
    }>;
    overallObservations: string[];
  };
  overallRecommendations: string[];
}

export interface ToolAnalysisServerReport {
  serverName: string;
  toolCountDiscovered: number;
  toolCountAnalyzed: number;
  toolCountSkipped: number;
  warnings: string[];
  tools: ToolAnalysisToolReport[];
}

export interface ToolAnalysisReport {
  schemaVersion: 1;
  createdAt: string;
  assistantAgentName: string;
  assistantAgentModel: string;
  modes: {
    metadataReview: boolean;
    deeperAnalysis: boolean;
  };
  settings: {
    autoRunPolicy?: 'read_only_allowlist';
    sampleCallsPerTool?: number;
    toolCallTimeoutMs?: number;
    maxParallelTools?: number;
  };
  summary: {
    serversAnalyzed: number;
    toolsAnalyzed: number;
    toolsSkipped: number;
    issueCounts: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
    };
  };
  servers: ToolAnalysisServerReport[];
  findings: ToolAnalysisFinding[];
  mcpServerVersions?: Record<string, string | null>;
}

export interface SavedToolAnalysisReportRecord {
  recordVersion: 1;
  reportId: string;
  createdAt: string;
  sourceJobId: string;
  serverNames: string[];
  report: ToolAnalysisReport;
}

export interface ToolAnalysisResultSummary {
  reportId: string;
  createdAt: string;
  assistantAgentName: string;
  assistantAgentModel: string;
  serverNames: string[];
  modes: ToolAnalysisReport['modes'];
  summary: ToolAnalysisReport['summary'];
}

export interface ToolAnalysisDiscoveredTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  safetyClassification: 'read_only' | 'unsafe_or_unknown';
  classificationReason: string;
}

export interface ToolAnalysisDiscoverResponse {
  servers: Array<{
    serverName: string;
    mcpServerVersion?: string | null;
    mcpServerImplementation?: {
      name: string;
      version: string;
      title?: string;
      description?: string;
      websiteUrl?: string;
      icons?: Array<{
        src: string;
        mimeType?: string;
        sizes?: string[];
        theme?: 'light' | 'dark';
      }>;
    } | null;
    warnings: string[];
    tools: ToolAnalysisDiscoveredTool[];
  }>;
}

export type OAuthDebuggerSessionStatus =
  | 'configuring'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_browser_callback'
  | 'completed'
  | 'error'
  | 'stopped';

export interface OAuthValidationFinding {
  id: string;
  stepId: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  title: string;
  detail: string;
  specReference?: string;
  recommendation?: string;
}

export interface OAuthNetworkExchange {
  id: string;
  stepId: string;
  kind: 'http';
  phase: 'request' | 'response';
  label: string;
  method?: string;
  url: string;
  headers: Record<string, string>;
  bodyText?: string;
  status?: number;
  durationMs?: number;
  timestamp: string;
}

export interface OAuthDebuggerStepState {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  outcomeSummary?: string;
  teachableMoment?: string;
  networkExchangeIds: string[];
  validationIds: string[];
}

export interface OAuthSequenceEvent {
  id: string;
  ts: string;
  from: string;
  to: string;
  label: string;
  stepId?: string;
  networkExchangeId?: string;
}

export interface OAuthDebuggerSessionView {
  id: string;
  status: OAuthDebuggerSessionStatus;
  createdAt: string;
  updatedAt: string;
  profile: 'latest';
  registrationMethod: 'pre_registered' | 'dcr' | 'cimd';
  stepStates: OAuthDebuggerStepState[];
  validations: OAuthValidationFinding[];
  network: OAuthNetworkExchange[];
  networkSummary: {
    requestCount: number;
    errorCount: number;
  };
  sequence: OAuthSequenceEvent[];
  uiHints: {
    nextAction?: 'start' | 'open_authorize_url' | 'paste_callback_url' | 'none';
    authorizationUrl?: string;
    callbackMode?: 'local_callback' | 'manual';
    callbackUrl?: string;
  };
  summary?: {
    showSensitiveValues?: boolean;
    issuer?: string;
    clientId?: string;
    redirectUri?: string;
    tokenEndpointStatus?: number;
    tokenType?: string;
    grantedScopes?: string[];
    accessToken?: string;
    accessTokenExpiresInSeconds?: number;
    accessTokenExpiresAt?: string;
    accessTokenValidForSeconds?: number;
    accessTokenExpirySource?: 'expires_in' | 'jwt_exp' | 'none';
    refreshTokenAvailable?: boolean;
  };
}

export interface OAuthDebuggerSessionConfig {
  profile: 'latest';
  target: {
    serverName: string;
    overrides?: {
      authorizationServerMetadataUrl?: string;
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      registrationEndpoint?: string;
      cimdUrl?: string;
      resourceBaseUrl?: string;
    };
  };
  registrationMethod: 'pre_registered' | 'dcr' | 'cimd';
  clientConfig: {
    preRegistered?: {
      clientId: string;
      clientSecret?: string;
      tokenEndpointAuthMethod?: string;
    };
    dcr?: {
      metadata?: Record<string, unknown>;
      tokenEndpointAuthMethod?: string;
    };
    cimd?: {
      cimdUrl?: string;
      expectedClientId?: string;
    };
  };
  runtime: {
    redirectMode: 'local_callback' | 'manual';
    scopes?: string[];
    resource?: string;
    usePkce: boolean;
    codeChallengeMethod?: 'S256';
    state?: string;
    nonce?: string;
    extraAuthParams?: Record<string, string>;
  };
  display: {
    showSensitiveValues: boolean;
  };
}

export interface OAuthDebuggerSessionEvent {
  type:
    | 'started'
    | 'step_started'
    | 'step_completed'
    | 'step_failed'
    | 'http_request'
    | 'http_response'
    | 'validation'
    | 'log'
    | 'waiting_for_user'
    | 'waiting_for_browser_callback'
    | 'completed'
    | 'error'
    | 'stopped';
  ts: string;
  payload: Record<string, unknown>;
}

export type OAuthRuntimeSessionStatus =
  | 'configuring'
  | 'waiting_for_user'
  | 'waiting_for_browser_callback'
  | 'completed'
  | 'error'
  | 'stopped';

export interface OAuthRuntimeSessionView {
  id: string;
  serverName: string;
  status: OAuthRuntimeSessionStatus;
  createdAt: string;
  updatedAt: string;
  oauthDebuggerSessionId: string;
  authorizationUrl?: string;
  authorizeLaunchUrl?: string;
  callbackUrl?: string;
  hasAccessToken: boolean;
  lastError?: string;
}

export interface OAuthEnsureServerStatus {
  serverName: string;
  status: 'ready' | 'auth_required' | 'not_oauth';
  debugState?: 'reused' | 'refreshed' | 'auth_required' | 'not_oauth';
  tokenExpiresAt?: string;
  tokenExpiresInSeconds?: number;
  runtimeSessionId?: string;
  authorizationUrl?: string;
  authorizeLaunchUrl?: string;
  message?: string;
}

export interface EvalDataSource {
  health: () => Promise<WorkspaceHealthResponse>;
  listConfigs: () => Promise<EvalConfig[]>;
  createConfig: (config: EvalConfig) => Promise<EvalConfig>;
  updateConfig: (config: EvalConfig) => Promise<EvalConfig>;
  deleteConfig: (id: string) => Promise<void>;
  listResults: (filter?: {
    since?: string;
    until?: string;
    lastDays?: number;
  }) => Promise<EvalResult[]>;
  listRunSummaries?: (filter?: {
    since?: string;
    until?: string;
    lastDays?: number;
    scenario?: string;
    limit?: number;
    offset?: number;
  }) => Promise<WorkspaceRunSummary[]>;
  listRunSummariesPage?: (filter?: {
    since?: string;
    until?: string;
    lastDays?: number;
    scenario?: string;
    limit?: number;
    offset?: number;
  }) => Promise<ListEnvelope<WorkspaceRunSummary>>;
  getLatestPassRatesByConfigIds?: (params: {
    lastDays?: number;
    configs: Array<{
      id: string;
      sourcePath?: string;
      relativePath?: string;
      configHash?: string;
    }>;
  }) => Promise<Record<string, number>>;
  getResult: (id: string) => Promise<EvalResult | undefined>;
  deleteResult: (id: string) => Promise<void>;
  updateRunNote: (runId: string, runNote?: string) => Promise<void>;
  startRun: (params: {
    configPath: string;
    runsPerScenario: number;
    scenarioId?: string;
    scenarioIds?: string[];
    agents?: string[];
    runNote?: string;
    serverOverrideAll?: string[];
    scenarioServerOverrides?: Record<string, string[]>;
  }) => Promise<{ jobId: string }>;
  stopRun: (jobId: string) => Promise<void>;
  getRunQueue: () => Promise<QueueResponse>;
  subscribeRunQueue: (onEvent: (event: RunQueueSseEvent) => void) => () => void;
  removeQueuedRun: (jobId: string) => Promise<void>;
  resumeQueue: () => Promise<{ ok: boolean }>;
  subscribeRunJob: (jobId: string, onEvent: (event: RunJobEvent) => void) => () => void;
  applyResultAssistantReport: (params: {
    runId: string;
    markdown: string;
    outputPath?: string;
    overwrite?: boolean;
  }) => Promise<ResultAssistantApplyReportResponse>;
  createResultAssistantSession: (
    params: {
      runId?: string;
      scope?: 'run' | 'all_runs';
    },
    signal?: AbortSignal
  ) => Promise<{ sessionId: string; session: ResultAssistantSessionView }>;
  getResultAssistantSession: (
    sessionId: string
  ) => Promise<{ session: ResultAssistantSessionView }>;
  sendResultAssistantMessage: (
    sessionId: string,
    message: string,
    signal?: AbortSignal
  ) => Promise<{ session: ResultAssistantSessionView; response: ResultAssistantTurnResponse }>;
  approveResultAssistantToolCall: (
    sessionId: string,
    callId: string,
    argumentsOverride?: unknown
  ) => Promise<{ session: ResultAssistantSessionView; response: ResultAssistantTurnResponse }>;
  denyResultAssistantToolCall: (
    sessionId: string,
    callId: string
  ) => Promise<{ session: ResultAssistantSessionView; response: ResultAssistantTurnResponse }>;
  closeResultAssistantSession: (sessionId: string) => Promise<void>;
  subscribeResultAssistantSessionEvents: (
    sessionId: string,
    onEvent: (event: ResultAssistantSseEvent) => void
  ) => () => void;
  getLibraries: () => Promise<LibraryBundle>;
  saveLibraries: (libraries: LibraryBundle) => Promise<void>;
  listProviderModels: (
    provider: 'anthropic' | 'openai' | 'azure'
  ) => Promise<ProviderModelsResponse>;
  getWorkspaceSettings: () => Promise<WorkspaceSettings | null>;
  updateWorkspaceSettings: (patch: {
    scenarioAssistantAgentName?: string;
  }) => Promise<WorkspaceSettings | null>;
  createScenarioAssistantSession: (
    params: {
      configId?: string;
      configPath?: string;
      scenarioId: string;
      selectedAssistantAgentName: string;
      context: {
        scenario: {
          id: string;
          name: string;
          prompt: string;
          serverNames: string[];
          evalRules: Array<{
            type: EvalRule['type'];
            value?: string;
            path?: string;
            equals?: string | number | boolean;
          }>;
          extractRules: Array<{ name: string; pattern: string }>;
        };
        availableServers: Array<{ name: string; url?: string }>;
        availableAgents: Array<{ name: string; provider: string; model: string }>;
      };
    },
    signal?: AbortSignal
  ) => Promise<{ sessionId: string; session: ScenarioAssistantSessionView }>;
  getScenarioAssistantSession: (
    sessionId: string
  ) => Promise<{ session: ScenarioAssistantSessionView }>;
  sendScenarioAssistantMessage: (
    sessionId: string,
    message: string,
    signal?: AbortSignal
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  approveScenarioAssistantToolCall: (
    sessionId: string,
    callId: string
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  denyScenarioAssistantToolCall: (
    sessionId: string,
    callId: string
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  approveAllScenarioAssistantToolCalls: (
    sessionId: string
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  closeScenarioAssistantSession: (sessionId: string) => Promise<void>;
  subscribeScenarioAssistantSessionEvents: (
    sessionId: string,
    onEvent: (event: ScenarioAssistantSseEvent) => void
  ) => () => void;
  runScenarioPreview: (params: {
    selectedAgentName: string;
    scenario: {
      id: string;
      name: string;
      prompt: string;
      serverNames: string[];
      evalRules: Array<{
        type: EvalRule['type'];
        value?: string;
        path?: string;
        equals?: string | number | boolean;
      }>;
      extractRules: Array<{ name: string; pattern: string }>;
    };
  }) => Promise<ScenarioPreviewResult>;
  discoverToolsForAnalysis: (params: {
    serverNames: string[];
  }) => Promise<ToolAnalysisDiscoverResponse>;
  startToolAnalysis: (params: {
    assistantAgentName?: string;
    serverNames: string[];
    selectedToolsByServer?: Record<string, string[]>;
    maxParallelTools?: number;
    modes: {
      metadataReview: boolean;
      deeperAnalysis: boolean;
    };
    deeperAnalysisOptions?: {
      autoRunPolicy: 'read_only_allowlist';
      sampleCallsPerTool?: number;
      toolCallTimeoutMs?: number;
    };
  }) => Promise<{ jobId: string }>;
  subscribeToolAnalysisJob: (jobId: string, onEvent: (event: RunJobEvent) => void) => () => void;
  getToolAnalysisResult: (
    jobId: string
  ) => Promise<{ jobId: string; report: ToolAnalysisReport; savedReportId?: string }>;
  stopToolAnalysis: (
    jobId: string
  ) => Promise<{ ok: boolean; status: 'running' | 'completed' | 'error' | 'stopped' }>;
  listToolAnalysisResults: (params?: {
    limit?: number;
    offset?: number;
    server?: string;
  }) => Promise<ToolAnalysisResultSummary[]>;
  listToolAnalysisResultsPage?: (params?: {
    limit?: number;
    offset?: number;
    server?: string;
  }) => Promise<ListEnvelope<ToolAnalysisResultSummary>>;
  listToolAnalysisServers?: () => Promise<string[]>;
  getToolAnalysisSavedResult: (id: string) => Promise<SavedToolAnalysisReportRecord>;
  deleteToolAnalysisSavedResult: (id: string) => Promise<void>;
  listMarkdownReports: (params?: {
    limit?: number;
    offset?: number;
  }) => Promise<MarkdownReportSummary[]>;
  listMarkdownReportsPage?: (params?: {
    limit?: number;
    offset?: number;
  }) => Promise<ListEnvelope<MarkdownReportSummary>>;
  getMarkdownReport: (relativePath: string) => Promise<MarkdownReportContent>;
  getMarkdownReportById?: (reportId: string) => Promise<MarkdownReportContent>;
  deleteMarkdownReport: (relativePath: string) => Promise<void>;
  createOAuthDebuggerSession: (
    config: OAuthDebuggerSessionConfig
  ) => Promise<{ sessionId: string; session: OAuthDebuggerSessionView }>;
  getOAuthDebuggerSession: (sessionId: string) => Promise<{ session: OAuthDebuggerSessionView }>;
  startOAuthDebuggerSession: (sessionId: string) => Promise<{ session: OAuthDebuggerSessionView }>;
  subscribeOAuthDebuggerSession: (
    sessionId: string,
    onEvent: (event: OAuthDebuggerSessionEvent) => void
  ) => () => void;
  submitOAuthDebuggerManualCallback: (
    sessionId: string,
    payload: { redirectUrl?: string; code?: string; state?: string }
  ) => Promise<{ session: OAuthDebuggerSessionView }>;
  stopOAuthDebuggerSession: (
    sessionId: string
  ) => Promise<{ ok: boolean; status: OAuthDebuggerSessionStatus }>;
  exportOAuthDebuggerSession: (
    sessionId: string,
    format: 'json' | 'markdown' | 'raw'
  ) => Promise<string | { session: OAuthDebuggerSessionView; raw: unknown }>;
  createOAuthRuntimeSession: (params: {
    serverName: string;
  }) => Promise<{ session: OAuthRuntimeSessionView }>;
  getOAuthRuntimeSession: (sessionId: string) => Promise<{ session: OAuthRuntimeSessionView }>;
  getOAuthRuntimeSessionToken: (sessionId: string) => Promise<{ accessToken: string }>;
  submitOAuthRuntimeCallback: (
    sessionId: string,
    payload: { redirectUrl?: string; code?: string; state?: string }
  ) => Promise<{ session: OAuthRuntimeSessionView }>;
  cancelOAuthRuntimeSession: (sessionId: string) => Promise<{ session: OAuthRuntimeSessionView }>;
  ensureOAuthServers: (params: {
    serverNames: string[];
  }) => Promise<{ servers: OAuthEnsureServerStatus[]; allReady: boolean }>;
}
