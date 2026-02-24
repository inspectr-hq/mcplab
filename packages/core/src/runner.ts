import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type {
  ExecutableEvalConfig,
  ScenarioRunResult,
  ResultsJson,
  ExecutableScenario
} from './types.js';
import { TraceWriter } from './trace.js';
import { McpClientManager } from './mcp.js';
import { runAgentScenario, type AgentRunProgressEvent } from './agent.js';
import { evaluateScenario, extractValues } from './eval.js';
import { aggregateResults, renderSummaryMarkdown } from './results.js';

export interface RunOptions {
  runsPerScenario: number;
  scenarioId?: string;
  configHash: string;
  gitCommit?: string;
  cliVersion: string;
  runsDir?: string;
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
  | { type: 'mcp_connect_started'; serverCount: number }
  | { type: 'mcp_connect_finished'; serverCount: number }
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

export async function runAll(
  config: ExecutableEvalConfig,
  options: RunOptions
): Promise<{ runDir: string; results: ResultsJson }> {
  throwIfAborted(options.signal);
  const emitProgress = async (event: RunProgressEvent): Promise<void> => {
    if (!options.onProgress) return;
    await options.onProgress(event);
  };
  const runId = createRunId();
  const runRoot = options.runsDir?.trim() || 'runs';
  const runsBaseDir = isAbsolute(runRoot) ? runRoot : resolve(process.cwd(), runRoot);
  const runDir = join(runsBaseDir, runId);
  mkdirSync(runDir, { recursive: true });

  const tracePath = join(runDir, 'trace.jsonl');
  const resolvedConfigPath = join(runDir, 'resolved-config.yaml');
  writeFileSync(resolvedConfigPath, `${stringifyYaml(config)}\n`, 'utf8');
  const trace = new TraceWriter(tracePath);
  trace.write({
    type: 'trace_meta',
    trace_version: 2,
    run_id: runId,
    ts: new Date().toISOString()
  });
  trace.write({
    type: 'run_started',
    run_id: runId,
    ts: new Date().toISOString(),
    config_hash: options.configHash
  });
  const totalScenarioRuns = config.scenarios.length * options.runsPerScenario;
  await emitProgress({
    type: 'run_started',
    runId,
    totalScenarioRuns,
    runsPerScenario: options.runsPerScenario
  });

  const mcp = new McpClientManager();
  await emitProgress({ type: 'mcp_connect_started', serverCount: Object.keys(config.servers).length });
  await mcp.connectAll(config.servers, options.signal);
  await emitProgress({ type: 'mcp_connect_finished', serverCount: Object.keys(config.servers).length });

  const scenarioRuns: Array<{
    scenario_id: string;
    agent: string;
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
      trace.write({
        type: 'scenario_started',
        scenario_id: scenario.id,
        agent: scenario.agent,
        ts: new Date().toISOString()
      });

      const runResult = await runAgentScenario({
        scenario,
        agent,
        mcp,
        trace,
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
      const evalResult = evaluateScenario(
        runResult.finalText,
        runResult.toolSequence,
        scenario.eval
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
        pass: evalResult.pass,
        failures: evalResult.failures,
        tool_calls: runResult.toolSequence,
        tool_call_count: runResult.toolSequence.length,
        tool_sequence: runResult.toolSequence,
        tool_usage: toolUsage,
        tool_durations_ms: runResult.toolDurationsMs,
        final_text: runResult.finalText,
        extracted
      };
      runs.push(scenarioRun);

      trace.write({
        type: 'scenario_finished',
        scenario_id: scenario.id,
        agent: scenario.agent,
        pass: evalResult.pass,
        metrics: {
          tool_call_count: runResult.toolSequence.length,
          failures: evalResult.failures
        },
        ts: new Date().toISOString()
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
    }

    scenarioRuns.push({
      scenario_id: scenario.id,
      agent: scenario.agent,
      eval: scenario.eval,
      runs
    });
  }

  const results = aggregateResults({
    runId,
    timestamp: new Date().toISOString(),
    gitCommit: options.gitCommit,
    configHash: options.configHash,
    cliVersion: options.cliVersion,
    scenarioRuns
  });

  const resultsPath = join(runDir, 'results.json');
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

  const summaryPath = join(runDir, 'summary.md');
  writeFileSync(summaryPath, renderSummaryMarkdown(results), 'utf8');
  await emitProgress({ type: 'run_finished', runId, totalScenarioRuns });

  return { runDir, results };
}

function createRunId(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Run aborted by user');
  }
}
