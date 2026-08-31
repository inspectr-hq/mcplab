import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type {
  AgentAssertion,
  AgentConfig,
  AgentJudgeContext,
  ExecutableEvalConfig,
  ScenarioRunResult,
  ResultsJson,
  ExecutableScenario,
  ScenarioRunTraceRecord
} from './types.js';
import { isAbortError, throwIfAborted } from './abort.js';
import { TraceWriter } from './trace.js';
import { McpClientManager } from './mcp.js';
import {
  buildBatchJudgeResponseFormat,
  chatWithAgent,
  runAgentScenario,
  type AgentRunProgressEvent
} from './agent.js';
import {
  buildNotEvaluatedCheckResults,
  evaluateScenarioWithAgentChecks,
  extractValues,
  normalizeToolConstraintAliases
} from './eval.js';
import { aggregateResults, renderSummaryMarkdown } from './results.js';
import { enrichTraceMessagesWithEstimatedTokens } from './trace-token-estimates.js';
import {
  createLangSmithTraceExporter,
  toLangSmithMessages,
  type TraceExporter
} from './langsmith-tracing.js';

export interface RunOptions {
  runsPerScenario: number;
  scenarioId?: string;
  runNote?: string;
  configHash: string;
  gitCommit?: string;
  cliVersion: string;
  runsDir?: string;
  cwd?: string;
  mcpServerAuthHeaders?: Record<string, Record<string, string>>;
  oauthTokens?: Record<string, string>;
  resolveMcpServerAuthHeaders?: (
    serverNames: string[],
    options?: { signal?: AbortSignal }
  ) => Promise<Record<string, Record<string, string>>>;
  evaluationJudge?: {
    name: string;
    agent: AgentConfig;
  };
  signal?: AbortSignal;
  onProgress?: (event: RunProgressEvent) => void | Promise<void>;
  traceExporter?: TraceExporter;
}

export type RunProgressEvent =
  | {
      type: 'run_started';
      runId: string;
      totalScenarioRuns: number;
      runsPerScenario: number;
    }
  | { type: 'mcp_connect_started'; serverCount: number; serverNames: string[] }
  | { type: 'mcp_connect_finished'; serverCount: number; serverNames: string[] }
  | {
      type: 'scenario_run_started';
      scenarioId: string;
      agentName: string;
      scenarioRunIndex: number;
      totalScenarioRuns: number;
      runIndex: number;
      runsPerScenario: number;
    }
  | {
      type: 'scenario_run_finished';
      scenarioId: string;
      agentName: string;
      scenarioRunIndex: number;
      totalScenarioRuns: number;
      runIndex: number;
      runsPerScenario: number;
      pass: boolean;
      toolCallCount: number;
    }
  | {
      type: 'agent_progress';
      scenarioRunIndex: number;
      totalScenarioRuns: number;
      event: AgentRunProgressEvent;
    }
  | { type: 'run_finished'; runId: string; totalScenarioRuns: number };

export function buildMcpServerAuthHeaders(
  options: Pick<RunOptions, 'mcpServerAuthHeaders' | 'oauthTokens'>
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = { ...options.mcpServerAuthHeaders };
  if (options.oauthTokens) {
    for (const [serverName, token] of Object.entries(options.oauthTokens)) {
      out[serverName] = { ...out[serverName], authorization: `Bearer ${token}` };
    }
  }
  return out;
}

export async function runAll(
  config: ExecutableEvalConfig,
  options: RunOptions
): Promise<{ runDir: string; results: ResultsJson }> {
  throwIfAborted(options.signal);
  const scenariosToRun = filterScenariosForRun(config.scenarios, options.scenarioId);
  const scenariosWithAgentChecks = scenariosToRun.filter(
    (scenario) => (scenario.eval?.agent_assertions?.length ?? 0) > 0
  );
  if (scenariosWithAgentChecks.length > 0 && !options.evaluationJudge) {
    throw new Error(
      `Agent checks require a default evaluation judge agent. Configure one in workspace settings before running scenarios: ${scenariosWithAgentChecks
        .map((scenario) => scenario.id)
        .join(', ')}`
    );
  }
  const emitProgress = async (event: RunProgressEvent): Promise<void> => {
    if (!options.onProgress) return;
    await options.onProgress(event);
  };
  const runId = createRunId();
  const runRoot = options.runsDir?.trim() || 'runs';
  const baseCwd = options.cwd?.trim() || process.cwd();
  const runsBaseDir = isAbsolute(runRoot) ? runRoot : resolve(baseCwd, runRoot);
  const runDir = join(runsBaseDir, runId);
  mkdirSync(runDir, { recursive: true });

  const tracePath = join(runDir, 'trace.jsonl');
  const resolvedConfigPath = join(runDir, 'resolved-config.yaml');
  writeFileSync(resolvedConfigPath, `${stringifyYaml(config)}\n`, 'utf8');
  const trace = new TraceWriter(tracePath);
  const traceExporter = options.traceExporter ?? createLangSmithTraceExporter();
  let traceExporterFlushed = false;
  trace.write({
    type: 'trace_meta',
    trace_version: 3,
    run_id: runId,
    ts: new Date().toISOString()
  });
  const totalScenarioRuns = scenariosToRun.length * options.runsPerScenario;
  await emitProgress({
    type: 'run_started',
    runId,
    totalScenarioRuns,
    runsPerScenario: options.runsPerScenario
  });

  const mcp = new McpClientManager();
  try {
    const usedServerIds = Array.from(
      new Set(scenariosToRun.flatMap((scenario) => scenario.servers))
    );
    const usedServers = Object.fromEntries(
      usedServerIds.map((id) => {
        const server = config.servers[id];
        if (!server) {
          throw new Error(
            `Scenario references unknown MCP server '${id}'. Ensure override/config server refs exist in resolved config.servers.`
          );
        }
        return [id, server];
      })
    );
    await emitProgress({
      type: 'mcp_connect_started',
      serverCount: usedServerIds.length,
      serverNames: usedServerIds
    });
    await mcp.connectAll(usedServers, options.signal, {
      serverAuthHeaders: buildMcpServerAuthHeaders(options)
    });
    await emitProgress({
      type: 'mcp_connect_finished',
      serverCount: usedServerIds.length,
      serverNames: usedServerIds
    });
    const mcpServerVersions = mcp.getServerVersions();

    const scenarioRuns: Array<{
      scenario_id: string;
      scenario_name?: string;
      agent: string;
      provider?: string;
      model?: string;
      eval?: ExecutableScenario['eval'];
      runs: ScenarioRunResult[];
    }> = [];

    let scenarioRunIndex = 0;
    for (const scenario of scenariosToRun) {
      throwIfAborted(options.signal);
      if (!scenario.agent) {
        throw new Error(
          `Scenario '${scenario.id}' has no execution agent. Provide run agent selection or config run_defaults.selected_agents.`
        );
      }
      const agent = config.agents[scenario.agent];
      if (!agent) {
        throw new Error(`Agent not found: ${scenario.agent}`);
      }
      const runs: ScenarioRunResult[] = [];
      let effectiveScenarioEval = scenario.eval;

      for (let runIndex = 0; runIndex < options.runsPerScenario; runIndex += 1) {
        throwIfAborted(options.signal);
        let requestId: string;
        try {
          requestId = buildScenarioRequestId({
            runId,
            scenarioId: scenario.id,
            agentName: scenario.agent,
            scenarioExecId: scenario.scenario_exec_id,
            runIndex
          });
        } catch (err: any) {
          requestId = buildFallbackScenarioRequestId({
            runId,
            runIndex,
            scenarioAgent: scenario.agent
          });
          console.debug(
            `Failed to build scenario request ID for scenario '${scenario.id}': ${String(
              err?.message ?? err
            )}`
          );
        }
        scenarioRunIndex += 1;
        await emitProgress({
          type: 'scenario_run_started',
          scenarioId: scenario.id,
          agentName: scenario.agent,
          scenarioRunIndex,
          totalScenarioRuns,
          runIndex,
          runsPerScenario: options.runsPerScenario
        });
        const tsStart = new Date().toISOString();
        const scenarioTrace = traceExporter.startScenario({
          runId,
          requestId,
          scenarioId: scenario.id,
          agent: scenario.agent,
          provider: agent.provider,
          model: agent.model,
          configHash: options.configHash,
          gitCommit: options.gitCommit,
          cliVersion: options.cliVersion,
          messages: [{ role: 'user', content: scenario.prompt }]
        });
        try {
          const runResult = await runAgentScenario({
            scenario,
            agent,
            mcp,
            requestId,
            resolveServerRequestHeaders: (serverNames) =>
              options.resolveMcpServerAuthHeaders?.(serverNames, { signal: options.signal }) ??
              Promise.resolve({}),
            maxTurns: agent.max_turns,
            signal: options.signal,
            trace: scenarioTrace,
            onProgress: async (event) => {
              await emitProgress({
                type: 'agent_progress',
                scenarioRunIndex,
                totalScenarioRuns,
                event
              });
            }
          });
          const evalResult = await evaluateScenarioWithAgentChecks(
            runResult.finalText,
            runResult.toolSequence,
            (effectiveScenarioEval = normalizeToolConstraintAliases(
              scenario.eval,
              runResult.availableToolNames
            )),
            {
              toolCalls: runResult.toolCalls,
              availableToolNames: runResult.availableToolNames,
              scenarioPrompt: scenario.prompt,
              judgeAgentAssertions: options.evaluationJudge
                ? async (input) => {
                    return judgeAgentAssertions({
                      assertions: input.assertions,
                      context: input.context,
                      finalText: runResult.finalText,
                      judge: options.evaluationJudge!,
                      signal: options.signal
                    });
                  }
                : undefined
            }
          );
          const extracted = extractValues(
            runResult.finalText,
            scenario.extract?.map((rule) => ({ name: rule.name, regex: rule.regex })) ?? []
          );

          const toolUsage: Record<string, number> = {};
          for (const tool of runResult.toolSequence) {
            toolUsage[tool] = (toolUsage[tool] ?? 0) + 1;
          }

          const scenarioRun: ScenarioRunResult = {
            run_index: runIndex,
            request_id: requestId,
            pass: evalResult.pass,
            failures: evalResult.failures,
            check_results: evalResult.check_results,
            tool_calls: runResult.toolSequence,
            tool_call_count: runResult.toolSequence.length,
            tool_sequence: runResult.toolSequence,
            tool_usage: toolUsage,
            tool_durations_ms: runResult.toolDurationsMs,
            run_duration_ms: Math.max(
              0,
              Date.parse(runResult.traceEndedAt) - Date.parse(runResult.traceStartedAt)
            ),
            final_text: runResult.finalText,
            extracted
          };
          runs.push(scenarioRun);
          const traceRecord: ScenarioRunTraceRecord = {
            type: 'scenario_run',
            trace_version: 3,
            run_index: runIndex,
            request_id: requestId,
            scenario_id: scenario.id,
            agent: scenario.agent,
            provider: runResult.traceProvider,
            model: runResult.traceModel,
            ts_start: runResult.traceStartedAt,
            ts_end: runResult.traceEndedAt,
            pass: evalResult.pass,
            messages: enrichTraceMessagesWithEstimatedTokens(
              runResult.traceMessages,
              runResult.traceModel
            ),
            metrics: {
              tool_call_count: runResult.toolSequence.length,
              total_tool_duration_ms: runResult.toolDurationsMs.reduce((sum, ms) => sum + ms, 0)
            }
          };
          trace.write(traceRecord);
          await scenarioTrace.end({
            outputs: {
              finalText: runResult.finalText,
              pass: evalResult.pass,
              messages: toLangSmithMessages(runResult.traceMessages),
              metrics: traceRecord.metrics
            }
          });
          await emitProgress({
            type: 'scenario_run_finished',
            scenarioId: scenario.id,
            agentName: scenario.agent,
            scenarioRunIndex,
            totalScenarioRuns,
            runIndex,
            runsPerScenario: options.runsPerScenario,
            pass: evalResult.pass,
            toolCallCount: runResult.toolSequence.length
          });
        } catch (scenarioErr: any) {
          if (options.signal?.aborted || isAbortError(scenarioErr)) {
            await scenarioTrace.end({
              error: String(scenarioErr?.message ?? scenarioErr),
              outputs: { pass: false }
            });
            throw scenarioErr;
          }
          const errorMessage = scenarioErr?.message ?? String(scenarioErr);
          console.error(`Scenario '${scenario.id}' run ${runIndex} failed: ${errorMessage}`);
          const tsEnd = new Date().toISOString();
          const errorRun: ScenarioRunResult = {
            run_index: runIndex,
            request_id: requestId,
            pass: false,
            error: errorMessage,
            failures: [`Scenario error: ${errorMessage}`],
            check_results: buildNotEvaluatedCheckResults(scenario.eval),
            tool_calls: [],
            tool_call_count: 0,
            tool_sequence: [],
            tool_usage: {},
            tool_durations_ms: [],
            run_duration_ms: Math.max(0, Date.parse(tsEnd) - Date.parse(tsStart)),
            final_text: '',
            extracted: {}
          };
          runs.push(errorRun);
          const errorTrace: ScenarioRunTraceRecord = {
            type: 'scenario_run',
            trace_version: 3,
            run_index: runIndex,
            request_id: requestId,
            scenario_id: scenario.id,
            agent: scenario.agent,
            provider: agent.provider,
            model: agent.model,
            ts_start: tsStart,
            ts_end: tsEnd,
            pass: false,
            error: errorMessage,
            messages: []
          };
          trace.write(errorTrace);
          await scenarioTrace.end({ error: errorMessage, outputs: { pass: false } });
          await emitProgress({
            type: 'scenario_run_finished',
            scenarioId: scenario.id,
            agentName: scenario.agent,
            scenarioRunIndex,
            totalScenarioRuns,
            runIndex,
            runsPerScenario: options.runsPerScenario,
            pass: false,
            toolCallCount: 0
          });
        }
      }

      scenarioRuns.push({
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        agent: scenario.agent,
        provider: agent.provider,
        model: agent.model,
        eval: effectiveScenarioEval,
        runs
      });
    }

    const traceExport = await traceExporter.flush();
    traceExporterFlushed = true;
    const results = aggregateResults({
      runId,
      timestamp: new Date().toISOString(),
      runNote: options.runNote,
      gitCommit: options.gitCommit,
      configHash: options.configHash,
      cliVersion: options.cliVersion,
      langsmithTraceUrls: traceExport.traceUrls,
      mcpServerVersions,
      scenarioRuns
    });

    const resultsPath = join(runDir, 'results.json');
    writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

    const summaryPath = join(runDir, 'summary.md');
    writeFileSync(summaryPath, renderSummaryMarkdown(results), 'utf8');
    await emitProgress({ type: 'run_finished', runId, totalScenarioRuns });

    return { runDir, results };
  } finally {
    await mcp.disconnectAll();
    if (!traceExporterFlushed) await traceExporter.flush();
  }
}

export function buildJudgeBatchPayload(
  finalText: string,
  assertions: AgentAssertion[],
  context?: AgentJudgeContext
) {
  return {
    final_answer: finalText,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
    checks: assertions.map((assertion, index) => ({
      id: `agent-check-${index + 1}`,
      label: assertion.label,
      prompt: assertion.prompt
    }))
  };
}

type JudgeBatchPayload = ReturnType<typeof buildJudgeBatchPayload>;

export function mapJudgeBatchResults(params: {
  judgeName: string;
  judgeAgent: AgentConfig;
  batch: JudgeBatchPayload;
  raw: string;
}): Array<{ label: string; pass: boolean; reason: string; metadata?: Record<string, unknown> }> {
  let parsed: { results?: unknown };
  try {
    parsed = JSON.parse(extractJudgeJson(params.raw));
  } catch {
    throw new Error(`judge "${params.judgeName}" returned invalid JSON for batched agent checks`);
  }
  if (!Array.isArray(parsed.results)) {
    throw new Error(
      `judge "${params.judgeName}" returned invalid results array for batched agent checks`
    );
  }

  const resultsById = new Map<string, { id: string; pass: boolean; reason: string }>();
  for (const item of parsed.results) {
    if (!item || typeof item !== 'object') {
      throw new Error(
        `judge "${params.judgeName}" returned invalid result item for batched agent checks`
      );
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.pass !== 'boolean' ||
      typeof candidate.reason !== 'string'
    ) {
      throw new Error(
        `judge "${params.judgeName}" returned invalid result item for batched agent checks`
      );
    }
    if (!resultsById.has(candidate.id)) {
      resultsById.set(candidate.id, {
        id: candidate.id,
        pass: candidate.pass,
        reason: candidate.reason
      });
    }
  }

  return params.batch.checks.map((check) => {
    const matched = resultsById.get(check.id);
    if (!matched) {
      return {
        label: check.label,
        pass: false,
        reason: `Judge did not return a result for "${check.label}"`,
        metadata: buildJudgeCheckMetadata(params.judgeName, params.judgeAgent, check.id)
      };
    }

    const trimmedReason = matched.reason.trim();
    return {
      label: check.label,
      pass: matched.pass,
      reason:
        trimmedReason.length > 0
          ? trimmedReason
          : matched.pass
          ? `Agent check passed: ${check.label}`
          : `Agent check failed: ${check.label}`,
      metadata: buildJudgeCheckMetadata(params.judgeName, params.judgeAgent, check.id)
    };
  });
}

async function judgeAgentAssertions(params: {
  assertions: AgentAssertion[];
  finalText: string;
  context?: AgentJudgeContext;
  judge: NonNullable<RunOptions['evaluationJudge']>;
  signal?: AbortSignal;
}): Promise<
  Array<{ label: string; pass: boolean; reason: string; metadata?: Record<string, unknown> }>
> {
  const batch = buildJudgeBatchPayload(params.finalText, params.assertions, params.context);
  const system = [
    'You evaluate whether a final answer satisfies a set of semantic checks.',
    'Evaluate each check independently against final_answer.',
    'Use final_answer as the primary answer being judged.',
    'If context.scenario_prompt is provided, use it to decide whether the final answer addresses the original request.',
    'If context.tool_sequence is provided, use it only to understand which tools were called.',
    'If context.tool_inputs is provided, use the tool names and arguments to reason about how the tools were used.',
    'Do not require context fields that are not provided.',
    'Return JSON only.',
    'Schema: {"results":[{"id":"abc","pass":true,"reason":"text"}]}.',
    'Keep each reason short and concrete.'
  ].join(' ');
  const response = await chatWithAgent({
    agent: params.judge.agent,
    system,
    tools: [],
    signal: params.signal,
    responseFormat: buildBatchJudgeResponseFormat(),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(batch)
      }
    ]
  });
  return mapJudgeBatchResults({
    judgeName: params.judge.name,
    judgeAgent: params.judge.agent,
    batch,
    raw: String(response.content ?? '').trim()
  });
}

function buildJudgeCheckMetadata(judgeName: string, judgeAgent: AgentConfig, checkId: string) {
  return {
    check_id: checkId,
    judge_agent: judgeName,
    judge_model: judgeAgent.model,
    judge_provider: judgeAgent.provider
  };
}

export function extractJudgeJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();
  const objectStart = trimmed.indexOf('{');
  if (objectStart >= 0) {
    const objectEnd = findMatchingJsonObjectEnd(trimmed, objectStart);
    if (objectEnd > objectStart) {
      return trimmed.slice(objectStart, objectEnd + 1).trim();
    }
  }
  return trimmed;
}

function findMatchingJsonObjectEnd(text: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

export function filterScenariosForRun(
  scenarios: ExecutableScenario[],
  scenarioId?: string
): ExecutableScenario[] {
  if (!scenarioId) return scenarios;
  return scenarios.filter((scenario) => scenario.id === scenarioId);
}

let lastRunIdPrefix = '';
let lastRunIdCollisionCount = 0;

export function createRunId(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const prefix = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '-',
    String(now.getMilliseconds()).padStart(3, '0')
  ].join('');

  if (prefix !== lastRunIdPrefix) {
    lastRunIdPrefix = prefix;
    lastRunIdCollisionCount = 0;
    return prefix;
  }

  lastRunIdCollisionCount += 1;
  return `${prefix}-${lastRunIdCollisionCount.toString(36).padStart(2, '0')}`;
}

const MAX_REQUEST_ID_LENGTH = 180;

export function buildScenarioRequestId(params: {
  runId: string;
  scenarioId?: string;
  agentName?: string;
  scenarioExecId?: string;
  runIndex: number;
}): string {
  const runId = normalizeRequestIdPart(params.runId, 'unknown-run');
  const scenarioId = normalizeRequestIdPart(params.scenarioId, 'unknown');
  const agentSlug = slugifyAgentName(params.agentName ?? 'unknown-agent');
  const runSuffix = `run${Math.max(1, params.runIndex + 1)}`;
  const execBase = normalizeRequestIdPart(params.scenarioExecId, '');
  const execSuffix = execBase ? `${execBase}-${runSuffix}` : runSuffix;
  return clampRequestIdLength(`mcplab-run:${runId}:${scenarioId}:${agentSlug}:${execSuffix}`, {
    requiredSuffix: `:${agentSlug}:${execSuffix}`
  });
}

export function buildFallbackScenarioRequestId(params: {
  runId: string;
  runIndex: number;
  scenarioAgent?: string;
}): string {
  const runId = normalizeRequestIdPart(params.runId, 'unknown-run');
  const fallbackAgentSlug = slugifyAgentName(params.scenarioAgent ?? 'unknown-agent');
  const runSuffix = `run${Math.max(1, params.runIndex + 1)}`;
  return clampRequestIdLength(`mcplab-run:${runId}:unknown:${fallbackAgentSlug}:${runSuffix}`, {
    requiredSuffix: `:${runSuffix}`
  });
}

function normalizeRequestIdPart(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function clampRequestIdLength(
  value: string,
  options?: {
    requiredSuffix?: string;
  }
): string {
  if (value.length <= MAX_REQUEST_ID_LENGTH) return value;
  const requiredSuffix = options?.requiredSuffix;
  if (!requiredSuffix) {
    return value.slice(0, MAX_REQUEST_ID_LENGTH);
  }
  const normalizedSuffix =
    requiredSuffix.length > MAX_REQUEST_ID_LENGTH
      ? requiredSuffix.slice(requiredSuffix.length - MAX_REQUEST_ID_LENGTH)
      : requiredSuffix;
  const prefixLength = MAX_REQUEST_ID_LENGTH - normalizedSuffix.length;
  if (prefixLength <= 0) return normalizedSuffix;
  return `${value.slice(0, prefixLength)}${normalizedSuffix}`;
}

function slugifyAgentName(agentName: string): string {
  const normalized = agentName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  const compact = normalized.replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_');
  return compact || 'unknown-agent';
}
