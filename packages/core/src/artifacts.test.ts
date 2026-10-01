import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistEvaluationArtifacts } from './artifacts.js';
import type { ResultsJson, ScenarioRunTraceRecord } from './types.js';

describe('persistEvaluationArtifacts', () => {
  it('writes canonical result artifacts and optional trace records', () => {
    const runDir = join(mkdtempSync(join(tmpdir(), 'mcplab-artifacts-')), 'run-1');
    const results: ResultsJson = {
      metadata: {
        run_id: 'run-1',
        timestamp: '2026-09-08T10:00:00.000Z',
        config_hash: 'hash',
        cli_version: 'test',
        mcp_server_versions: {}
      },
      summary: {
        total_scenarios: 0,
        total_runs: 0,
        pass_rate: 0,
        avg_tool_calls_per_run: 0,
        avg_tool_latency_ms: null
      },
      scenarios: []
    };
    const trace: ScenarioRunTraceRecord = {
      type: 'scenario_run',
      trace_version: 3,
      run_index: 0,
      scenario_id: 'case-1',
      agent: 'rover',
      provider: 'claude',
      model: 'external',
      ts_start: '2026-09-08T10:00:00.000Z',
      ts_end: '2026-09-08T10:00:01.000Z',
      pass: true,
      messages: []
    };

    persistEvaluationArtifacts({
      runDir,
      results,
      resolvedConfig: { scenarios: [] },
      traceRecords: [trace]
    });

    expect(JSON.parse(readFileSync(join(runDir, 'results.json'), 'utf8'))).toEqual(results);
    expect(readFileSync(join(runDir, 'summary.md'), 'utf8')).toContain('Run ID: run-1');
    expect(readFileSync(join(runDir, 'resolved-config.yaml'), 'utf8')).toContain('scenarios: []');
    expect(readFileSync(join(runDir, 'trace.jsonl'), 'utf8')).toContain('"scenario_id":"case-1"');
  });
});
