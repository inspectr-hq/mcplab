import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type {
  ExecutableEvalConfig,
  ScenarioRunResult,
  ResultsJson,
  ExecutableScenario,
  ScenarioRunTraceRecord,
  RunOutcome,
  WorkspaceEvaluation
} from './types.js';
import { isAbortError, throwIfAborted } from './abort.js';
import { isLlmAgent } from './types.js';
import { TraceWriter } from './trace.js';
import { McpClientManager } from './mcp.js';
import {
  discoverScenarioTools,
  runAgentScenario,
  type AgentRunProgressEvent,
  type ScenarioToolCatalog
} from './agent.js';
import { validateEvalToolRules } from './tool-rule-expressions.js';
import { buildNotExecutedCheckResults, normalizeToolConstraintAliases } from './eval.js';
import { aggregateResults } from './results.js';
import { evaluateScenarioObservation } from './scenario-observation.js';
import { evaluateSemanticAssertions } from './decisions.js';
import { persistEvaluationArtifacts } from './artifacts.js';
import { enrichTraceMessagesWithEstimatedTokens } from './trace-token-estimates.js';
import {
  createLangSmithTraceExporter,
  toLangSmithMessages,
  type TraceExporter
} from './langsmith-tracing.js';

export interface RunOptions extends WorkspaceEvaluation {
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
  signal?: AbortSignal;
  /** Optional signal per executable scenario-agent pair. A child abort skips only that pair. */
  scenarioSignal?: (scenario: ExecutableScenario, runIndex: number) => AbortSignal | undefined;
  onProgress?: (event: RunProgressEvent) => void | Promise<void>;
  onWarning?: (warning: string) => void | Promise<void>;
  traceExporter?: TraceExporter;
  mcpServerUrlOverrides?: Record<string, string>;
  resolveMcpRequestHeaders?: (
    context: McpRequestHeaderContext
  ) => Record<string, string> | undefined;
  /** Skip standard result projections when a caller owns shared persistence. */
  persistArtifacts?: boolean;
}

export interface McpRequestHeaderContext {
  phase: 'connect' | 'scenario';
  runId: string;
  serverName: string;
  requestId?: string;
  scenarioId?: string;
  agentName?: string;
  runIndex?: number;
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
      outcome?: RunOutcome;
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

function mergeServerRequestHeaders(
  ...sources: Array<Record<string, Record<string, string>> | undefined>
): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [serverName, headers] of Object.entries(source)) {
      merged[serverName] = { ...(merged[serverName] ?? {}), ...headers };
    }
  }
  return merged;
}

export async function runAll(
  config: ExecutableEvalConfig,
  options: RunOptions
): Promise<{ runDir: string; results: ResultsJson }> {
  throwIfAborted(options.signal);
  const scenariosToRun = filterScenariosForRun(config.scenarios, options.scenarioId);
  const warned = new Set<string>();
  const warn = async (warning: string) => {
    if (warned.has(warning)) return;
    warned.add(warning);
    if (options.onWarning) await options.onWarning(warning);
    else console.warn(warning);
  };
  for (const scenario of scenariosToRun) {
    for (const warning of validateEvalToolRules(scenario.eval, `Scenario "${scenario.id}"`))
      await warn(warning);
  }
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
  const scenarioRequestHeaders = async (
    scenario: ExecutableScenario,
    runSignal: AbortSignal | undefined,
    runIndex: number,
    requestId: string
  ) => {
    const serverNames = scenario.servers;
    const [clientCredentialsHeaders, externalHeaders] = await Promise.all([
      mcp.getRequestHeadersForServers(serverNames, runSignal),
      options.resolveMcpServerAuthHeaders?.(serverNames, { signal: runSignal }) ??
        Promise.resolve({})
    ]);
    const requestHeaders = options.resolveMcpRequestHeaders
      ? Object.fromEntries(
          serverNames.map((serverName) => [
            serverName,
            options.resolveMcpRequestHeaders!({
              phase: 'scenario',
              runId,
              requestId,
              scenarioId: scenario.id,
              agentName: scenario.agent,
              runIndex,
              serverName
            }) ?? {}
          ])
        )
      : undefined;
    return mergeServerRequestHeaders(clientCredentialsHeaders, externalHeaders, requestHeaders);
  };
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
        const url = options.mcpServerUrlOverrides?.[id];
        return [id, url ? { ...server, url } : server];
      })
    );
    await emitProgress({
      type: 'mcp_connect_started',
      serverCount: usedServerIds.length,
      serverNames: usedServerIds
    });
    const serverRequestHeaders = options.resolveMcpRequestHeaders
      ? Object.fromEntries(
          usedServerIds.map((serverName) => [
            serverName,
            options.resolveMcpRequestHeaders!({
              phase: 'connect',
              runId,
              serverName
            }) ?? {}
          ])
        )
      : undefined;
    await mcp.connectAll(usedServers, options.signal, {
      serverAuthHeaders: buildMcpServerAuthHeaders(options),
      serverRequestHeaders
    });
    await emitProgress({
      type: 'mcp_connect_finished',
      serverCount: usedServerIds.length,
      serverNames: usedServerIds
    });
    const mcpServerVersions = mcp.getServerVersions();
    const preparedTools = new Map<ExecutableScenario, ScenarioToolCatalog>();
    const preparedRules = new Map<ExecutableScenario, ExecutableScenario['eval']>();
    for (const scenario of scenariosToRun) {
      // Discovery prepares the entire job. Child cancellation only gates its attempts.
      const signal = options.signal;
      throwIfAborted(options.signal);
      let requestId: string;
      try {
        requestId = buildScenarioRequestId({
          runId,
          scenarioId: scenario.id,
          agentName: scenario.agent,
          scenarioExecId: scenario.scenario_exec_id,
          runIndex: 0
        });
      } catch {
        requestId = buildFallbackScenarioRequestId({
          runId,
          runIndex: 0,
          scenarioAgent: scenario.agent
        });
      }
      const catalog = await discoverScenarioTools({
        scenario,
        mcp,
        signal,
        requestId,
        serverRequestHeaders: await scenarioRequestHeaders(scenario, signal, 0, requestId)
      });
      const names = [...catalog.keys()];
      for (const warning of validateEvalToolRules(
        scenario.eval,
        `Scenario "${scenario.id}"`,
        names
      ))
        await warn(warning);
      preparedTools.set(scenario, catalog);
      preparedRules.set(scenario, normalizeToolConstraintAliases(scenario.eval, names));
    }

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
      if (!isLlmAgent(agent)) {
        throw new Error(`Browser agent '${scenario.agent}' must be dispatched through Rover.`);
      }
      const runs: ScenarioRunResult[] = [];
      const effectiveScenarioEval = preparedRules.get(scenario) ?? scenario.eval;
      const scenarioSignal = options.scenarioSignal?.(scenario, 0) ?? options.signal;

      for (let runIndex = 0; runIndex < options.runsPerScenario; runIndex += 1) {
        const runSignal = options.scenarioSignal?.(scenario, runIndex) ?? scenarioSignal;
        if (runSignal?.aborted && !options.signal?.aborted) break;
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
            preparedTools: preparedTools.get(scenario),
            requestId,
            resolveServerRequestHeaders: async () => {
              return scenarioRequestHeaders(scenario, runSignal, runIndex, requestId);
            },
            maxTurns: agent.max_turns,
            signal: runSignal,
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
          const scenarioRun = await evaluateScenarioObservation({
            scenario: { ...scenario, eval: effectiveScenarioEval },
            runIndex,
            observation: {
              finalText: runResult.finalText,
              toolCalls: runResult.toolCalls,
              toolDurationsMs: runResult.toolDurationsMs,
              availableToolNames: runResult.availableToolNames,
              startedAt: runResult.traceStartedAt,
              completedAt: runResult.traceEndedAt,
              requestId,
              executionSource: 'mcplab'
            },
            judgeAgentAssertions: options.evaluationJudge
              ? async (input) =>
                  evaluateSemanticAssertions({
                    assertions: input.assertions,
                    context: input.context,
                    finalText: runResult.finalText,
                    judge: options.evaluationJudge!,
                    evaluationDecision: options.evaluationDecision,
                    signal: runSignal
                  })
              : undefined
          });
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
            pass: scenarioRun.pass,
            outcome: scenarioRun.outcome,
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
              pass: scenarioRun.pass,
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
            pass: scenarioRun.pass,
            outcome: scenarioRun.outcome,
            toolCallCount: runResult.toolSequence.length
          });
        } catch (scenarioErr: any) {
          const recordedRun = runs.find((run) => run.run_index === runIndex);
          if (recordedRun) {
            // Trace cleanup or progress delivery can fail after evaluation was recorded.
            // Preserve that outcome even if a child stop arrives during cleanup.
            console.error(
              `Scenario '${scenario.id}' run ${runIndex} cleanup failed: ${String(scenarioErr?.message ?? scenarioErr)}`
            );
            await emitProgress({
              type: 'scenario_run_finished',
              scenarioId: scenario.id,
              agentName: scenario.agent,
              scenarioRunIndex,
              totalScenarioRuns,
              runIndex,
              runsPerScenario: options.runsPerScenario,
              pass: recordedRun.pass,
              outcome: recordedRun.outcome,
              toolCallCount: recordedRun.tool_call_count
            });
            throwIfAborted(options.signal);
            if (runSignal?.aborted) break;
            continue;
          }
          if (options.signal?.aborted) {
            await scenarioTrace.end({
              error: String(scenarioErr?.message ?? scenarioErr),
              outputs: { pass: false }
            });
            throw scenarioErr;
          }
          let traceEnded = false;
          if (isAbortError(scenarioErr) && !runSignal?.aborted) {
            await scenarioTrace.end({
              error: String(scenarioErr?.message ?? scenarioErr),
              outputs: { pass: false }
            });
            traceEnded = true;
            // A child stop can arrive while trace cleanup is awaiting. Record it below.
            if (options.signal?.aborted || !runSignal?.aborted) throw scenarioErr;
          }
          const stopped = Boolean(runSignal?.aborted);
          const outcome = stopped ? 'stopped' : 'error';
          const errorMessage = String(scenarioErr?.message ?? scenarioErr ?? 'Request aborted');
          if (!stopped) {
            console.error(`Scenario '${scenario.id}' run ${runIndex} failed: ${errorMessage}`);
          }
          const tsEnd = new Date().toISOString();
          const unsuccessfulRun: ScenarioRunResult = {
            run_index: runIndex,
            request_id: requestId,
            pass: false,
            outcome,
            ...(stopped ? { stop_reason: errorMessage } : { error: errorMessage }),
            failures: stopped ? [] : [`Scenario error: ${errorMessage}`],
            check_results: buildNotExecutedCheckResults(scenario.eval),
            tool_calls: [],
            tool_call_count: 0,
            tool_sequence: [],
            tool_usage: {},
            tool_durations_ms: [],
            run_duration_ms: Math.max(0, Date.parse(tsEnd) - Date.parse(tsStart)),
            final_text: '',
            extracted: {}
          };
          runs.push(unsuccessfulRun);
          const unsuccessfulTrace: ScenarioRunTraceRecord = {
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
            outcome,
            error: errorMessage,
            messages: []
          };
          trace.write(unsuccessfulTrace);
          if (!traceEnded) {
            await scenarioTrace.end({
              error: errorMessage,
              outputs: { pass: false, ...(stopped ? { stopped: true } : {}) }
            });
          }
          await emitProgress({
            type: 'scenario_run_finished',
            scenarioId: scenario.id,
            agentName: scenario.agent,
            scenarioRunIndex,
            totalScenarioRuns,
            runIndex,
            runsPerScenario: options.runsPerScenario,
            pass: false,
            outcome,
            toolCallCount: 0
          });
          if (stopped) break;
        }
      }

      if (runs.length > 0) {
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
      executionSource: 'mcplab',
      scenarioRuns
    });
    if (options.persistArtifacts !== false) {
      persistEvaluationArtifacts({ runDir, results });
    }
    await emitProgress({ type: 'run_finished', runId, totalScenarioRuns });

    return { runDir, results };
  } finally {
    await mcp.disconnectAll();
    if (!traceExporterFlushed) await traceExporter.flush();
  }
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
  // scenario_exec_id is `<scenario>-<agent>`: only repeat it when slugifying lost part of the
  // agent name, so distinct agents with the same slug keep distinct IDs.
  const execSuffix =
    execBase && execBase !== `${scenarioId}-${agentSlug}` ? `${execBase}-${runSuffix}` : runSuffix;
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
  if (!trimmed) return fallback;
  if (/^[\x20-\x7e]*$/.test(trimmed)) return trimmed;
  // Request IDs travel in HTTP headers (x-request-id, inspectr-trace-id), which only accept
  // ByteStrings. Replace other characters and keep a digest of the original so IDs stay unique.
  const ascii = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]+/g, '_');
  return `${ascii}~${createHash('sha256').update(trimmed).digest('hex').slice(0, 8)}`;
}

function clampRequestIdLength(
  value: string,
  options?: {
    requiredSuffix?: string;
  }
): string {
  if (value.length <= MAX_REQUEST_ID_LENGTH) return value;
  // Truncation drops part of the ID, so keep a digest of the full value to stay unique.
  const digest = `~${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
  const maxSuffixLength = MAX_REQUEST_ID_LENGTH - digest.length;
  const requiredSuffix = options?.requiredSuffix ?? '';
  const normalizedSuffix =
    requiredSuffix.length > maxSuffixLength
      ? requiredSuffix.slice(requiredSuffix.length - maxSuffixLength)
      : requiredSuffix;
  const prefixLength = maxSuffixLength - normalizedSuffix.length;
  return `${value.slice(0, prefixLength)}${digest}${normalizedSuffix}`;
}

function slugifyAgentName(agentName: string): string {
  const normalized = agentName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  const compact = normalized.replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_');
  return compact || 'unknown-agent';
}
