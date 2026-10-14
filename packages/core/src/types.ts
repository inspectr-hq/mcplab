export interface EvaluationDecisionConfig {
  /** Omitted means enabled for compatibility with existing saved configurations. */
  enabled?: boolean;
  provider: 'openai' | 'cloudflare' | 'typesafe' | 'ollama' | 'azure_foundry';
  model: string;
  passThreshold: number;
  failThreshold: number;
  baseUrl?: string;
}

export interface WorkspaceEvaluationSettings {
  evaluationJudgeAgentName?: string;
  evaluationDecision?: EvaluationDecisionConfig;
}

export interface WorkspaceSettingsOverrides {
  scenario_assistant_agent_name?: string;
  evaluation_judge_agent_name?: string;
  default_queue_workers?: unknown;
  evaluation_decision?: EvaluationDecisionConfig;
}

export interface WorkspaceSettingsPatch {
  defaultQueueWorkers?: number;
  scenarioAssistantAgentName?: string | null;
  evaluationJudgeAgentName?: string | null;
  evaluationDecision?: EvaluationDecisionConfig | null;
  evalsDir?: string;
  runsDir?: string;
  librariesDir?: string;
}

export type AssistantKind = 'scenario' | 'result';

export interface ScenarioAssistantSuggestionRule {
  type: string;
  value?: string | number | boolean;
  sequence?: string[];
  path?: string;
  equals?: string | number | boolean;
  tool?: string;
  label?: string;
  prompt?: string;
}

export interface ScenarioAssistantSuggestionBundle {
  prompt?: { replacement: string; rationale?: string };
  evalRules?: { replacement: ScenarioAssistantSuggestionRule[]; rationale?: string };
  extractRules?: { replacement: Array<{ name: string; pattern: string }>; rationale?: string };
  notes?: string[];
}

export interface ScenarioAssistantRuntimeContext {
  scenario: {
    id: string;
    name?: string;
    prompt: string;
    serverNames: string[];
    evalRules: ScenarioAssistantSuggestionRule[];
    extractRules: Array<{ name: string; pattern: string }>;
  };
  availableServers?: Array<{ name: string; url?: string }>;
  availableAgents?: Array<{ name: string; provider: string; model: string }>;
}

export interface ResultAssistantRuntimeContext {
  scope: 'run' | 'all_runs';
  runId: string | null;
  resultSummary: ResultsJson | null;
  referenceReportsForRun: Array<{
    path: string;
    relativePath: string;
    name: string;
    sizeBytes: number;
    mtime: string;
  }>;
}

export interface AssistantRuntimeMessage {
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

export interface AssistantRuntimeToolCall {
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

export interface AssistantRuntimeSnapshot {
  messages: AssistantRuntimeMessage[];
  pendingToolCalls: AssistantRuntimeToolCall[];
}

export type ScenarioAssistantMessage = AssistantRuntimeMessage;
export type ScenarioAssistantPendingToolCall = AssistantRuntimeToolCall;
export type ResultAssistantSessionMessage = AssistantRuntimeMessage;
export type ResultAssistantPendingToolCall = AssistantRuntimeToolCall;

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

export interface AssistantSessionEvent<TSession = unknown> {
  type: AssistantRuntimeEvent['type'];
  ts: string;
  payload: Record<string, unknown> & { sessionId: string; session: TSession };
}

export type ScenarioAssistantTurnResponse = AssistantRuntimeResponse;
export type ResultAssistantTurnResponse =
  | { type: 'assistant_message'; text: string }
  | {
      type: 'tool_call_request' | 'tool_call_resolved';
      text: string;
      pendingToolCall?: ResultAssistantPendingToolCall;
      pendingToolCalls?: ResultAssistantPendingToolCall[];
    };

export interface AssistantRuntimeEvent {
  type:
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
  ts: string;
  payload: Record<string, unknown>;
}

export type AssistantRuntimeResponse =
  | {
      type: 'assistant_message';
      text: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
    }
  | {
      type: 'tool_call_request' | 'tool_call_resolved';
      text: string;
      pendingToolCalls: AssistantRuntimeToolCall[];
      pendingToolCall?: AssistantRuntimeToolCall;
    };

export type AssistantRuntimeModelOutput =
  | { type: 'assistant_message'; text: string; suggestions?: ScenarioAssistantSuggestionBundle }
  | {
      type: 'tool_call_request';
      text: string;
      toolCalls: Array<{ name: string; arguments?: unknown }>;
      suggestions?: ScenarioAssistantSuggestionBundle;
    };

export interface AssistantToolCallDecision {
  toolCallId: string;
  decision: 'approve' | 'deny';
  arguments?: unknown;
}

export interface AssistantRuntimeDefinition {
  assistant: AssistantKind;
  outputMode: 'json' | 'native';
  agent: LlmAgentConfig;
  context: ScenarioAssistantRuntimeContext | ResultAssistantRuntimeContext;
  getSystemPrompt(): string;
  tools: AssistantRuntimeTool[];
  initialMessages?: AssistantRuntimeMessage[];
  approvalPolicy(toolName: string): 'automatic' | 'approval_required' | 'local';
  decodeOutput(value: unknown): AssistantRuntimeModelOutput;
  onEvent?(event: AssistantRuntimeEvent): void;
  dispose?(): Promise<void> | void;
}

export interface AssistantRuntimeTool {
  name: string;
  server: string;
  tool: string;
  description?: string;
  inputSchema?: unknown;
  execute(arguments_: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface AssistantRuntimeSession {
  sendMessage(message: string, signal?: AbortSignal): Promise<AssistantRuntimeResponse>;
  resolveToolCalls(
    decisions: AssistantToolCallDecision[],
    signal?: AbortSignal
  ): Promise<AssistantRuntimeResponse>;
  getSnapshot(): AssistantRuntimeSnapshot;
  isBusy?(): boolean;
  dispose(): Promise<void> | void;
}

export interface AssistantRuntimeFactory {
  create(definition: AssistantRuntimeDefinition): Promise<AssistantRuntimeSession>;
}

export interface EvaluationJudge {
  name: string;
  agent: LlmAgentConfig;
}

export interface WorkspaceEvaluation {
  evaluationJudge?: EvaluationJudge;
  evaluationDecision?: EvaluationDecisionConfig;
}

export interface ResolveWorkspaceEvaluationParams {
  agents: EvalConfig['agents'];
  scenarios: ReadonlyArray<Pick<Scenario, 'id' | 'eval'>>;
  scenarioId?: string;
  settings: WorkspaceEvaluationSettings;
}

export interface AgentAssertionJudgeResult {
  label: string;
  pass: boolean;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticEvaluationParams {
  assertions: AgentAssertion[];
  finalText: string;
  context?: AgentJudgeContext;
  judge: EvaluationJudge;
  evaluationDecision?: EvaluationDecisionConfig;
  signal?: AbortSignal;
}

export interface DecisionCheck {
  id: string;
  prompt: string;
}

export type DecisionFallback =
  | 'missing_credentials'
  | 'http_error'
  | 'connection_error'
  | 'timeout'
  | 'invalid_response'
  | 'missing_answer'
  | 'duplicate_answer'
  | 'refusal'
  | 'invalid_answer'
  | 'invalid_configuration'
  | 'uncertain';

export interface DecisionAnswer {
  id: string;
  probability?: number;
  model?: string;
  durationMs: number;
  fallback?: DecisionFallback;
}

export interface DecisionConnectionTestResult {
  ok: boolean;
  message: string;
  provider: EvaluationDecisionConfig['provider'];
  requestedModel: string;
  model?: string;
  probability?: number;
  durationMs: number;
  failure?: DecisionFallback;
}

export interface DecisionRequest {
  config: EvaluationDecisionConfig;
  evidence: unknown;
  checks: DecisionCheck[];
  signal?: AbortSignal;
}

export interface DecisionAdapter {
  requiredEnv: readonly (string | readonly string[])[];
  authEnv?: string | readonly string[];
  authHeader?: string;
  authPrefix?: string;
  url(config: EvaluationDecisionConfig): string;
  timeoutMs: number;
  maxBatchSize: number;
  sequential: boolean;
  body(params: DecisionRequest): unknown;
  extract(raw: unknown): Record<string, unknown> | undefined;
  entries(raw: unknown): Array<[string, unknown]>;
  answerType: string;
  probabilityField: string;
}

export type TransportType = 'http';

export interface ServerAuthBearer {
  type: 'bearer';
  env?: string;
  token?: string;
}

export interface ServerAuthApiKey {
  type: 'api_key';
  header_name?: string;
  value: string;
}

export interface ServerAuthOauthClientCredentials {
  type: 'oauth_client_credentials';
  token_url: string;
  client_id_env: string;
  client_secret_env: string;
  scope?: string;
  audience?: string;
  token_params?: Record<string, string>;
}

export interface ServerAuthOauthAuthorizationCode {
  type: 'oauth_authorization_code';
  mode?: 'pre_registered' | 'dcr';
  client_id?: string;
  client_secret?: string;
  redirect_url?: string;
  scope?: string;
  // Advanced: manual endpoint overrides when .well-known discovery fails
  authorization_url?: string;
  token_url?: string;
}

export type ServerAuth =
  | ServerAuthBearer
  | ServerAuthApiKey
  | ServerAuthOauthClientCredentials
  | ServerAuthOauthAuthorizationCode;

export interface ServerConfig {
  name?: string;
  transport: TransportType;
  url: string;
  headers?: Record<string, string>;
  auth?: ServerAuth;
}

export interface ServerInlineEntry extends ServerConfig {
  id: string;
  name?: string;
}

export interface ServerRefEntry {
  ref: string;
}

export type ServerListEntry = ServerInlineEntry | ServerRefEntry;

export interface LlmAgentConfig {
  type?: 'llm';
  name?: string;
  provider: 'openai' | 'anthropic' | 'azure_openai' | 'azure_foundry';
  model: string;
  temperature?: number;
  max_tokens?: number;
  max_turns?: number;
  system?: string;
}

export interface AgentConnectionTestResult {
  ok: boolean;
  message: string;
  provider: LlmAgentConfig['provider'];
  requestedModel: string;
  model?: string;
  durationMs: number;
  failure?: AgentConnectionFailure;
}

export type AgentConnectionFailure =
  | 'missing_credentials'
  | 'authentication'
  | 'deployment'
  | 'capability'
  | 'rate_limit'
  | 'connection_error'
  | 'timeout';

export interface ProviderModelsResponse {
  provider: 'anthropic' | 'openai' | 'azure' | 'azure_foundry';
  items: string[];
  kind: 'models' | 'deployments';
  source: string;
}

export interface BrowserAgentConfig {
  type: 'browser';
  name?: string;
  provider: string;
  url: string;
  newConversationBetweenScenarios?: boolean;
}

export type RoverAgentProvider = string;

export interface RoverAgentRef {
  name: string;
  provider: RoverAgentProvider;
  url: string;
  providerRevision?: string;
}

export type AgentConfig = LlmAgentConfig | BrowserAgentConfig;

export type AgentInlineEntry = (LlmAgentConfig | BrowserAgentConfig) & {
  id: string;
  name?: string;
};

export interface AgentRefEntry {
  ref: string;
}

export type AgentListEntry = AgentInlineEntry | AgentRefEntry;

export function isLlmAgent(agent: AgentConfig): agent is LlmAgentConfig {
  return agent.type !== 'browser';
}

export interface ToolConstraints {
  required_tools?: string[];
  forbidden_tools?: string[];
}

export interface ResponseAssertionRegex {
  type: 'regex';
  pattern: string;
}

export interface ResponseAssertionContains {
  type: 'contains';
  value: string;
}

export interface ResponseAssertionNotContains {
  type: 'not_contains';
  value: string;
}

export interface ResponseAssertionStartsWith {
  type: 'starts_with';
  value: string;
}

export interface ResponseAssertionEndsWith {
  type: 'ends_with';
  value: string;
}

export interface ResponseAssertionEquals {
  type: 'equals';
  value: string;
}

export interface ResponseAssertionJsonPath {
  type: 'jsonpath';
  path: string;
  equals?: string | number | boolean;
}

export interface ResponseAssertionJsonPathExists {
  type: 'jsonpath_exists';
  path: string;
}

export interface ResponseAssertionJsonPathNotExists {
  type: 'jsonpath_not_exists';
  path: string;
}

export interface AgentAssertion {
  label: string;
  prompt: string;
}

export interface ToolInputAssertionBase {
  tool: string;
}

export interface ToolInputAssertionContains extends ToolInputAssertionBase {
  type: 'contains';
  value: string;
}

export interface ToolInputAssertionRegex extends ToolInputAssertionBase {
  type: 'regex';
  pattern: string;
}

export interface ToolInputAssertionJsonPath extends ToolInputAssertionBase {
  type: 'jsonpath';
  path: string;
  equals?: string | number | boolean;
}

export type ToolInputAssertion =
  | ToolInputAssertionContains
  | ToolInputAssertionRegex
  | ToolInputAssertionJsonPath;

// Must stay structurally identical to AgentContext in packages/app/src/types/eval.ts
export interface AgentContext {
  include_prompt?: boolean;
  include_tool_sequence?: boolean;
  include_tool_inputs?: boolean;
}

export interface AgentJudgeContext {
  scenario_prompt?: string;
  tool_sequence?: string[];
  tool_inputs?: Array<{ tool: string; arguments: unknown }>;
}

export type ResponseAssertion =
  | ResponseAssertionRegex
  | ResponseAssertionContains
  | ResponseAssertionNotContains
  | ResponseAssertionStartsWith
  | ResponseAssertionEndsWith
  | ResponseAssertionEquals
  | ResponseAssertionJsonPath
  | ResponseAssertionJsonPathExists
  | ResponseAssertionJsonPathNotExists;

export interface EvalRules {
  tool_constraints?: ToolConstraints;
  tool_sequence?: string[];
  tool_input_assertions?: ToolInputAssertion[];
  response_assertions?: ResponseAssertion[];
  agent_assertions?: AgentAssertion[];
  agent_context?: AgentContext;
}

export type CheckResultStatus =
  | 'passed'
  | 'failed'
  | 'not_evaluated'
  | 'not_executed'
  /** @deprecated Persisted results used this name for capability-limited checks. */
  | 'not_applicable';

export interface CheckResult {
  type: string;
  label: string;
  status: CheckResultStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckCounts {
  passed: number;
  failed: number;
  /** Checks intentionally outside the execution source's capabilities. */
  not_evaluated: number;
  /** Checks expected to run but skipped because execution ended early. */
  not_executed?: number;
  /** Legacy field retained when reading older result summaries. */
  not_applicable?: number;
  total: number;
}

export interface ExtractRule {
  name: string;
  from: 'final_text';
  regex: string;
}

export interface ScenarioAttachment {
  type: 'image' | 'document';
  media_type: string;
  data: string;
  url?: string;
  name?: string;
}

export interface SourceScenarioAttachment extends Omit<ScenarioAttachment, 'media_type' | 'data'> {
  media_type?: string;
  data?: string;
  path?: string;
}

export interface Scenario {
  id: string;
  name?: string;
  mcp_servers?: ServerListEntry[]; // source field: scenario-owned server definitions
  servers: string[]; // runtime IDs (computed by resolveReferences)
  prompt: string;
  attachments?: ScenarioAttachment[];
  eval?: EvalRules;
  extract?: ExtractRule[];
}

export interface ScenarioRefEntry {
  ref: string;
  mcp_servers?: ServerListEntry[];
}

export interface SourceScenario extends Omit<Scenario, 'servers' | 'attachments'> {
  servers?: string[];
  attachments?: SourceScenarioAttachment[];
}

export type ScenarioListEntry = SourceScenario | ScenarioRefEntry;

export interface EvalConfig {
  name?: string;
  description?: string;
  servers: Record<string, ServerConfig>;
  agents: Record<string, AgentConfig>;
  scenarios: Scenario[];
  run_defaults?: {
    selected_agents?: string[];
  };
}

export interface SourceEvalConfig extends Omit<EvalConfig, 'scenarios' | 'agents' | 'servers'> {
  servers?: ServerListEntry[]; // optional: legacy only, will be deprecated
  agents: AgentListEntry[];
  scenarios: ScenarioListEntry[];
}

export interface ExecutableScenario extends Scenario {
  agent: string;
  scenario_exec_id?: string;
}

export interface ExecutableEvalConfig extends Omit<EvalConfig, 'scenarios'> {
  scenarios: ExecutableScenario[];
}

export interface ToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown> | unknown;
  server?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: ScenarioAttachment[];
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface LlmResponse {
  content?: string;
  tool_calls?: ToolCall[];
  raw?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface TraceMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface EstimatedTokens {
  input: number;
  output: number;
  total: number;
  method: 'js_tiktoken_estimate' | 'js_tiktoken_fallback';
}

export type TraceMessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; media_type: string; data: string; name?: string }
  | { type: 'document'; media_type: string; data: string; name?: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      server: string;
      estimated_tokens?: EstimatedTokens;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      name: string;
      content: Array<{ type: 'text'; text: string }>;
      is_error: boolean;
      duration_ms?: number;
      ts_start?: string;
      ts_end?: string;
      server?: string;
      estimated_tokens?: EstimatedTokens;
    };

export interface TraceMessage {
  role: 'user' | 'assistant' | 'tool';
  ts?: string;
  usage?: TraceMessageUsage;
  content: TraceMessageContentBlock[];
}

export interface ScenarioRunTraceRecord {
  type: 'scenario_run';
  trace_version: 3;
  run_index: number;
  request_id?: string;
  scenario_id: string;
  agent: string;
  provider: string;
  model: string;
  ts_start: string;
  ts_end: string;
  pass: boolean;
  outcome?: RunOutcome;
  error?: string;
  messages: TraceMessage[];
  metrics?: {
    tool_call_count: number;
    total_tool_duration_ms: number;
  };
}

export type RunOutcome = 'passed' | 'failed' | 'incomplete' | 'error' | 'stopped';

export type ExecutionSource = 'mcplab' | 'rover';

export interface TraceFileLegacyMeta {
  type: 'trace_meta';
  trace_version: number;
  run_id: string;
  ts: string;
}

export type PersistedTraceRecord =
  | ScenarioRunTraceRecord
  | TraceFileLegacyMeta
  | Record<string, unknown>;

export interface ScenarioRunResult {
  run_index: number;
  request_id?: string;
  pass: boolean;
  outcome?: RunOutcome;
  error?: string;
  stop_reason?: string;
  failures: string[];
  check_results?: CheckResult[];
  tool_calls: string[];
  tool_call_count: number;
  tool_sequence: string[];
  tool_usage: Record<string, number>;
  tool_durations_ms: number[];
  run_duration_ms?: number;
  final_text: string;
  extracted: Record<string, string | number | boolean | null>;
}

export interface ScenarioAggregate {
  scenario_id: string;
  scenario_name?: string;
  agent: string;
  provider?: string;
  model?: string;
  eval?: EvalRules;
  tool_constraints_stats?: {
    required: Record<string, number>;
    forbidden: Record<string, number>;
  };
  runs: ScenarioRunResult[];
  pass_rate: number | null;
  distinct_sequences: Record<string, number>;
  tool_usage_frequency: Record<string, number>;
  extracted_values: Record<string, Record<string, number>>;
  last_final_answer: string;
}

export type HealthMcpConnectionInfo =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      transport: 'streamable-http';
      host: string;
      port: number;
      path: string;
      proxyUrl: string;
      directUrl: string;
      serverPackageVersion: string;
      environment: {
        MCP_HOST: string;
        MCP_PORT: string;
        MCP_PATH: string;
      };
    };

export interface ResultsJson {
  metadata: {
    run_id: string;
    timestamp: string;
    run_note?: string;
    git_commit?: string;
    config_hash: string;
    langsmith_trace_urls?: Record<string, string>;
    config_path?: string;
    config_name?: string;
    rerun_agents?: string[];
    rerun_scenario_ids?: string[];
    rerun_server_override_all?: string[];
    rerun_scenario_server_overrides?: Record<string, string[]>;
    rerun_new_conversation_before_start?: boolean;
    rerun_new_conversation_between_scenarios?: boolean;
    tool_tokens_total?: number | null;
    total_duration_ms?: number;
    total_tool_duration_ms?: number;
    cli_version: string;
    mcp_server_versions: Record<string, string | null>;
    execution_source?: ExecutionSource;
    execution_client?: string;
    /** @deprecated Read legacy results only. New evaluations use evaluation_run_id. */
    evaluation_group_id?: string;
    evaluation_run_id?: string;
    /** @deprecated Read legacy parent-result projections only. */
    child_run_ids?: string[];
    execution_status?: 'stopped';
  };
  summary: {
    total_scenarios: number;
    total_runs: number;
    pass_rate: number | null;
    avg_tool_calls_per_run: number;
    avg_tool_latency_ms: number | null;
    outcomes?: Partial<Record<RunOutcome, number>>;
  };
  scenarios: ScenarioAggregate[];
}
