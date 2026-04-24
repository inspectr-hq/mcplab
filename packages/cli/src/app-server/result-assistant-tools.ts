export type ResultAssistantToolRole =
  | 'search'
  | 'list'
  | 'read'
  | 'analysis'
  | 'catalog'
  | 'write';

export interface ResultAssistantToolCapability {
  name: string;
  role: ResultAssistantToolRole;
  readOnly: boolean;
  search: boolean;
}

export const RESULT_ASSISTANT_TOOL_CAPABILITIES: ResultAssistantToolCapability[] = [
  { name: 'mcplab_write_markdown_report', role: 'write', readOnly: false, search: false },
  { name: 'mcplab_list_markdown_reports', role: 'list', readOnly: true, search: false },
  { name: 'mcplab_search_markdown_reports', role: 'search', readOnly: true, search: true },
  { name: 'mcplab_read_markdown_report', role: 'read', readOnly: true, search: false },
  { name: 'mcplab_list_runs', role: 'list', readOnly: true, search: false },
  { name: 'mcplab_search_runs', role: 'search', readOnly: true, search: true },
  { name: 'mcplab_aggregate_runs', role: 'analysis', readOnly: true, search: false },
  { name: 'mcplab_compare_runs', role: 'analysis', readOnly: true, search: false },
  { name: 'mcplab_compare_answer_quality', role: 'analysis', readOnly: true, search: false },
  { name: 'mcplab_read_run_artifact', role: 'read', readOnly: true, search: false },
  { name: 'mcplab_grep_run_artifact', role: 'search', readOnly: true, search: true },
  { name: 'mcplab_trace_stats', role: 'analysis', readOnly: true, search: false },
  { name: 'mcplab_trace_get_final_answers', role: 'read', readOnly: true, search: false },
  { name: 'mcplab_trace_get_conversation', role: 'read', readOnly: true, search: false },
  { name: 'mcplab_trace_list_events', role: 'list', readOnly: true, search: false },
  { name: 'mcplab_trace_search', role: 'search', readOnly: true, search: true },
  { name: 'mcplab_list_tool_analysis_results', role: 'list', readOnly: true, search: false },
  {
    name: 'mcplab_search_tool_analysis_results',
    role: 'search',
    readOnly: true,
    search: true
  },
  { name: 'mcplab_read_tool_analysis_result', role: 'read', readOnly: true, search: false },
  { name: 'mcplab_list_library', role: 'catalog', readOnly: true, search: false },
  { name: 'mcplab_get_library_item', role: 'read', readOnly: true, search: false }
];

const CAPABILITY_BY_NAME = new Map(
  RESULT_ASSISTANT_TOOL_CAPABILITIES.map((capability) => [capability.name, capability])
);

export function isResultAssistantAllowedTool(name: string): boolean {
  return CAPABILITY_BY_NAME.has(name);
}

export function isResultAssistantAutoApprovedTool(name: string): boolean {
  return CAPABILITY_BY_NAME.get(name)?.readOnly === true;
}

