// Core mcp-lab types

export interface ServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  url?: string;
  command?: string;
  args?: string[];
  authType?: 'none' | 'bearer' | 'api-key';
  authValue?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'google' | 'custom';
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}

export interface EvalRule {
  type: 'required_tool' | 'forbidden_tool' | 'response_contains' | 'response_not_contains';
  value: string;
}

export interface ExtractRule {
  name: string;
  pattern: string;
}

export interface Scenario {
  id: string;
  name: string;
  agentId?: string;
  serverIds: string[];
  prompt: string;
  snapshotEvalEnabled?: boolean;
  evalRules: EvalRule[];
  extractRules: ExtractRule[];
}

export interface SnapshotEvalPolicy {
  enabled: boolean;
  mode: 'warn' | 'fail_on_drift';
  baselineSnapshotId?: string;
  baselineSourceRunId?: string;
  lastUpdatedAt?: string;
}

export interface EvalConfig {
  id: string;
  name: string;
  description?: string;
  sourcePath?: string;
  servers: ServerConfig[];
  agents: AgentConfig[];
  scenarios: Scenario[];
  snapshotEval?: SnapshotEvalPolicy;
  createdAt: string;
  updatedAt: string;
}

// Results types

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  duration: number;
  timestamp: string;
}

export interface ConversationItem {
  id: string;
  kind: 'user_prompt' | 'assistant_thought' | 'tool_call' | 'tool_result' | 'assistant_final';
  text: string;
  toolName?: string;
  ok?: boolean;
  durationMs?: number;
  timestamp?: string;
}

export interface ScenarioRun {
  runIndex: number;
  passed: boolean;
  toolCalls: ToolCall[];
  finalAnswer: string;
  conversation: ConversationItem[];
  duration: number;
  extractedValues: Record<string, string>;
  failureReasons: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  agentId: string;
  agentName: string;
  runs: ScenarioRun[];
  passRate: number;
  avgToolCalls: number;
  avgDuration: number;
}

export interface EvalResult {
  id: string;
  configId: string;
  configHash: string;
  timestamp: string;
  scenarios: ScenarioResult[];
  overallPassRate: number;
  totalScenarios: number;
  totalRuns: number;
  avgToolCalls: number;
  avgLatency: number;
  snapshotEval?: {
    applied: boolean;
    mode: 'warn' | 'fail_on_drift';
    baselineSnapshotId: string;
    baselineSourceRunId?: string;
    overallScore: number;
    status: 'Match' | 'Warn' | 'Drift';
    impactedScenarios: string[];
  };
}

// App state

export interface AppState {
  configs: EvalConfig[];
  results: EvalResult[];
}
