import type { EvalConfig, EvalResult, EvalRule } from '@/types/eval';

export type DataMode = 'demo' | 'workspace';

export interface CoreServerAuthBearer {
  type: 'bearer';
  env: string;
}

export interface CoreServerAuthOauth {
  type: 'oauth_client_credentials';
  token_url: string;
  client_id_env: string;
  client_secret_env: string;
  scope?: string;
  audience?: string;
  token_params?: Record<string, string>;
}

export interface CoreServerAuthOauthAuthorizationCode {
  type: 'oauth_authorization_code';
  client_id: string;
  client_secret?: string;
  redirect_url: string;
  scope?: string;
}

export interface CoreServerConfig {
  transport: 'http';
  url: string;
  auth?: CoreServerAuthBearer | CoreServerAuthOauth | CoreServerAuthOauthAuthorizationCode;
}

export interface CoreAgentConfig {
  provider: 'openai' | 'anthropic' | 'azure_openai';
  model: string;
  temperature?: number;
  max_tokens?: number;
  system?: string;
}

export interface CoreScenario {
  id: string;
  servers: string[];
  prompt: string;
  snapshot_eval?: {
    enabled?: boolean;
    baseline_snapshot_id?: string;
    baseline_source_run_id?: string;
    last_updated_at?: string;
  };
  eval?: {
    tool_constraints?: {
      required_tools?: string[];
      forbidden_tools?: string[];
    };
    response_assertions?: Array<
      | { type: 'regex'; pattern: string }
      | { type: 'jsonpath'; path: string; equals?: string | number | boolean }
    >;
  };
  extract?: Array<{ name: string; from: 'final_text'; regex: string }>;
}

export interface CoreEvalConfig {
  servers: Record<string, CoreServerConfig>;
  server_refs?: string[];
  agents: Record<string, CoreAgentConfig>;
  agent_refs?: string[];
  scenarios: CoreScenario[];
  scenario_refs?: string[];
  run_defaults?: {
    selected_agents?: string[];
  };
  snapshot_eval?: {
    enabled: boolean;
    mode: 'warn' | 'fail_on_drift';
    baseline_snapshot_id?: string;
    baseline_source_run_id?: string;
    last_updated_at?: string;
  };
}

export interface CoreScenarioRun {
  run_index: number;
  pass: boolean;
  failures: string[];
  tool_calls: string[];
  tool_call_count: number;
  tool_sequence: string[];
  tool_usage: Record<string, number>;
  tool_durations_ms: number[];
  final_text: string;
  extracted: Record<string, string | number | boolean | null>;
}

export interface CoreScenarioAggregate {
  scenario_id: string;
  agent: string;
  runs: CoreScenarioRun[];
  pass_rate: number;
}

export interface CoreResultsJson {
  metadata: {
    run_id: string;
    timestamp: string;
    config_hash: string;
    snapshot_eval?: {
      applied: boolean;
      mode: 'warn' | 'fail_on_drift';
      baseline_snapshot_id: string;
      baseline_source_run_id?: string;
      overall_score: number;
      status: 'Match' | 'Warn' | 'Drift';
      impacted_scenarios: string[];
    };
  };
  summary: {
    total_scenarios: number;
    total_runs: number;
    pass_rate: number;
    avg_tool_calls_per_run: number;
    avg_tool_latency_ms: number | null;
  };
  scenarios: CoreScenarioAggregate[];
}

export interface TraceUiScenarioStartedEvent {
  type: 'scenario_started';
  scenario_id: string;
  ts: string;
}

export interface TraceUiLlmRequestEvent {
  type: 'llm_request';
  messages_summary: string;
  ts: string;
}

export interface TraceUiLlmResponseEvent {
  type: 'llm_response';
  raw_or_summary: string;
  ts: string;
}

export interface TraceUiToolCallEvent {
  type: 'tool_call';
  scenario_id?: string;
  tool: string;
  args?: unknown;
  ts_start?: string;
}

export interface TraceUiToolResultEvent {
  type: 'tool_result';
  scenario_id?: string;
  tool: string;
  ok: boolean;
  result_summary: string;
  duration_ms?: number;
  ts_end?: string;
}

export interface TraceUiFinalAnswerEvent {
  type: 'final_answer';
  scenario_id?: string;
  text: string;
  ts: string;
}

export interface TraceUiScenarioFinishedEvent {
  type: 'scenario_finished';
  scenario_id: string;
  pass: boolean;
  ts: string;
}

export type TraceUiEvent =
  | TraceUiScenarioStartedEvent
  | TraceUiLlmRequestEvent
  | TraceUiLlmResponseEvent
  | TraceUiToolCallEvent
  | TraceUiToolResultEvent
  | TraceUiFinalAnswerEvent
  | TraceUiScenarioFinishedEvent;

export interface WorkspaceConfigRecord {
  id: string;
  name: string;
  path: string;
  mtime: string;
  hash: string;
  config: CoreEvalConfig;
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
  configsDir: string;
  runsDir: string;
  snapshotsDir: string;
  librariesDir: string;
  scenarioAssistantAgentName?: string;
  oauthDebuggerEnabled?: boolean;
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
    oauthDebuggerEnabled?: boolean;
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
  getToolAnalysisResult: (jobId: string) => Promise<{ jobId: string; report: ToolAnalysisReport }>;
  stopToolAnalysis: (
    jobId: string
  ) => Promise<{ ok: boolean; status: 'running' | 'completed' | 'error' | 'stopped' }>;
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
