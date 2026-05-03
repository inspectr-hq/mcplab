import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResultsJson } from '@inspectr/mcplab-core';

export type RunFixture = { root: string; runsDir: string; runId: string };

export function createResultsRunFixture(): RunFixture {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-results-'));
  const runsDir = join(root, 'mcplab', 'results', 'evaluation-runs');
  const runId = '20260206-212239';
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const results: ResultsJson = {
    metadata: {
      run_id: runId,
      timestamp: '2026-02-06T21:22:39.000Z',
      config_hash: 'abc123',
      cli_version: '1.0.0',
      mcp_server_versions: {}
    },
    summary: {
      total_scenarios: 1,
      total_runs: 1,
      pass_rate: 0,
      avg_tool_calls_per_run: 1,
      avg_tool_latency_ms: 50
    },
    scenarios: [
      {
        scenario_id: 'search-tags',
        agent: 'claude-haiku',
        runs: [
          {
            run_index: 0,
            pass: false,
            failures: ['response assertion failed'],
            tool_calls: ['search_tags'],
            tool_call_count: 1,
            tool_sequence: ['search_tags'],
            tool_usage: { search_tags: 1 },
            tool_durations_ms: [50],
            final_text: 'Could not complete request because timeout',
            extracted: {},
            error: 'timeout'
          }
        ],
        pass_rate: 0,
        distinct_sequences: { '["search_tags"]': 1 },
        tool_usage_frequency: { search_tags: 1 },
        extracted_values: {},
        last_final_answer: 'Could not complete request because timeout'
      }
    ]
  };

  writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(runDir, 'summary.md'),
    '# MCP Eval Summary\n\n| Scenario | Agent | Runs | Pass rate |\n|---|---|---|---|\n| search-tags | claude-haiku | 1 | 0% |\n',
    'utf8'
  );
  writeFileSync(
    join(runDir, 'trace.jsonl'),
    `${JSON.stringify({
      type: 'scenario_run',
      trace_version: 3,
      run_index: 0,
      scenario_id: 'search-tags',
      agent: 'claude-haiku',
      provider: 'anthropic',
      model: 'claude-3-haiku',
      ts_start: '2026-02-06T21:22:39.000Z',
      ts_end: '2026-02-06T21:22:40.000Z',
      pass: false,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              name: 'search_tags',
              content: [{ type: 'text', text: 'tool search_tags returned timeout after 5000ms' }],
              is_error: true
            }
          ]
        }
      ]
    })}\nnot-json\n`,
    'utf8'
  );

  return { root, runsDir, runId };
}
