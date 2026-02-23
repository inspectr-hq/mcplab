export type TransportType = 'http';

export interface ServerAuthBearer {
  type: 'bearer';
  env: string;
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
  client_id: string;
  client_secret?: string;
  redirect_url: string;
  scope?: string;
}

export type ServerAuth =
  | ServerAuthBearer
  | ServerAuthOauthClientCredentials
  | ServerAuthOauthAuthorizationCode;

export interface ServerConfig {
  transport: TransportType;
  url: string;
  auth?: ServerAuth;
}

export interface AgentConfig {
  provider: 'openai' | 'anthropic' | 'azure_openai';
  model: string;
  temperature?: number;
  max_tokens?: number;
  system?: string;
}

export interface ToolConstraints {
  required_tools?: string[];
  forbidden_tools?: string[];
}

export interface ToolSequenceRules {
  allow?: string[][];
}

export interface ResponseAssertionRegex {
  type: 'regex';
  pattern: string;
}

export interface ResponseAssertionJsonPath {
  type: 'jsonpath';
  path: string;
  equals?: string | number | boolean;
}

export type ResponseAssertion = ResponseAssertionRegex | ResponseAssertionJsonPath;

export interface EvalRules {
  tool_constraints?: ToolConstraints;
  tool_sequence?: ToolSequenceRules;
  response_assertions?: ResponseAssertion[];
}

export interface ExtractRule {
  name: string;
  from: 'final_text';
  regex: string;
}

export interface Scenario {
  id: string;
  name?: string;
  servers: string[];
  prompt: string;
  snapshot_eval?: {
    enabled?: boolean;
    baseline_snapshot_id?: string;
    baseline_source_run_id?: string;
    last_updated_at?: string;
  };
  eval?: EvalRules;
  extract?: ExtractRule[];
}

export interface SnapshotEvalPolicy {
  enabled: boolean;
  mode: 'warn' | 'fail_on_drift';
  baseline_snapshot_id?: string;
  baseline_source_run_id?: string;
  last_updated_at?: string;
}

export interface EvalConfig {
  servers: Record<string, ServerConfig>;
  server_refs?: string[];
  agents: Record<string, AgentConfig>;
  agent_refs?: string[];
  scenarios: Scenario[];
  scenario_refs?: string[];
  run_defaults?: {
    selected_agents?: string[];
  };
  snapshot_eval?: SnapshotEvalPolicy;
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
  description?: string;
  inputSchema?: unknown;
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
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface LlmResponse {
  content?: string;
  tool_calls?: ToolCall[];
  raw?: unknown;
}

export interface TraceRunStarted {
  type: 'run_started';
  run_id: string;
  ts: string;
  config_hash: string;
}

export interface TraceScenarioStarted {
  type: 'scenario_started';
  scenario_id: string;
  agent: string;
  ts: string;
}

export interface TraceLlmRequest {
  type: 'llm_request';
  messages_summary: string;
  ts: string;
}

export interface TraceLlmResponse {
  type: 'llm_response';
  raw_or_summary: string;
  ts: string;
}

export interface TraceToolCall {
  type: 'tool_call';
  server: string;
  tool: string;
  args: unknown;
  ts_start: string;
}

export interface TraceToolResult {
  type: 'tool_result';
  server: string;
  tool: string;
  ok: boolean;
  result_summary: string;
  ts_end: string;
  duration_ms: number;
}

export interface TraceFinalAnswer {
  type: 'final_answer';
  text: string;
  ts: string;
}

export interface TraceScenarioFinished {
  type: 'scenario_finished';
  scenario_id: string;
  pass: boolean;
  metrics: Record<string, unknown>;
  ts: string;
}

export type TraceEvent =
  | TraceRunStarted
  | TraceScenarioStarted
  | TraceLlmRequest
  | TraceLlmResponse
  | TraceToolCall
  | TraceToolResult
  | TraceFinalAnswer
  | TraceScenarioFinished;

export interface ScenarioRunResult {
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

export interface ScenarioAggregate {
  scenario_id: string;
  agent: string;
  eval?: EvalRules;
  tool_constraints_stats?: {
    required: Record<string, number>;
    forbidden: Record<string, number>;
  };
  runs: ScenarioRunResult[];
  pass_rate: number;
  distinct_sequences: Record<string, number>;
  tool_usage_frequency: Record<string, number>;
  extracted_values: Record<string, Record<string, number>>;
  last_final_answer: string;
}

export interface ResultsJson {
  metadata: {
    run_id: string;
    timestamp: string;
    git_commit?: string;
    config_hash: string;
    cli_version: string;
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
  scenarios: ScenarioAggregate[];
}
