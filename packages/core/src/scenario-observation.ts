import type {
  EvalRules,
  ExecutionSource,
  RunOutcome,
  Scenario,
  ScenarioRunResult,
  ToolCall
} from './types.js';
import {
  buildNotExecutedCheckResults,
  buildNotEvaluatedCheckResults,
  evaluateScenarioWithAgentChecks,
  extractValues,
  type EvaluateScenarioWithAgentChecksOptions
} from './eval.js';

export interface ScenarioObservation {
  finalText: string;
  toolCalls?: ToolCall[];
  toolDurationsMs?: number[];
  availableToolNames?: string[];
  startedAt: string;
  completedAt: string;
  requestId?: string;
  executionSource: ExecutionSource;
  client?: string;
}

export interface EvaluateScenarioObservationParams {
  scenario: Scenario;
  observation: ScenarioObservation;
  runIndex?: number;
  judgeAgentAssertions?: EvaluateScenarioWithAgentChecksOptions['judgeAgentAssertions'];
}

export function deriveRunOutcome(
  run: Pick<ScenarioRunResult, 'pass' | 'error' | 'check_results'>
): RunOutcome {
  if (run.error) return 'error';
  if (run.check_results?.some((check) => check.status === 'failed')) return 'failed';
  if (run.check_results?.some((check) => check.status === 'not_executed')) return 'incomplete';
  return run.pass ? 'passed' : 'failed';
}

function observedRules(
  rules: EvalRules | undefined,
  hasToolTelemetry: boolean
): EvalRules | undefined {
  if (!rules || hasToolTelemetry) return rules;
  return {
    response_assertions: rules.response_assertions,
    agent_assertions: rules.agent_assertions,
    agent_context: rules.agent_context
      ? { ...rules.agent_context, include_tool_sequence: false, include_tool_inputs: false }
      : undefined
  };
}

function unobservedToolRules(rules: EvalRules | undefined): EvalRules | undefined {
  if (!rules) return undefined;
  return {
    tool_constraints: rules.tool_constraints,
    tool_sequence: rules.tool_sequence,
    tool_input_assertions: rules.tool_input_assertions
  };
}

export async function evaluateScenarioObservation({
  scenario,
  observation,
  runIndex = 0,
  judgeAgentAssertions
}: EvaluateScenarioObservationParams): Promise<ScenarioRunResult> {
  const hasToolTelemetry = observation.toolCalls !== undefined;
  const toolCalls = observation.toolCalls ?? [];
  const toolSequence = toolCalls.map((call) => call.name);
  const evaluated = await evaluateScenarioWithAgentChecks(
    observation.finalText,
    toolSequence,
    observedRules(scenario.eval, hasToolTelemetry),
    {
      toolCalls,
      availableToolNames: observation.availableToolNames,
      scenarioPrompt: scenario.prompt,
      judgeAgentAssertions
    }
  );
  const unobservedChecks =
    observation.executionSource === 'rover'
      ? buildNotEvaluatedCheckResults(unobservedToolRules(scenario.eval))
      : buildNotExecutedCheckResults(unobservedToolRules(scenario.eval));
  const checkResults = [...evaluated.check_results, ...(hasToolTelemetry ? [] : unobservedChecks)];
  const outcome: RunOutcome = evaluated.failures.length
    ? 'failed'
    : checkResults.some((check) => check.status === 'not_executed')
      ? 'incomplete'
      : 'passed';
  const toolUsage: Record<string, number> = {};
  for (const tool of toolSequence) toolUsage[tool] = (toolUsage[tool] ?? 0) + 1;

  return {
    run_index: runIndex,
    request_id: observation.requestId,
    pass: outcome === 'passed',
    outcome,
    failures: evaluated.failures,
    check_results: checkResults,
    tool_calls: toolSequence,
    tool_call_count: toolSequence.length,
    tool_sequence: toolSequence,
    tool_usage: toolUsage,
    tool_durations_ms: observation.toolDurationsMs ?? [],
    run_duration_ms: Math.max(
      0,
      Date.parse(observation.completedAt) - Date.parse(observation.startedAt)
    ),
    final_text: observation.finalText,
    extracted: extractValues(
      observation.finalText,
      scenario.extract?.map((rule) => ({ name: rule.name, regex: rule.regex })) ?? []
    )
  };
}
