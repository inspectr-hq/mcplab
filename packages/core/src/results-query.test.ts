import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, getContext, searchDocs } from './results-query.js';
import type { ResultsJson } from './types.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-core-rq-'));
  const runsDir = join(root, 'runs');
  const runId = '20260206-212239';
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const results: ResultsJson = {
    metadata: {
      run_id: runId,
      timestamp: '2026-02-06T21:22:39.000Z',
      config_hash: 'abc',
      cli_version: '1.0.0',
      mcp_server_versions: {}
    },
    summary: {
      total_scenarios: 1,
      total_runs: 1,
      pass_rate: 0,
      avg_tool_calls_per_run: 1,
      avg_tool_latency_ms: 10
    },
    scenarios: [
      {
        scenario_id: 'search-tags',
        agent: 'claude-haiku',
        runs: [
          {
            run_index: 0,
            pass: false,
            failures: [{ message: 'failed', severity: 'error' }],
            error_failures: 1,
            warning_failures: 0,
            tool_calls: ['search_tags'],
            tool_call_count: 1,
            tool_sequence: ['search_tags'],
            tool_usage: { search_tags: 1 },
            tool_durations_ms: [10],
            final_text: 'timeout happened',
            extracted: {},
            error: 'timeout'
          }
        ],
        pass_rate: 0,
        distinct_sequences: { '["search_tags"]': 1 },
        tool_usage_frequency: { search_tags: 1 },
        extracted_values: {},
        last_final_answer: 'timeout happened'
      }
    ]
  };

  writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(join(runDir, 'summary.md'), '# Summary\n', 'utf8');
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
              tool_use_id: '1',
              name: 'search_tags',
              content: [{ type: 'text', text: 'returned timeout after 5000ms' }],
              is_error: true
            }
          ]
        }
      ]
    })}\n`,
    'utf8'
  );

  return { runsDir, runId };
}

describe('results-query core', () => {
  it('normalizes legacy string failures from results.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-core-rq-legacy-'));
    const runsDir = join(root, 'runs');
    const runId = '20260206-legacy';
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'results.json'),
      JSON.stringify({
        metadata: {
          run_id: runId,
          timestamp: '2026-02-06T21:22:39.000Z',
          config_hash: 'abc',
          cli_version: '1.0.0',
          mcp_server_versions: {}
        },
        summary: {
          total_scenarios: 1,
          total_runs: 1,
          pass_rate: 0,
          avg_tool_calls_per_run: 0,
          avg_tool_latency_ms: null
        },
        scenarios: [
          {
            scenario_id: 'legacy-scn',
            agent: 'agent-a',
            runs: [
              {
                run_index: 0,
                pass: false,
                failures: ['legacy assertion failed'],
                tool_calls: [],
                tool_call_count: 0,
                tool_sequence: [],
                tool_usage: {},
                tool_durations_ms: [],
                final_text: '',
                extracted: {}
              }
            ],
            pass_rate: 0,
            distinct_sequences: {},
            tool_usage_frequency: {},
            extracted_values: {},
            last_final_answer: ''
          }
        ]
      }),
      'utf8'
    );
    const docs = buildSearchIndex(runsDir);
    expect(docs.some((doc) => doc.text.includes('legacy assertion failed'))).toBe(true);
  });

  it('omits context_command for summary docs without scenario_id', () => {
    const { runsDir } = fixture();
    const docs = buildSearchIndex(runsDir);
    const hits = searchDocs(docs, {
      query: 'summary',
      limit: 20,
      status: 'all',
      source: ['summary'],
      scenario: undefined,
      agent: undefined
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.context_command === undefined)).toBe(true);
  });

  it('adds quoted context_command including source for scenario docs', () => {
    const { runsDir } = fixture();
    const docs = buildSearchIndex(runsDir);
    const hits = searchDocs(docs, {
      query: 'timeout',
      limit: 5,
      status: 'failed',
      source: ['results', 'trace', 'summary'],
      scenario: 'search-tags',
      agent: 'claude-haiku'
    });
    expect(hits[0]?.context_command).toContain('--source');
    expect(hits[0]?.context_command).toContain('"20260206-212239"');
    expect(hits[0]?.context_command).toContain('"search-tags"');
  });

  it('indexes tool_result text content, not raw JSON wrappers', () => {
    const { runsDir } = fixture();
    const docs = buildSearchIndex(runsDir);
    const traceDoc = docs.find((d) => d.source === 'trace');
    expect(traceDoc?.text).toContain('returned timeout after 5000ms');
    expect(traceDoc?.text.includes('"type":"text"')).toBe(false);
  });

  it('requires around when source=trace', () => {
    const { runsDir, runId } = fixture();
    expect(() =>
      getContext({
        runsDir,
        runId,
        scenarioId: 'search-tags',
        source: 'trace'
      })
    ).toThrow('around is required when source=trace');
  });

  it('rejects around=0', () => {
    const { runsDir, runId } = fixture();
    expect(() =>
      getContext({
        runsDir,
        runId,
        scenarioId: 'search-tags',
        around: 0
      })
    ).toThrow('around must be a positive integer');
  });

  it('rejects source=trace with non-positive around using positive-integer message', () => {
    const { runsDir, runId } = fixture();
    expect(() =>
      getContext({
        runsDir,
        runId,
        scenarioId: 'search-tags',
        source: 'trace',
        around: 0
      })
    ).toThrow('around must be a positive integer');
  });

  it('rejects around with non-trace source', () => {
    const { runsDir, runId } = fixture();
    expect(() =>
      getContext({
        runsDir,
        runId,
        scenarioId: 'search-tags',
        source: 'results',
        around: 5
      })
    ).toThrow('around can only be used when source=trace');
  });

  it('blocks runId path traversal', () => {
    const { runsDir } = fixture();
    expect(() =>
      getContext({
        runsDir,
        runId: '../../etc/passwd',
        scenarioId: 'search-tags',
        source: 'results'
      })
    ).toThrow('Invalid run id path');
  });
});
