import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type {
  AgentAssertion,
  AgentConfig,
  ExecutableEvalConfig,
  ScenarioRunResult,
  ResultsJson,
  ExecutableScenario,
  ScenarioRunTraceRecord
} from './types.js';
import { TraceWriter } from './trace.js';
import { McpClientManager } from './mcp.js';
import { chatWithAgent, runAgentScenario, type AgentRunProgressEvent } from './agent.js';
import { evaluateScenarioWithAgentChecks, extractValues } from './eval.js';
import { aggregateResults, renderSummaryMarkdown } from './results.js';
import { enrichTraceMessagesWithEstimatedTokens } from './trace-token-estimates.js';

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
  const scenariosWithAgentChecks = config.scenarios.filter(
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
  trace.write({
    type: 'trace_meta',
    trace_version: 3,
    run_id: runId,
    ts: new Date().toISOString()
  });
  const totalScenarioRuns = config.scenarios.length * options.runsPerScenario;
  await emitProgress({
    type: 'run_started',
    runId,
    totalScenarioRuns,
    runsPerScenario: options.runsPerScenario
  });

  const mcp = new McpClientManager();
  try {
    const usedServerIds = Array.from(
      new Set(config.scenarios.flatMap((scenario) => scenario.servers))
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
    for (const scenario of config.scenarios) {
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
            scenario.eval,
            {
              judgeAgentAssertion: options.evaluationJudge
                ? async (assertion) => {
                    const judge = options.evaluationJudge!;
                    return judgeAgentAssertion({
                      assertion,
                      finalText: runResult.finalText,
                      judge,
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
          if (isAbortError(scenarioErr, options.signal)) {
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
            check_results:
              scenario.eval?.agent_assertions?.map((assertion) => ({
                type: 'agent_check',
                label: assertion.label,
                status: 'not_evaluated' as const
              })) ?? [],
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
        eval: scenario.eval,
        runs
      });
    }

    const results = aggregateResults({
      runId,
      timestamp: new Date().toISOString(),
      runNote: options.runNote,
      gitCommit: options.gitCommit,
      configHash: options.configHash,
      cliVersion: options.cliVersion,
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
  }
}

async function judgeAgentAssertion(params: {
  assertion: AgentAssertion;
  finalText: string;
  judge: NonNullable<RunOptions['evaluationJudge']>;
  signal?: AbortSignal;
}): Promise<{ pass: boolean; reason: string; metadata?: Record<string, unknown> }> {
  const system = [
    'You evaluate whether a final answer satisfies a semantic check.',
    'Return JSON only.',
    'Schema: {"pass": boolean, "reason": string}.',
    'Keep the reason short and concrete.'
  ].join(' ');
  const response = await chatWithAgent({
    agent: params.judge.agent,
    system,
    tools: [],
    signal: params.signal,
    forceJsonResponse: true,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          check_label: params.assertion.label,
          check_prompt: params.assertion.prompt,
          final_answer: params.finalText
        })
      }
    ]
  });
  const raw = String(response.content ?? '').trim();
  let parsed: { pass?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `judge "${params.judge.name}" returned invalid JSON for check "${params.assertion.label}"`
    );
  }
  if (typeof parsed.pass !== 'boolean') {
    throw new Error(
      `judge "${params.judge.name}" returned invalid pass value for check "${params.assertion.label}"`
    );
  }
  return {
    pass: parsed.pass,
    reason:
      typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : parsed.pass
        ? `Agent check passed: ${params.assertion.label}`
        : `Agent check failed: ${params.assertion.label}`,
    metadata: {
      judge_agent: params.judge.name,
      judge_model: params.judge.agent.model,
      judge_provider: params.judge.agent.provider
    }
  };
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Run aborted by user');
  }
}

function isAbortError(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const message = err?.message ?? '';
  return message === 'Run aborted by user' || err?.name === 'AbortError';
}
