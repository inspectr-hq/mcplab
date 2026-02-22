import type { EvalConfig, EvalResult } from '@/types/eval';

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

export interface CoreServerConfig {
  transport: 'http';
  url: string;
  auth?: CoreServerAuthBearer | CoreServerAuthOauth;
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
  agent?: string;
  servers: string[];
  prompt: string;
  snapshot_eval_enabled?: boolean;
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
  agent: string;
  required_tools: string[];
  forbidden_tools: string[];
  allowed_sequences: string[][];
  baseline_tools: string[];
  extracted_values: Record<string, string | number | boolean | null>;
  final_answer_features: {
    normalized: string;
    token_set: string[];
  };
}

export interface SnapshotRecord {
  schema_version: 1;
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
  agent: string;
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

export interface EvalDataSource {
  listConfigs: () => Promise<EvalConfig[]>;
  createConfig: (config: EvalConfig) => Promise<EvalConfig>;
  updateConfig: (config: EvalConfig) => Promise<EvalConfig>;
  deleteConfig: (id: string) => Promise<void>;
  listResults: () => Promise<EvalResult[]>;
  getResult: (id: string) => Promise<EvalResult | undefined>;
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
  listProviderModels: (provider: 'anthropic' | 'openai' | 'azure') => Promise<ProviderModelsResponse>;
}
