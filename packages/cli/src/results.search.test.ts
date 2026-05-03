import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, indexNeedsRefresh, loadOrBuildSearchIndex } from './results/indexer.js';
import { getContext } from './results/context.js';
import { makeSnippet, searchDocs, tokenize } from './results/search.js';
import type { ResultsJson } from '@inspectr/mcplab-core';

function setupRunFixture(): { root: string; runsDir: string; runId: string } {
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

describe('results search utilities', () => {
  it('tokenizes text', () => {
    expect(tokenize('Timeout in search_tags:5000ms')).toEqual([
      'timeout',
      'in',
      'search_tags:5000ms'
    ]);
  });

  it('creates focused snippet', () => {
    const text = 'alpha beta gamma timeout delta epsilon';
    expect(makeSnippet(text, 'timeout', 16)).toContain('timeout');
  });
});

describe('results index/search/context', () => {
  it('builds index with semantic docs and searchable hits', () => {
    const { runsDir } = setupRunFixture();
    const docs = buildSearchIndex(runsDir);
    expect(docs.length).toBeGreaterThan(2);

    const hits = searchDocs(docs, {
      query: 'tool failed timeout',
      limit: 10,
      status: 'failed',
      source: ['results', 'trace', 'summary'],
      scenario: 'search-tags',
      agent: 'claude-haiku'
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.run_id).toBe('20260206-212239');
    expect(hits[0]?.context_command).toContain('mcplab results context');
  });

  it('writes index and detects manifest staleness', () => {
    const { runsDir, runId } = setupRunFixture();
    const docsA = loadOrBuildSearchIndex(runsDir, true);
    expect(docsA.length).toBeGreaterThan(0);
    expect(indexNeedsRefresh(runsDir)).toBe(false);

    const resultsPath = join(runsDir, runId, 'results.json');
    const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
    parsed.summary.total_runs = 2;
    writeFileSync(resultsPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

    expect(indexNeedsRefresh(runsDir)).toBe(true);
  });

  it('returns bounded trace context around line', () => {
    const { runsDir, runId } = setupRunFixture();
    const context = getContext({
      runsDir,
      runId,
      scenarioId: 'search-tags',
      around: 1,
      before: 0,
      after: 1
    });

    expect(context.source).toBe('trace');
    expect(context.line_start).toBe(1);
    expect(context.excerpt).toContain('scenario_run');
  });

  it('returns mixed context by default without before/after', () => {
    const { runsDir, runId } = setupRunFixture();
    const context = getContext({
      runsDir,
      runId,
      scenarioId: 'search-tags'
    });
    expect(context.source).toBe('mixed');
    expect(context.excerpt).toContain('"scenario_id": "search-tags"');
  });

  it('returns summary context when source=summary', () => {
    const { runsDir, runId } = setupRunFixture();
    const context = getContext({
      runsDir,
      runId,
      scenarioId: 'search-tags',
      source: 'summary'
    });
    expect(context.source).toBe('summary');
    expect(context.excerpt).toContain('search-tags');
  });

  it('returns results context when source=results', () => {
    const { runsDir, runId } = setupRunFixture();
    const context = getContext({
      runsDir,
      runId,
      scenarioId: 'search-tags',
      source: 'results'
    });
    expect(context.source).toBe('results');
    expect(context.excerpt).toContain('"scenario_id": "search-tags"');
  });
});
