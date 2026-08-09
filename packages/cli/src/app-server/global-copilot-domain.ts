import { readLibraries } from './libraries-store.js';
import { isResultAssistantAutoApprovedTool } from './result-assistant-tools.js';

export const GLOBAL_COPILOT_NAVIGATION_TARGETS = [
  '/',
  '/mcp-evaluations',
  '/run',
  '/results',
  '/compare',
  '/tool-analysis',
  '/tool-analysis-results',
  '/oauth-debugger',
  '/libraries/servers',
  '/libraries/agents',
  '/libraries/test-cases',
  '/settings'
] as const;

export const GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE = 5;
const GLOBAL_COPILOT_AUTOMATIC_MCP_TOOLS = new Set([
  'mcplab_validate_config',
  'mcplab_list_evaluation_configs',
  'mcplab_generate_scenario_entry',
  'mcplab_generate_agent_entry',
  'mcplab_generate_server_entry'
]);
const GLOBAL_COPILOT_CONFIRMED_MCP_TOOLS = new Set([
  'mcplab_write_markdown_report',
  'mcplab_create_evaluation_config'
]);

export function globalCopilotMcplabToolPolicy(
  name: string,
  options: { scenarioEditor?: boolean } = {}
): {
  expose: boolean;
  automatic: boolean;
} {
  if (isResultAssistantAutoApprovedTool(name) || GLOBAL_COPILOT_AUTOMATIC_MCP_TOOLS.has(name)) {
    return { expose: true, automatic: true };
  }
  if (name === 'mcplab_create_test_case') {
    return options.scenarioEditor
      ? { expose: false, automatic: false }
      : { expose: true, automatic: false };
  }
  if (GLOBAL_COPILOT_CONFIRMED_MCP_TOOLS.has(name)) return { expose: true, automatic: false };
  return { expose: false, automatic: false };
}

export function selectGlobalCopilotAgentName(params: {
  globalCopilotAgentName?: string;
  scenarioAssistantAgentName?: string;
  agentNames: string[];
}): string | undefined {
  const candidates = [params.globalCopilotAgentName, params.scenarioAssistantAgentName];
  return (
    candidates.find((name) => name && params.agentNames.includes(name)) ?? params.agentNames[0]
  );
}

export function globalCopilotSystemPrompt(context: unknown): string {
  return [
    'You are the MCPLab Global Copilot.',
    'Help users analyze evaluation results and author or improve MCP test cases.',
    'You can navigate the MCPLab interface using available frontend actions.',
    'The Current application context is authoritative page state supplied by the app. When it names a currentView or page filters, answer directly from that context; do not say you cannot see the screen.',
    'Only navigate when the user explicitly asks to go, navigate, open, take them, switch to a view, or to show the Test Cases, MCP Servers, Agents, Tool Analysis, or OAuth Debugger view. Before calling open_test_case, always call mcplab_get_library_item with kind "test_cases" and the exact ID; never open a generated draft that has not been saved. Use open_result_detail with a run ID when the user explicitly asks to open one specific result; otherwise use navigate_to_view for supported views. For “open the last/latest evaluation run”, first call mcplab_list_runs to identify the run ID, then call open_result_detail. Do not use mcplab_build_app_link. For analysis questions, use MCP tools to answer instead of navigating.',
    'When the current context contains resultsFilter, call mcplab_list_runs with its ISO bounds before analyzing the current Results view.',
    'When the current context identifies the MCP Evaluations view and the user asks which evaluations are shown, call mcplab_list_evaluation_configs using its suiteFilter (without the suite: prefix), searchQuery, sortBy, and sortDirection before answering.',
    'When scenarioEditor context is present, act as a Scenario Authoring Assistant. Use the current prompt, Checks, Value Capture Rules, server IDs, and available agent IDs as authoritative. Use exact evalRules shapes: required_tool/forbidden_tool use {type,value}, tool_sequence uses {type,sequence:string[]}, response_contains/response_regex and other text assertions use {type,value}, JSONPath assertions use {type,path,equals?}, and agent_check uses {type,label,prompt}. Use MCP tools to inspect live behavior when useful, and propose structured edits through propose_scenario_changes so the user can selectively apply Prompt, Checks, and Value Capture Rules; do not call apply_scenario_patch directly after analysis unless the user explicitly asks for an immediate complete replacement. For requests to "Run prompt", "preview", "test this scenario", or perform a one-shot run, use the confirmation-required preview_scenario frontend action with a valid agent ID from the provided agents list; do not require an evaluation config and do not use queue_evaluation_by_config for these requests. Only apply edits through the confirmation-required apply_scenario_patch frontend action, preserving the scenarioId and changing only the requested fields.',
    'For an explicit request to run an evaluation, use queue_evaluation_by_config with the exact configId and optional agentIds, scenarioIds, runsPerScenario, serverOverrideAll, scenarioServerOverrides, and runNote. It is confirmation-required and uses the existing app OAuth preflight and queue lifecycle; use queue_evaluation_run only for the page-selected Run Evaluation state. Do not use mcplab_run_eval: that MCP tool is reserved for external MCP clients.',
    'When editing a scenario, create or modify scenarios through the reviewed frontend suggestion flow and do not call mcplab_create_test_case. On other pages, when the user asks to create a Test Case, draft it with mcplab_generate_scenario_entry and use the confirmation-required mcplab_create_test_case MCP tool with the complete validated payload. When the user asks to create an evaluation configuration, use mcplab_create_evaluation_config with a complete config object; it is confirmation-required and writes only to mcplab/evals/.',
    'Never claim that a write, evaluation run, or tool analysis job happened until its confirmed action succeeds.',
    'Use concise, practical answers.',
    `Current application context: ${JSON.stringify(context ?? {})}`
  ].join('\n');
}

export function localMcplabMcpUrl(): string {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = process.env.MCP_PORT || '3011';
  return `http://${host}:${port}${process.env.MCP_PATH || '/mcp'}`;
}

export function globalCopilotExternalServers(
  libraries: ReturnType<typeof readLibraries>,
  activeTestCaseId: string | undefined,
  scenarioEditor?: {
    scenarios?: Array<{ serverIds?: string[]; mcp_servers?: unknown[]; servers?: unknown[] }>;
  }
): Record<
  string,
  { transport: 'http'; url: string; headers?: Record<string, string>; auth?: unknown }
> {
  const scenario = activeTestCaseId
    ? (libraries.scenarios.find((item: any) => item.id === activeTestCaseId) as any)
    : undefined;
  const editorEntries = (scenarioEditor?.scenarios ?? []).flatMap((item) =>
    item.mcp_servers ?? item.servers ?? item.serverIds?.map((ref) => ({ ref })) ?? []
  );
  const entries = [
    ...(scenario
      ? scenario.mcp_servers ?? (scenario.servers ?? []).map((ref: string) => ({ ref }))
      : []),
    ...editorEntries
  ];
  return entries.reduce((servers: Record<string, any>, entry: any) => {
    if (entry?.ref && libraries.servers[entry.ref])
      servers[entry.ref] = libraries.servers[entry.ref];
    else if (entry?.id && entry.transport === 'http' && entry.url) {
      const { id, ...config } = entry;
      servers[id] = config;
    }
    return servers;
  }, {});
}

export function globalCopilotMcpToolErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !(result as { isError?: unknown }).isError) {
    return undefined;
  }
  const text = (result as { content?: unknown }).content;
  if (!Array.isArray(text)) return 'The MCP tool reported an error.';
  const messages = text
    .filter(
      (item): item is { type: 'text'; text: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string'
    )
    .map((item) => item.text.trim())
    .filter(Boolean);
  return messages.join('\n') || 'The MCP tool reported an error.';
}

/** Prefer the server's structured MCP payload so metadata is not hidden in the protocol envelope. */
export function globalCopilotMcpToolPayload(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
  return structuredContent === undefined ? result : structuredContent;
}
