import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ResultsJson, ScenarioAggregate } from '@inspectr/mcplab-core';

export interface SnapshotSourceSummary {
  total_scenarios: number;
  total_runs: number;
  pass_rate: number;
}

export interface SnapshotItem {
  scenario_id: string;
  agent: string;
  required_tools: string[];
  forbidden_tools: string[];
  allowed_sequences: string[][];
  baseline_tools: string[];
  extracted_values: Record<string, string | number | boolean | null>;
  final_answer_features: {
    normalized: string;
    token_set: string[];
  };
}

export interface SnapshotRecord {
  schema_version: 1;
  id: string;
  name: string;
  created_at: string;
  source_run_id: string;
  config_hash: string;
  source_summary: SnapshotSourceSummary;
  items: SnapshotItem[];
}

export interface ScenarioComparison {
  scenario_id: string;
  agent: string;
  score: number;
  status: 'Match' | 'Warn' | 'Drift';
  components: {
    tools: number;
    extracts: number;
    semantics: number;
  };
  reasons: string[];
}

export interface SnapshotComparison {
  snapshot_id: string;
  run_id: string;
  overall_score: number;
  scenario_results: ScenarioComparison[];
}

export interface SnapshotEvalPolicy {
  enabled: boolean;
  mode: 'warn' | 'fail_on_drift';
  baseline_snapshot_id?: string;
  baseline_source_run_id?: string;
  last_updated_at?: string;
}

export interface AppliedSnapshotEval {
  applied: boolean;
  mode: 'warn' | 'fail_on_drift';
  baseline_snapshot_id: string;
  baseline_source_run_id?: string;
  overall_score: number;
  status: 'Match' | 'Warn' | 'Drift';
  impacted_scenarios: string[];
}

export function ensureRunFullyPassing(results: ResultsJson): void {
  if (results.summary.pass_rate !== 1) {
    throw new Error('Snapshot creation requires a fully passing run (pass_rate must equal 1.0).');
  }
  for (const scenario of results.scenarios) {
    for (const run of scenario.runs) {
      if (!run.pass) {
        throw new Error(
          `Snapshot creation requires all runs to pass. Found failing run in scenario '${scenario.scenario_id}'.`
        );
      }
    }
  }
}

export function buildSnapshotFromRun(results: ResultsJson, name?: string): SnapshotRecord {
  ensureRunFullyPassing(results);
  const id = `snapshot-${results.metadata.run_id}-${Date.now()}`;
  return {
    schema_version: 1,
    id,
    name: name?.trim() || `Snapshot ${results.metadata.run_id}`,
    created_at: new Date().toISOString(),
    source_run_id: results.metadata.run_id,
    config_hash: results.metadata.config_hash,
    source_summary: {
      total_scenarios: results.summary.total_scenarios,
      total_runs: results.summary.total_runs,
      pass_rate: results.summary.pass_rate
    },
    items: results.scenarios.map((scenario) => buildSnapshotItem(scenario))
  };
}

function buildSnapshotItem(scenario: ScenarioAggregate): SnapshotItem {
  const required_tools = scenario.eval?.tool_constraints?.required_tools ?? [];
  const forbidden_tools = scenario.eval?.tool_constraints?.forbidden_tools ?? [];
  const allowed_sequences = scenario.eval?.tool_sequence?.allow ?? [];
  const baseline_tools = Object.keys(scenario.tool_usage_frequency).sort();

  const extracted_values: Record<string, string | number | boolean | null> = {};
  for (const [key, values] of Object.entries(scenario.extracted_values)) {
    const top = Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    extracted_values[key] = coerceLiteral(top);
  }

  const normalized = normalizeText(scenario.last_final_answer || '');
  const token_set = Array.from(tokenize(normalized)).sort();

  return {
    scenario_id: scenario.scenario_id,
    agent: scenario.agent,
    required_tools,
    forbidden_tools,
    allowed_sequences,
    baseline_tools,
    extracted_values,
    final_answer_features: {
      normalized,
      token_set
    }
  };
}

export function compareRunToSnapshot(results: ResultsJson, snapshot: SnapshotRecord): SnapshotComparison {
  const scenario_results = snapshot.items.map((item) => {
    const scenario = results.scenarios.find(
      (candidate) => candidate.scenario_id === item.scenario_id && candidate.agent === item.agent
    );

    if (!scenario) {
      return {
        scenario_id: item.scenario_id,
        agent: item.agent,
        score: 0,
        status: 'Drift' as const,
        components: { tools: 0, extracts: 0, semantics: 0 },
        reasons: ['Scenario/agent pair missing in run']
      };
    }

    const reasons: string[] = [];
    const tools = scoreTools(item, scenario, reasons);
    const extracts = scoreExtracts(item, scenario, reasons);
    const semantics = scoreSemantics(item, scenario, reasons);

    const score = tools * 0.45 + extracts * 0.35 + semantics * 0.2;
    const status: ScenarioComparison['status'] = score >= 0.8 ? 'Match' : score >= 0.6 ? 'Warn' : 'Drift';

    return {
      scenario_id: item.scenario_id,
      agent: item.agent,
      score: round2(score),
      status,
      components: {
        tools: round2(tools),
        extracts: round2(extracts),
        semantics: round2(semantics)
      },
      reasons
    };
  });

  const overall_score =
    scenario_results.length === 0
      ? 0
      : round2(
          scenario_results.reduce((sum, scenario) => sum + scenario.score, 0) / scenario_results.length
        );

  return {
    snapshot_id: snapshot.id,
    run_id: results.metadata.run_id,
    overall_score,
    scenario_results
  };
}

export function applySnapshotPolicyToRunResult(params: {
  results: ResultsJson;
  comparison: SnapshotComparison;
  policy: SnapshotEvalPolicy;
  enabledScenarioIds?: Set<string>;
}): AppliedSnapshotEval {
  const { results, comparison, policy, enabledScenarioIds } = params;
  const impacted = comparison.scenario_results.filter((row) => {
    if (enabledScenarioIds && !enabledScenarioIds.has(row.scenario_id)) return false;
    return row.status === 'Drift';
  });

  const overallStatus: 'Match' | 'Warn' | 'Drift' =
    comparison.overall_score >= 0.8 ? 'Match' : comparison.overall_score >= 0.6 ? 'Warn' : 'Drift';

  if (policy.mode === 'fail_on_drift' && impacted.length > 0) {
    for (const row of impacted) {
      const scenario = results.scenarios.find(
        (candidate) => candidate.scenario_id === row.scenario_id && candidate.agent === row.agent
      );
      if (!scenario) continue;
      for (const run of scenario.runs) {
        run.pass = false;
        const reason = `Snapshot drift (${row.status}, score=${row.score}): ${row.reasons[0] ?? 'baseline mismatch'}`;
        if (!run.failures.includes(reason)) {
          run.failures.push(reason);
        }
      }
      scenario.pass_rate =
        scenario.runs.length === 0
          ? 0
          : scenario.runs.filter((run) => run.pass).length / scenario.runs.length;
    }

    const totalRuns = results.scenarios.reduce((sum, scenario) => sum + scenario.runs.length, 0);
    const totalPasses = results.scenarios.reduce(
      (sum, scenario) => sum + scenario.runs.filter((run) => run.pass).length,
      0
    );
    results.summary.pass_rate = totalRuns === 0 ? 0 : totalPasses / totalRuns;
  }

  const applied: AppliedSnapshotEval = {
    applied: true,
    mode: policy.mode,
    baseline_snapshot_id: comparison.snapshot_id,
    baseline_source_run_id: policy.baseline_source_run_id,
    overall_score: comparison.overall_score,
    status: overallStatus,
    impacted_scenarios: impacted.map((row) => `${row.scenario_id}::${row.agent}`)
  };
  results.metadata.snapshot_eval = applied;
  return applied;
}

function scoreTools(item: SnapshotItem, scenario: ScenarioAggregate, reasons: string[]): number {
  const usedTools = new Set(Object.keys(scenario.tool_usage_frequency));

  let penalties = 0;
  for (const required of item.required_tools) {
    if (!usedTools.has(required)) {
      penalties += 0.2;
      reasons.push(`Missing required tool: ${required}`);
    }
  }

  for (const forbidden of item.forbidden_tools) {
    if (usedTools.has(forbidden)) {
      penalties += 0.25;
      reasons.push(`Forbidden tool observed: ${forbidden}`);
    }
  }

  if (item.allowed_sequences.length > 0) {
    const allValid = scenario.runs.every((run) =>
      item.allowed_sequences.some((allowed) => JSON.stringify(allowed) === JSON.stringify(run.tool_sequence))
    );
    if (!allValid) {
      penalties += 0.2;
      reasons.push('Tool sequence mismatch against allowed sequences');
    }
  }

  const baselineSet = new Set(item.baseline_tools);
  const intersection = Array.from(usedTools).filter((tool) => baselineSet.has(tool)).length;
  const union = new Set([...Array.from(usedTools), ...Array.from(baselineSet)]).size;
  const jaccard = union === 0 ? 1 : intersection / union;

  let score = Math.max(0, 1 - penalties);
  score = score * 0.7 + jaccard * 0.3;

  for (const run of scenario.runs) {
    for (const failure of run.failures) {
      if (failure.toLowerCase().includes('assertion')) {
        score -= 0.15;
        reasons.push(`Assertion mismatch: ${failure}`);
        break;
      }
    }
  }

  return clamp01(score);
}

function scoreExtracts(item: SnapshotItem, scenario: ScenarioAggregate, reasons: string[]): number {
  const current: Record<string, string | number | boolean | null> = {};
  for (const [key, values] of Object.entries(scenario.extracted_values)) {
    const top = Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    current[key] = coerceLiteral(top);
  }

  const keys = new Set([...Object.keys(item.extracted_values), ...Object.keys(current)]);
  if (keys.size === 0) {
    reasons.push('No extract rules found; extract confidence reduced');
    return 0.7;
  }

  let sum = 0;
  for (const key of keys) {
    const expected = item.extracted_values[key] ?? null;
    const actual = current[key] ?? null;
    const fieldScore = compareValue(expected, actual);
    sum += fieldScore;
    if (fieldScore < 0.8) {
      reasons.push(`Extract drift (${key}): expected '${String(expected)}', observed '${String(actual)}'`);
    }
  }

  return clamp01(sum / keys.size);
}

function scoreSemantics(item: SnapshotItem, scenario: ScenarioAggregate, reasons: string[]): number {
  const normalized = normalizeText(scenario.last_final_answer || '');
  const runTokens = tokenize(normalized);
  const baseTokens = new Set(item.final_answer_features.token_set);

  if (runTokens.size === 0 && baseTokens.size === 0) {
    return 1;
  }

  const intersection = Array.from(runTokens).filter((token) => baseTokens.has(token)).length;
  const union = new Set([...Array.from(runTokens), ...Array.from(baseTokens)]).size;
  const similarity = union === 0 ? 1 : intersection / union;

  if (similarity < 0.55) {
    reasons.push(`Semantic divergence score low: ${round2(similarity)}`);
  }

  return clamp01(similarity);
}

function compareValue(
  expected: string | number | boolean | null,
  actual: string | number | boolean | null
): number {
  if (expected === null || actual === null) {
    return expected === actual ? 1 : 0;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    const denom = Math.abs(expected) || 1;
    const delta = Math.abs(actual - expected) / denom;
    if (delta <= 0.05) return 1;
    if (delta <= 0.15) return 0.6;
    return 0;
  }
  if (typeof expected === 'boolean' && typeof actual === 'boolean') {
    return expected === actual ? 1 : 0;
  }

  const expectedText = normalizeText(String(expected));
  const actualText = normalizeText(String(actual));
  if (expectedText === actualText) return 1;
  if (expectedText.includes(actualText) || actualText.includes(expectedText)) return 0.75;
  return 0;
}

export function saveSnapshot(record: SnapshotRecord, snapshotsDir: string): string {
  const resolved = resolve(snapshotsDir);
  mkdirSync(resolved, { recursive: true });
  const path = join(resolved, `${record.id}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return path;
}

export function loadSnapshot(id: string, snapshotsDir: string): SnapshotRecord {
  const path = join(resolve(snapshotsDir), `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(`Snapshot not found: ${id}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SnapshotRecord;
}

export function listSnapshots(snapshotsDir: string): SnapshotRecord[] {
  const resolved = resolve(snapshotsDir);
  if (!existsSync(resolved)) return [];
  return readdirSync(resolved)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(resolved, name), 'utf8')) as SnapshotRecord;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.created_at.localeCompare(a!.created_at)) as SnapshotRecord[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\-_.:\/ ]/g, ' ')
    .trim();
}

function tokenize(value: string): Set<string> {
  return new Set(value.split(' ').map((token) => token.trim()).filter((token) => token.length > 2));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function coerceLiteral(value: string | null): string | number | boolean | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && trimmed !== '') {
    return asNumber;
  }
  return value;
}

export function formatSnapshotComparisonTable(comparison: SnapshotComparison): string {
  const lines: string[] = [];
  lines.push(`Snapshot: ${comparison.snapshot_id}`);
  lines.push(`Run: ${comparison.run_id}`);
  lines.push(`Overall score: ${comparison.overall_score}`);
  lines.push('');
  lines.push('Scenario                     | Agent           | Score | Status | Reasons');
  lines.push('-----------------------------|-----------------|-------|--------|--------');
  for (const row of comparison.scenario_results) {
    const reasons = row.reasons.slice(0, 2).join('; ') || '—';
    lines.push(
      `${pad(row.scenario_id, 29)}| ${pad(row.agent, 15)}| ${pad(row.score.toFixed(2), 5)} | ${pad(row.status, 6)} | ${reasons}`
    );
  }
  return lines.join('\n');
}

function pad(value: string, n: number): string {
  if (value.length >= n) return value.slice(0, n);
  return `${value}${' '.repeat(n - value.length)}`;
}
