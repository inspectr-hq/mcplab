import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EvalConfig, ResultsJson, ScenarioRunTraceRecord, ServerVariant } from './types.js';
import { createRunId, runAll, type RunOptions } from './runner.js';
import { applyRuntimeServerOverrides } from './runtime-overrides.js';
import { expandConfigForAgents, hashConfig } from './config.js';
import { annotateServerVariant, planServerVariants } from './server-variants.js';
import { projectEvaluationResult } from './evaluation-result-projection.js';
import { persistEvaluationArtifacts } from './artifacts.js';

/** Immediate CLI/MCP execution uses the same plan and projection as queued evaluations. */
export async function runServerVariants(
  config: EvalConfig,
  agents: string[],
  variants: ServerVariant[],
  options: RunOptions & { configPath?: string }
) {
  const plan = planServerVariants(config, variants);
  const runId = createRunId();
  const runDir = resolve(
    options.cwd ?? process.cwd(),
    options.runsDir ?? 'mcplab/results/evaluation-runs',
    runId
  );
  const childDir = join(runDir, '.executions');
  mkdirSync(childDir, { recursive: true });
  const executions: ResultsJson[] = [];
  const traces: ScenarioRunTraceRecord[] = [];
  const errors: Record<string, string> = {};
  for (const [index, variant] of plan.entries()) {
    try {
      const effective = applyRuntimeServerOverrides(config, {
        scenarioServerOverrides: variant.scenarioServerOverrides
      });
      const child = await runAll(expandConfigForAgents(effective, agents), {
        ...options,
        configHash: hashConfig(effective),
        runsDir: join(childDir, String(index)),
        persistArtifacts: false
      });
      const records = readFileSync(join(child.runDir, 'trace.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ScenarioRunTraceRecord)
        .filter((record) => record.type === 'scenario_run');
      const annotated = annotateServerVariant(child.results, records, variant);
      executions.push(annotated.results);
      traces.push(...annotated.traceRecords);
    } catch (error) {
      errors[variant.id] = error instanceof Error ? error.message : String(error);
    }
  }
  const results = projectEvaluationResult({
    evaluationRunId: runId,
    runId,
    executions,
    evaluationName: config.name,
    runNote: options.runNote,
    failedExecutions: Object.keys(errors).length
  });
  Object.assign(results.metadata, {
    config_hash: options.configHash,
    config_path: options.configPath,
    cli_version: options.cliVersion,
    server_variants: plan,
    rerun_server_variants: plan,
    server_variant_errors: errors,
    rerun_runs_per_scenario: options.runsPerScenario,
    rerun_agents: agents,
    rerun_scenario_ids: config.scenarios.map((scenario) => scenario.id)
  });
  persistEvaluationArtifacts({ runDir, results, resolvedConfig: config, traceRecords: traces });
  rmSync(childDir, { recursive: true, force: true });
  return { runDir, results };
}
