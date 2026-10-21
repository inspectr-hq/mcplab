export const NO_EVALUATION_AGENTS_MESSAGE =
  'No evaluation agents selected. Configure evaluation agents, select agents for this run, or set a default evaluation agent in workspace settings.';

/** Select names before merging library agents into the evaluation's runtime pool. */
export function resolveRunAgentNames(params: {
  configuredAgentNames: string[];
  selectedAgentNames?: string[];
  requestedAgentNames?: string[];
  defaultEvaluationAgentName?: string;
}): string[] {
  if (params.requestedAgentNames?.length) return [...params.requestedAgentNames];
  if (params.selectedAgentNames?.length) return [...params.selectedAgentNames];
  if (params.configuredAgentNames.length) return [...params.configuredAgentNames];
  return params.defaultEvaluationAgentName ? [params.defaultEvaluationAgentName] : [];
}
