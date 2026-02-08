import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalConfig, ScenarioRunResult, ResultsJson } from './types.js';
import { TraceWriter } from './trace.js';
import { McpClientManager } from './mcp.js';
import { runAgentScenario } from './agent.js';
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
}

export async function runAll(
  config: EvalConfig,
  options: RunOptions
): Promise<{ runDir: string; results: ResultsJson }> {
  throwIfAborted(options.signal);
  const runId = createRunId();
  const runRoot = options.runsDir?.trim() || 'runs';
  const runDir = join(process.cwd(), runRoot, runId);
  mkdirSync(runDir, { recursive: true });

  const tracePath = join(runDir, 'trace.jsonl');
  const trace = new TraceWriter(tracePath);
  trace.write({
    type: 'run_started',
    run_id: runId,
    ts: new Date().toISOString(),
    config_hash: options.configHash
  });

  const mcp = new McpClientManager();
  await mcp.connectAll(config.servers, options.signal);

  const scenarioRuns: Array<{
    scenario_id: string;
    agent: string;
    eval?: EvalConfig['scenarios'][number]['eval'];
    runs: ScenarioRunResult[];
  }> = [];

  for (const scenario of config.scenarios) {
    throwIfAborted(options.signal);
    if (!scenario.agent) {
      throw new Error(`Scenario '${scenario.id}' has no agent. Provide --agents or set scenario.agent.`);
    }
    const agent = config.agents[scenario.agent];
    if (!agent) {
      throw new Error(`Agent not found: ${scenario.agent}`);
    }
    const runs: ScenarioRunResult[] = [];

    for (let runIndex = 0; runIndex < options.runsPerScenario; runIndex += 1) {
      throwIfAborted(options.signal);
      trace.write({
        type: 'scenario_started',
        scenario_id: scenario.id,
        agent: scenario.agent,
        ts: new Date().toISOString()
      });

      const runResult = await runAgentScenario({ scenario, agent, mcp, trace, signal: options.signal });
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
        pass: evalResult.pass,
        metrics: {
          tool_call_count: runResult.toolSequence.length,
          failures: evalResult.failures
        },
        ts: new Date().toISOString()
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
