import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ResultsJson, ScenarioRunTraceRecord } from '@inspectr/mcplab-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ToolResponse = {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type RegisteredTool = {
  cb: (args: Record<string, unknown>) => Promise<ToolResponse> | ToolResponse;
};

type IndexDocument = {
  id: string;
  run_id: string;
  source: 'results' | 'trace' | 'summary';
  text: string;
  [key: string]: unknown;
};

type ResultsFixture = {
  bundleRoot: string;
  runsDir: string;
  runId: string;
  runDir: string;
  results: ResultsJson;
  traceRecords: ScenarioRunTraceRecord[];
  summaryMarkdown: string;
  expectedIndexDocumentCount: number;
};

const originalEnvironment = { ...process.env };
const originalCwd = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

async function setupTools(
  bundleRoot: string,
  runsDir: string
): Promise<Map<string, RegisteredTool>> {
  process.chdir(join(bundleRoot, '..'));
  process.env.MCPLAB_BUNDLE_ROOT = bundleRoot;
  process.env.MCPLAB_RUNS_DIR = runsDir;
  vi.resetModules();
  const { registerTools } = await import('./runtime.js');
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool: (name: string, _config: unknown, cb: RegisteredTool['cb']) => {
      tools.set(name, { cb });
      return { name };
    }
  } as any;
  registerTools(fakeServer);
  return tools;
}

function structured<T extends Record<string, unknown>>(result: ToolResponse): T {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as T;
}

function expectedIndexDocumentCount(
  results: ResultsJson,
  summaryMarkdown: string,
  traceRecords: ScenarioRunTraceRecord[]
): number {
  const failureDocuments = results.scenarios.flatMap((scenario) =>
    scenario.runs.filter((run) => !run.pass || run.failures.length > 0 || Boolean(run.error))
  ).length;
  const summaryDocuments = summaryMarkdown.split('\n## ').filter(Boolean).length;
  return 1 + results.scenarios.length + failureDocuments + summaryDocuments + traceRecords.length;
}

function createResultsFixture(): ResultsFixture {
  const root = mkdtempSync(join(process.cwd(), '.mcplab-mcp-results-'));
  temporaryRoots.push(root);
  const bundleRoot = join(root, 'bundle');
  const runsDir = join(root, 'runs');
  const runId = '20260801-120000';
  const runDir = join(runsDir, runId);
  mkdirSync(bundleRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  const results: ResultsJson = {
    metadata: {
      run_id: runId,
      timestamp: '2026-08-01T12:00:00.000Z',
      run_note: 'behavior coverage fixture',
      config_hash: 'config-sha-test',
      cli_version: '1.20.0-test',
      mcp_server_versions: { directory: '2.4.0' }
    },
    summary: {
      total_scenarios: 2,
      total_runs: 2,
      pass_rate: 0.5,
      avg_tool_calls_per_run: 1.5,
      avg_tool_latency_ms: 42
    },
    scenarios: [
      {
        scenario_id: 'profile-lookup',
        agent: 'scout',
        runs: [
          {
            run_index: 0,
            pass: false,
            failures: ['expected active profile'],
            error: 'profile lookup timeout',
            tool_calls: ['directory::lookup_profile'],
            tool_call_count: 1,
            tool_sequence: ['directory::lookup_profile'],
            tool_usage: { 'directory::lookup_profile': 1 },
            tool_durations_ms: [84],
            final_text: 'Profile lookup failed after timeout.',
            extracted: {}
          }
        ],
        pass_rate: 0,
        distinct_sequences: { '["directory::lookup_profile"]': 1 },
        tool_usage_frequency: { 'directory::lookup_profile': 1 },
        extracted_values: {},
        last_final_answer: 'Profile lookup failed after timeout.'
      },
      {
        scenario_id: 'status-summary',
        agent: 'analyst',
        runs: [
          {
            run_index: 0,
            pass: true,
            failures: [],
            tool_calls: ['reports::get_summary', 'reports::get_summary'],
            tool_call_count: 2,
            tool_sequence: ['reports::get_summary', 'reports::get_summary'],
            tool_usage: { 'reports::get_summary': 2 },
            tool_durations_ms: [20, 22],
            final_text: 'The status summary is healthy.',
            extracted: {}
          }
        ],
        pass_rate: 1,
        distinct_sequences: { '["reports::get_summary"]': 1 },
        tool_usage_frequency: { 'reports::get_summary': 2 },
        extracted_values: {},
        last_final_answer: 'The status summary is healthy.'
      }
    ]
  };

  const summaryMarkdown =
    '# Evaluation summary\n\n## Profile lookup\nThe profile lookup timeout needs investigation.\n\n## Status\nThe status summary is healthy.\n';
  const traceRecords: ScenarioRunTraceRecord[] = [
    {
      type: 'scenario_run',
      trace_version: 3,
      run_index: 0,
      scenario_id: 'profile-lookup',
      agent: 'scout',
      provider: 'openai',
      model: 'gpt-test',
      ts_start: '2026-08-01T12:00:00.000Z',
      ts_end: '2026-08-01T12:00:01.000Z',
      pass: false,
      messages: [
        {
          role: 'assistant',
          ts: '2026-08-01T12:00:00.100Z',
          content: [{ type: 'text', text: 'I will inspect the profile.' }]
        },
        {
          role: 'tool',
          ts: '2026-08-01T12:00:00.900Z',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'lookup-1',
              server: 'directory',
              name: 'lookup_profile',
              is_error: true,
              duration_ms: 84,
              content: [{ type: 'text', text: 'profile lookup timeout after 5000ms' }]
            }
          ]
        }
      ]
    }
  ];

  writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(join(runDir, 'summary.md'), summaryMarkdown, 'utf8');
  writeFileSync(
    join(runDir, 'trace.jsonl'),
    `${traceRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8'
  );

  return {
    bundleRoot,
    runsDir,
    runId,
    runDir,
    results,
    traceRecords,
    summaryMarkdown,
    expectedIndexDocumentCount: expectedIndexDocumentCount(results, summaryMarkdown, traceRecords)
  };
}

async function createIndexedFixture(): Promise<{
  fixture: ResultsFixture;
  tools: Map<string, RegisteredTool>;
  indexed: Record<string, unknown>;
  indexDocuments: IndexDocument[];
}> {
  const fixture = createResultsFixture();
  const tools = await setupTools(fixture.bundleRoot, fixture.runsDir);
  const indexed = structured<Record<string, unknown>>(
    await tools.get('mcplab_results_index')!.cb({ rebuild: true })
  );
  const indexDocuments = readFileSync(String(indexed.index_path), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as IndexDocument);
  return { fixture, tools, indexed, indexDocuments };
}

describe('results tool behavior', () => {
  it('reads structured results metadata, bounded content, and trace/summary artifacts', async () => {
    const fixture = createResultsFixture();
    const tools = await setupTools(fixture.bundleRoot, fixture.runsDir);

    const results = structured<Record<string, unknown>>(
      await tools.get('mcplab_read_run_artifact')!.cb({
        run_id: fixture.runId,
        artifact: 'results.json',
        max_chars: 80
      })
    );
    expect(results).toMatchObject({
      run_id: fixture.runId,
      artifact: 'results.json',
      truncated: true,
      metadata: expect.objectContaining({
        run_id: fixture.runId,
        config_hash: 'config-sha-test',
        mcp_server_versions: { directory: '2.4.0' }
      }),
      summary: { total_scenarios: 2, total_runs: 2, pass_rate: 0.5 },
      scenarios: [
        { scenario_id: 'profile-lookup', agent: 'scout', pass_rate: 0 },
        { scenario_id: 'status-summary', agent: 'analyst', pass_rate: 1 }
      ]
    });
    expect(String(results.content)).toContain('"run_id"');
    expect(String(results.content)).toContain('...[truncated');
    expect(String(results.content).length).toBeGreaterThan(80);
    const rawResults = readFileSync(join(fixture.runDir, 'results.json'), 'utf8');
    expect(String(results.content).length).toBeLessThanOrEqual(
      80 + `\n...[truncated ${rawResults.length - 80} chars]`.length
    );

    const trace = structured<Record<string, unknown>>(
      await tools.get('mcplab_read_run_artifact')!.cb({
        run_id: fixture.runId,
        artifact: 'trace.jsonl',
        line_start: 1,
        line_end: 1
      })
    );
    expect(trace).toMatchObject({
      artifact: 'trace.jsonl',
      line_range: 'lines 1–1 of 2',
      truncated: false,
      content: expect.stringContaining('profile lookup timeout')
    });

    const summary = structured<Record<string, unknown>>(
      await tools.get('mcplab_read_run_artifact')!.cb({
        run_id: 'LATEST',
        artifact: 'summary.md',
        max_chars: 200
      })
    );
    expect(summary).toMatchObject({
      run_id: fixture.runId,
      artifact: 'summary.md',
      content: expect.stringContaining('Profile lookup')
    });
  });

  it('creates the results index and reports its persisted document count', async () => {
    const { fixture, indexed, indexDocuments } = await createIndexedFixture();
    const indexPath = String(indexed.index_path);
    const manifestPath = String(indexed.manifest_path);
    const indexLines = readFileSync(indexPath, 'utf8').trim().split('\n');
    const runSummaryDocument = indexDocuments.find(
      (document) => document.id === `${fixture.runId}:summary`
    );
    const traceDocument = indexDocuments.find((document) => document.source === 'trace');

    expect(indexed).toMatchObject({
      runs_dir: fixture.runsDir,
      rebuilt: true,
      doc_count: fixture.expectedIndexDocumentCount,
      index_path: resolve(fixture.runsDir, '..', '.index', 'results-search.jsonl'),
      manifest_path: resolve(fixture.runsDir, '..', '.index', 'manifest.json')
    });
    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    expect(indexLines.length).toBe(fixture.expectedIndexDocumentCount);
    expect(runSummaryDocument).toMatchObject({
      id: `${fixture.runId}:summary`,
      run_id: fixture.runId,
      run_timestamp: '2026-08-01T12:00:00.000Z',
      source: 'results',
      file: 'results.json',
      title: `Run ${fixture.runId} summary`,
      tags: ['run', 'summary', 'results']
    });
    expect(String(runSummaryDocument?.text)).toContain('config-sha-test');
    expect(traceDocument).toMatchObject({
      id: `${fixture.runId}:trace:1`,
      run_id: fixture.runId,
      run_timestamp: '2026-08-01T12:00:00.000Z',
      scenario_id: 'profile-lookup',
      agent: 'scout',
      status: 'failed',
      source: 'trace',
      file: 'trace.jsonl',
      line_start: 1,
      line_end: 1,
      tags: ['trace', 'failed', 'error', 'tool_result']
    });
    expect(String(traceDocument?.text)).toContain('5000ms');
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
      version: 1,
      runs: { [fixture.runId]: { files: ['results.json', 'trace.jsonl', 'summary.md'] } }
    });
  });

  it('searches indexed result and trace content and filters hits by source', async () => {
    const { fixture, tools, indexDocuments } = await createIndexedFixture();
    expect(indexDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${fixture.runId}:scenario:profile-lookup:scout`,
          source: 'results',
          text: expect.stringContaining('profile lookup timeout')
        }),
        expect.objectContaining({
          id: `${fixture.runId}:trace:1`,
          source: 'trace',
          text: expect.stringContaining('5000ms')
        })
      ])
    );

    const resultHits = structured<Record<string, unknown>>(
      await tools.get('mcplab_results_search')!.cb({
        query: 'timeout',
        source: ['results'],
        limit: 1
      })
    );
    expect(resultHits.total_hits).toBe(1);
    expect(resultHits.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run_id: fixture.runId,
          scenario_id: 'profile-lookup',
          agent: 'scout',
          status: 'failed',
          source: 'results',
          file: 'results.json',
          snippet: expect.stringContaining('timeout'),
          context_command: expect.stringContaining('--source "results"')
        })
      ])
    );
    expect((resultHits.hits as Array<Record<string, unknown>>).every((hit) => hit.source === 'results')).toBe(true);
    expect((resultHits.hits as Array<Record<string, unknown>>).every((hit) => String(hit.snippet).length <= 240)).toBe(true);

    const traceHits = structured<Record<string, unknown>>(
      await tools.get('mcplab_results_search')!.cb({
        query: '5000ms',
        source: ['trace'],
        limit: 1
      })
    );
    expect(traceHits).toMatchObject({
      total_hits: 1,
      hits: [
        expect.objectContaining({
          run_id: fixture.runId,
          scenario_id: 'profile-lookup',
          agent: 'scout',
          source: 'trace',
          file: 'trace.jsonl',
          line_start: 1,
          line_end: 1,
          snippet: expect.stringContaining('5000ms')
        })
      ]
    });
    expect((traceHits.hits as Array<Record<string, unknown>>).every((hit) => hit.source === 'trace')).toBe(true);
    expect((traceHits.hits as Array<Record<string, unknown>>).every((hit) => String(hit.snippet).length <= 240)).toBe(true);
  });
});
