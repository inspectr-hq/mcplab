import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, indexNeedsRefresh, loadOrBuildSearchIndex } from './results/indexer.js';
import { getContext } from './results/context.js';
import { makeSnippet, searchDocs, tokenize } from './results/search.js';
import type { ResultsJson } from '@inspectr/mcplab-core';
import { createResultsRunFixture } from './test-results-fixture.js';

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
    const { runsDir } = createResultsRunFixture();
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
    const { runsDir, runId } = createResultsRunFixture();
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
    const { runsDir, runId } = createResultsRunFixture();
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
    const { runsDir, runId } = createResultsRunFixture();
    const context = getContext({
      runsDir,
      runId,
      scenarioId: 'search-tags'
    });
    expect(context.source).toBe('mixed');
    expect(context.excerpt).toContain('"scenario_id": "search-tags"');
  });

  it('returns summary context when source=summary', () => {
    const { runsDir, runId } = createResultsRunFixture();
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
    const { runsDir, runId } = createResultsRunFixture();
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
