// Core mcp-lab types
import type { ScenarioAttachment } from '@/lib/data-sources/types';

export type { ScenarioAttachment } from '@/lib/data-sources/types';

export interface ServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  url?: string;
  command?: string;
  args?: string[];
  authType?: 'none' | 'bearer' | 'api-key' | 'oauth2';
  authValue?: string;
  // api-key fields
  apiKeyHeaderName?: string;
  // oauth2 (authorization code) fields
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUrl?: string;
  oauthScope?: string;
  oauthMode?: 'pre_registered' | 'dcr';
  oauthAuthorizationUrl?: string;
  oauthTokenEndpoint?: string;
  // oauth_client_credentials fields (used by libraries/YAML, not exposed in UI dropdown)
  oauthTokenUrl?: string;
  oauthClientIdEnv?: string;
  oauthClientSecretEnv?: string;
  oauthAudience?: string;
}

export type ServerEntry =
  | { kind: 'inline'; server: ServerConfig }
  | { kind: 'referenced'; ref: string };

export interface AgentConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'google' | 'custom';
  model: string;
  temperature?: number;
  maxTokens: number;
  maxTurns?: number;
  systemPrompt?: string;
}

export interface EvalRule {
  type:
    | 'required_tool'
    | 'forbidden_tool'
    | 'tool_sequence'
    | 'tool_input_contains'
    | 'tool_input_regex'
    | 'tool_input_jsonpath'
    | 'response_contains'
    | 'response_not_contains'
    | 'response_starts_with'
    | 'response_ends_with'
    | 'response_equals'
    | 'response_regex'
    | 'response_jsonpath'
    | 'response_jsonpath_exists'
    | 'response_jsonpath_not_exists'
    | 'agent_check';
  value?: string | number | boolean;
  sequence?: string[];
  path?: string;
  equals?: string | number | boolean;
  tool?: string;
  label?: string;
  prompt?: string;
}

export interface CheckResult {
  type: string;
  label: string;
  status: 'passed' | 'failed' | 'not_evaluated';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractRule {
  name: string;
  pattern: string;
}

// Must stay structurally identical to AgentContext in @inspectr/mcplab-core/types
export interface AgentContext {
  include_prompt?: boolean;
  include_tool_sequence?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  mcpServers?: ServerEntry[]; // scenario-owned server definitions (new model)
  serverIds: string[]; // runtime resolved IDs (computed)
  prompt: string;
  attachments?: ScenarioAttachment[];
  evalRules: EvalRule[];
  extractRules: ExtractRule[];
  agentContext?: AgentContext;
}

export type ScenarioEntry =
  | { kind: 'inline'; scenario: Scenario }
  | { kind: 'referenced'; ref: string; mcpServers?: ServerEntry[] };

export type AgentEntry =
  | { kind: 'inline'; agent: AgentConfig }
  | { kind: 'referenced'; ref: string };

export interface EvalConfig {
  id: string;
  name: string;
  configName?: string;
  description?: string;
  sourcePath?: string;
  configHash?: string;
  relativePath?: string;
  suitePath?: string;
  loadError?: string;
  loadWarnings?: string[];
  servers?: ServerConfig[]; // deprecated: computed union from scenario mcpServers
  serverEntries?: ServerEntry[]; // deprecated: top-level server pool entries
  agents: AgentConfig[];
  agentEntries?: AgentEntry[];
  scenarios: Scenario[];
  scenarioEntries?: ScenarioEntry[];
  runDefaults?: {
    selectedAgentNames?: string[];
  };
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
  estimatedTokens?: TokenUsage;
  estimatedTokenMethod?: 'js_tiktoken_estimate' | 'js_tiktoken_fallback';
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface ScenarioRun {
  runIndex: number;
  passed: boolean;
  error?: string;
  toolCalls: ToolCall[];
  assistantTokenUsage?: TokenUsage | null;
  toolTokenUsage?: TokenUsage | null;
  toolTokenUsageByTool?: Record<string, TokenUsage>;
  finalAnswer: string;
  conversation: ConversationItem[];
  duration: number;
  extractedValues: Record<string, string>;
  failureReasons: string[];
  checkResults?: CheckResult[];
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  agentId: string;
  agentName: string;
  provider?: string;
  model?: string;
  runs: ScenarioRun[];
  passRate: number;
  avgToolCalls: number;
  avgDuration: number;
  assistantTokenUsage?: TokenUsage | null;
  toolTokenUsage?: TokenUsage | null;
  toolTokenUsageByTool?: Record<string, TokenUsage>;
}

export interface EvalResult {
  id: string;
  configId: string;
  configHash: string;
  configPath?: string;
  configName?: string;
  langsmithTraceUrls?: Record<string, string>;
  // Exact resolved agent set used by the original run; reruns should reuse this verbatim.
  rerunAgents?: string[];
  rerunScenarioIds?: string[];
  rerunServerOverrideAll?: string[];
  rerunScenarioServerOverrides?: Record<string, string[]>;
  timestamp: string;
  runNote?: string;
  mcpServerVersions: Record<string, string | null>;
  scenarios: ScenarioResult[];
  assistantTokenUsage?: TokenUsage | null;
  toolTokenUsage?: TokenUsage | null;
  overallPassRate: number;
  totalScenarios: number;
  totalRuns: number;
  avgToolCalls: number;
  avgLatency: number;
  totalDurationMs?: number;
  totalToolDurationMs?: number;
  checkCounts?: {
    passed: number;
    failed: number;
    not_evaluated: number;
    total: number;
  };
}

// App state

export interface AppState {
  configs: EvalConfig[];
  results: EvalResult[];
}
