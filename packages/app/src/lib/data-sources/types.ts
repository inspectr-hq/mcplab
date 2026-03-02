import type { EvalConfig, EvalResult, EvalRule } from '@/types/eval';
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
  TraceMessageContentBlock as CoreTraceMessageContentBlock
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
  CoreResultsJson
};

export type TraceMessageContentBlock = CoreTraceMessageContentBlock;
export type ScenarioRunTraceMessage = CoreTraceMessage;
export type ScenarioRunTraceRecord = CoreScenarioRunTraceRecord;

export interface WorkspaceConfigRecord {
  id: string;
  name: string;
  path: string;
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
  configHash: string;
  totalScenarios: number;
  totalRuns: number;
  passRate: number;
  avgToolCalls: number;
  avgLatencyMs: number;
}

export interface MarkdownReportSummary {
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
}

export interface MarkdownReportContent {
  root: string;
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
  content: string;
}

export interface SnapshotItem {
  scenario_id: string;
  baseline_agents: string[];
  required_tools: string[];
  forbidden_tools: string[];
  allowed_sequences: string[][];
  baseline_tools: string[];
  extracted_values: Record<string, string | number | boolean | null>;
  final_answer_features: {
    token_set: string[];
  };
}

export interface SnapshotRecord {
  schema_version: 2;
  id: string;
  name: string;
  created_at: string;
  source_run_id: string;
  config_hash: string;
  source_summary: {
    total_scenarios: number;
    total_runs: number;
    pass_rate: number;
  };
  items: SnapshotItem[];
}

export interface SnapshotScenarioComparison {
  scenario_id: string;
  baseline_agents: string[];
  observed_agents: string[];
  score: number;
  status: 'Match' | 'Warn' | 'Drift';
  components: {
    tools: number;
    extracts: number;
    semantics: number;
  };
  reasons: string[];
}

export interface SnapshotComparison {
  snapshot_id: string;
  run_id: string;
  overall_score: number;
  scenario_results: SnapshotScenarioComparison[];
}

export interface RunJobEvent {
  type: 'started' | 'log' | 'completed' | 'error';
  ts: string;
  payload: Record<string, unknown>;
}

export interface ProviderModelsResponse {
  provider: 'anthropic' | 'openai' | 'azure';
  items: string[];
  kind: 'models' | 'deployments';
  source: string;
}

export interface WorkspaceSettings {
  workspaceRoot: string;
  evalsDir: string;
  runsDir: string;
  snapshotsDir: string;
  librariesDir: string;
  scenarioAssistantAgentName?: string;
}

export interface ScenarioAssistantSuggestionBundle {
  prompt?: { replacement: string; rationale?: string };
  evalRules?: {
    replacement: Array<{ type: EvalRule['type']; value: string }>;
    rationale?: string;
  };
  extractRules?: {
    replacement: Array<{ name: string; pattern: string }>;
    rationale?: string;
  };
  snapshotEval?: {
    patch: {
      enabled?: boolean;
      baselineSnapshotId?: string;
    };
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
  type: 'assistant_message' | 'tool_call_request';
  text: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  pendingToolCall?: ScenarioAssistantPendingToolCall;
}

export interface ResultAssistantChatMessage {
  role: 'user' | 'assistant';
  text: string;
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
  runId: string;
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
  description?: string;
  inputSchema?: unknown;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
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
  description?: string;
  inputSchema?: unknown;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
}

export interface ToolAnalysisDiscoverResponse {
  servers: Array<{
    serverName: string;
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
    issuer?: string;
    clientId?: string;
    redirectUri?: string;
    tokenEndpointStatus?: number;
    tokenType?: string;
    grantedScopes?: string[];
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

export interface EvalDataSource {
  listConfigs: () => Promise<EvalConfig[]>;
  createConfig: (config: EvalConfig) => Promise<EvalConfig>;
  updateConfig: (config: EvalConfig) => Promise<EvalConfig>;
  deleteConfig: (id: string) => Promise<void>;
  listResults: () => Promise<EvalResult[]>;
  getResult: (id: string) => Promise<EvalResult | undefined>;
  deleteResult: (id: string) => Promise<void>;
  startRun: (params: {
    configPath: string;
    runsPerScenario: number;
    scenarioId?: string;
    scenarioIds?: string[];
    agents?: string[];
    applySnapshotEval?: boolean;
  }) => Promise<{ jobId: string }>;
  stopRun: (jobId: string) => Promise<void>;
  subscribeRunJob: (jobId: string, onEvent: (event: RunJobEvent) => void) => () => void;
  listSnapshots: () => Promise<SnapshotRecord[]>;
  createSnapshotFromRun: (runId: string, name?: string) => Promise<SnapshotRecord>;
  getSnapshot: (id: string) => Promise<SnapshotRecord | undefined>;
  compareSnapshot: (snapshotId: string, runId: string) => Promise<SnapshotComparison>;
  askResultAssistant: (
    runId: string,
    messages: ResultAssistantChatMessage[]
  ) => Promise<{ reply: string; assistantAgentName: string; provider: string; model: string }>;
  applyResultAssistantReport: (params: {
    runId: string;
    markdown: string;
    outputPath?: string;
    overwrite?: boolean;
  }) => Promise<ResultAssistantApplyReportResponse>;
  createResultAssistantSession: (
    runId: string
  ) => Promise<{ sessionId: string; session: ResultAssistantSessionView }>;
  getResultAssistantSession: (
    sessionId: string
  ) => Promise<{ session: ResultAssistantSessionView }>;
  sendResultAssistantMessage: (
    sessionId: string,
    message: string
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
  generateSnapshotEvalBaseline: (
    runId: string,
    configId: string,
    name?: string
  ) => Promise<{ snapshot: SnapshotRecord; config: EvalConfig }>;
  updateSnapshotPolicy: (
    configId: string,
    policy: {
      enabled: boolean;
      mode: 'warn' | 'fail_on_drift';
      baselineSnapshotId?: string;
      baselineSourceRunId?: string;
    }
  ) => Promise<EvalConfig>;
  getLibraries: () => Promise<{
    servers: EvalConfig['servers'];
    agents: EvalConfig['agents'];
    scenarios: EvalConfig['scenarios'];
  }>;
  saveLibraries: (libraries: {
    servers: EvalConfig['servers'];
    agents: EvalConfig['agents'];
    scenarios: EvalConfig['scenarios'];
  }) => Promise<void>;
  listProviderModels: (
    provider: 'anthropic' | 'openai' | 'azure'
  ) => Promise<ProviderModelsResponse>;
  getWorkspaceSettings: () => Promise<WorkspaceSettings | null>;
  updateWorkspaceSettings: (patch: {
    scenarioAssistantAgentName?: string;
  }) => Promise<WorkspaceSettings | null>;
  createScenarioAssistantSession: (params: {
    configId?: string;
    configPath?: string;
    scenarioId: string;
    selectedAssistantAgentName: string;
    context: {
      configSnapshotPolicy?: {
        enabled: boolean;
        mode: 'warn' | 'fail_on_drift';
        baselineSnapshotId?: string;
      };
      scenario: {
        id: string;
        name: string;
        prompt: string;
        serverNames: string[];
        evalRules: Array<{ type: EvalRule['type']; value: string }>;
        extractRules: Array<{ name: string; pattern: string }>;
        snapshotEval?: {
          enabled?: boolean;
          baselineSnapshotId?: string;
        };
      };
      availableServers: Array<{ name: string; url?: string }>;
      availableAgents: Array<{ name: string; provider: string; model: string }>;
    };
  }) => Promise<{ sessionId: string; session: ScenarioAssistantSessionView }>;
  getScenarioAssistantSession: (
    sessionId: string
  ) => Promise<{ session: ScenarioAssistantSessionView }>;
  sendScenarioAssistantMessage: (
    sessionId: string,
    message: string
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  approveScenarioAssistantToolCall: (
    sessionId: string,
    callId: string
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  denyScenarioAssistantToolCall: (
    sessionId: string,
    callId: string
  ) => Promise<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>;
  closeScenarioAssistantSession: (sessionId: string) => Promise<void>;
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
  listToolAnalysisResults: () => Promise<ToolAnalysisResultSummary[]>;
  getToolAnalysisSavedResult: (id: string) => Promise<SavedToolAnalysisReportRecord>;
  deleteToolAnalysisSavedResult: (id: string) => Promise<void>;
  listMarkdownReports: () => Promise<MarkdownReportSummary[]>;
  getMarkdownReport: (relativePath: string) => Promise<MarkdownReportContent>;
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
}
