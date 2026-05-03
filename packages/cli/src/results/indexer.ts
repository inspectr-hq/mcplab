import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ResultsJson, ScenarioRunTraceRecord } from '@inspectr/mcplab-core';
import type { IndexManifest, ResultStatus, SearchDoc } from './types.js';

const INDEX_REL_DIR = '../.index';
const INDEX_FILE_NAME = 'results-search.jsonl';
const MANIFEST_FILE_NAME = 'manifest.json';

function getIndexPaths(runsDir: string): {
  indexDir: string;
  indexPath: string;
  manifestPath: string;
} {
  const indexDir = resolve(runsDir, INDEX_REL_DIR);
  return {
    indexDir,
    indexPath: join(indexDir, INDEX_FILE_NAME),
    manifestPath: join(indexDir, MANIFEST_FILE_NAME)
  };
}

function ensureIndexDir(runsDir: string): {
  indexDir: string;
  indexPath: string;
  manifestPath: string;
} {
  const paths = getIndexPaths(runsDir);
  mkdirSync(paths.indexDir, { recursive: true });
  return paths;
}

function listRunDirs(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .map((name) => ({ name, abs: join(runsDir, name) }))
    .filter((entry) => {
      try {
        return statSync(entry.abs).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

function getRunFileSet(runDir: string): string[] {
  return ['results.json', 'trace.jsonl', 'summary.md'].filter((name) =>
    existsSync(join(runDir, name))
  );
}

function getRunMtime(runDir: string, files: string[]): number {
  let maxMtime = 0;
  for (const file of files) {
    const st = statSync(join(runDir, file));
    maxMtime = Math.max(maxMtime, st.mtimeMs);
  }
  return maxMtime;
}

export function indexNeedsRefresh(runsDir: string): boolean {
  const { indexPath, manifestPath } = getIndexPaths(runsDir);
  if (!existsSync(indexPath) || !existsSync(manifestPath)) return true;

  let manifest: IndexManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IndexManifest;
  } catch {
    return true;
  }

  if (manifest.version !== 1) return true;

  const runIds = listRunDirs(runsDir);
  const manifestRunIds = Object.keys(manifest.runs).sort();
  if (runIds.join(',') !== manifestRunIds.join(',')) return true;

  for (const runId of runIds) {
    const runDir = join(runsDir, runId);
    const files = getRunFileSet(runDir);
    const mtime = getRunMtime(runDir, files);
    const existing = manifest.runs[runId];
    if (!existing) return true;
    if (existing.mtime_ms !== mtime) return true;
    if (existing.files.join(',') !== files.join(',')) return true;
  }
  return false;
}

function statusFromScenarioRun(run: { pass: boolean }): ResultStatus {
  return run.pass ? 'passed' : 'failed';
}

function toShortText(input: unknown, max = 1200): string {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

function buildDocsFromResults(runId: string, runDir: string, results: ResultsJson): SearchDoc[] {
  const docs: SearchDoc[] = [];
  docs.push({
    id: `${runId}:summary`,
    run_id: runId,
    run_timestamp: results.metadata.timestamp,
    source: 'results',
    file: 'results.json',
    title: `Run ${runId} summary`,
    text: JSON.stringify({ metadata: results.metadata, summary: results.summary }),
    tags: ['run', 'summary', 'results']
  });

  for (const scenario of results.scenarios) {
    const scenarioStatus: ResultStatus = scenario.runs.every((run) => run.pass)
      ? 'passed'
      : 'failed';
    docs.push({
      id: `${runId}:scenario:${scenario.scenario_id}:${scenario.agent}`,
      run_id: runId,
      run_timestamp: results.metadata.timestamp,
      scenario_id: scenario.scenario_id,
      agent: scenario.agent,
      status: scenarioStatus,
      source: 'results',
      file: 'results.json',
      title: `Scenario ${scenario.scenario_id} (${scenario.agent})`,
      text: JSON.stringify({
        pass_rate: scenario.pass_rate,
        tool_usage_frequency: scenario.tool_usage_frequency,
        last_final_answer: scenario.last_final_answer,
        failures: scenario.runs.flatMap((r) => r.failures),
        errors: scenario.runs.map((r) => r.error).filter(Boolean)
      }),
      tags: ['scenario', scenarioStatus, 'results', 'assertion']
    });

    for (const run of scenario.runs) {
      if (run.pass && run.failures.length === 0 && !run.error) continue;
      docs.push({
        id: `${runId}:failure:${scenario.scenario_id}:${scenario.agent}:${run.run_index}`,
        run_id: runId,
        run_timestamp: results.metadata.timestamp,
        scenario_id: scenario.scenario_id,
        agent: scenario.agent,
        status: statusFromScenarioRun(run),
        source: 'results',
        file: 'results.json',
        title: `Failure ${scenario.scenario_id} run ${run.run_index}`,
        text: JSON.stringify({
          failures: run.failures,
          error: run.error,
          tool_calls: run.tool_calls,
          final_text: run.final_text
        }),
        tags: ['failure', 'assertion', 'error', 'results']
      });
    }
  }

  const summaryPath = join(runDir, 'summary.md');
  if (existsSync(summaryPath)) {
    const summaryMd = readFileSync(summaryPath, 'utf8');
    const sections = summaryMd
      .split('\n## ')
      .map((section, idx) => (idx === 0 ? section : `## ${section}`));
    sections.forEach((section, idx) => {
      const trimmed = section.trim();
      if (!trimmed) return;
      docs.push({
        id: `${runId}:summarymd:${idx}`,
        run_id: runId,
        run_timestamp: results.metadata.timestamp,
        source: 'summary',
        file: 'summary.md',
        title: `Summary section ${idx + 1}`,
        text: toShortText(trimmed, 2000),
        tags: ['summary', 'markdown']
      });
    });
  }

  return docs;
}

function buildDocsFromTrace(runId: string, tracePath: string, runTimestamp?: string): SearchDoc[] {
  if (!existsSync(tracePath)) return [];
  const docs: SearchDoc[] = [];
  const lines = readFileSync(tracePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = parsed as Partial<ScenarioRunTraceRecord>;
    if (rec.type !== 'scenario_run' || !rec.scenario_id || !rec.agent) continue;

    const msgs = Array.isArray(rec.messages) ? rec.messages : [];
    const eventTexts: string[] = [];
    for (const m of msgs) {
      if (!Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (block.type === 'text') eventTexts.push(block.text);
        if (block.type === 'tool_use') {
          eventTexts.push(`tool_use ${block.name} ${toShortText(block.input, 400)}`);
        }
        if (block.type === 'tool_result') {
          eventTexts.push(
            `tool_result ${block.name} error=${block.is_error ? 'true' : 'false'} ${toShortText(
              block.content,
              600
            )}`
          );
        }
      }
    }
    const text = eventTexts.join(' ').trim();
    if (!text) continue;
    const status: ResultStatus = rec.pass ? 'passed' : 'failed';

    docs.push({
      id: `${runId}:trace:${i + 1}`,
      run_id: runId,
      run_timestamp: runTimestamp,
      scenario_id: rec.scenario_id,
      agent: rec.agent,
      status,
      source: 'trace',
      file: 'trace.jsonl',
      line_start: i + 1,
      line_end: i + 1,
      title: `Trace ${rec.scenario_id} (${rec.agent}) line ${i + 1}`,
      text: toShortText(text, 2200),
      tags: ['trace', status, rec.pass ? 'ok' : 'error', 'tool_result']
    });
  }
  return docs;
}

export function buildSearchIndex(runsDir: string): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const runIds = listRunDirs(runsDir);
  for (const runId of runIds) {
    const runDir = join(runsDir, runId);
    const resultsPath = join(runDir, 'results.json');
    if (!existsSync(resultsPath)) continue;
    let results: ResultsJson;
    try {
      results = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
    } catch {
      continue;
    }
    docs.push(...buildDocsFromResults(runId, runDir, results));
    docs.push(
      ...buildDocsFromTrace(runId, join(runDir, 'trace.jsonl'), results.metadata.timestamp)
    );
  }
  return docs;
}

export function writeSearchIndex(runsDir: string, docs: SearchDoc[]): void {
  const { indexPath, manifestPath } = ensureIndexDir(runsDir);
  writeFileSync(
    indexPath,
    docs.map((doc) => JSON.stringify(doc)).join('\n') + (docs.length ? '\n' : ''),
    'utf8'
  );

  const runIds = listRunDirs(runsDir);
  const manifest: IndexManifest = { version: 1, runs: {} };
  for (const runId of runIds) {
    const runDir = join(runsDir, runId);
    const files = getRunFileSet(runDir);
    manifest.runs[runId] = {
      mtime_ms: getRunMtime(runDir, files),
      files
    };
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function loadSearchIndex(runsDir: string): SearchDoc[] {
  const { indexPath } = ensureIndexDir(runsDir);
  if (!existsSync(indexPath)) return [];
  const lines = readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
  const docs: SearchDoc[] = [];
  for (const line of lines) {
    try {
      docs.push(JSON.parse(line) as SearchDoc);
    } catch {
      continue;
    }
  }
  return docs;
}

export function loadOrBuildSearchIndex(runsDir: string, rebuild = false): SearchDoc[] {
  if (rebuild || indexNeedsRefresh(runsDir)) {
    const docs = buildSearchIndex(runsDir);
    writeSearchIndex(runsDir, docs);
    return docs;
  }
  return loadSearchIndex(runsDir);
}
