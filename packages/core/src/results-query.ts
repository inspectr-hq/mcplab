import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ResultsJson, ScenarioRunTraceRecord } from './types.js';

export type ResultSource = 'results' | 'trace' | 'summary';
export type ResultStatus = 'passed' | 'failed';

export interface SearchDoc {
  id: string;
  run_id: string;
  run_timestamp?: string;
  scenario_id?: string;
  agent?: string;
  status?: ResultStatus;
  source: ResultSource;
  file: string;
  line_start?: number;
  line_end?: number;
  title: string;
  text: string;
  tags: string[];
}

export interface SearchHit {
  run_id: string;
  scenario_id?: string;
  agent?: string;
  status?: ResultStatus;
  source: ResultSource;
  file: string;
  line_start?: number;
  line_end?: number;
  snippet: string;
  score: number;
  context_command?: string;
}

export interface SearchFilters {
  query: string;
  limit: number;
  status: 'passed' | 'failed' | 'all';
  source: ResultSource[];
  scenario?: string;
  agent?: string;
}

export interface IndexManifest {
  version: 1;
  runs: Record<string, { mtime_ms: number; files: string[] }>;
}

export interface ContextOptions {
  runsDir: string;
  runId: string;
  scenarioId: string;
  source?: ResultSource;
  around?: number;
  before?: number;
  after?: number;
}

export interface ContextResult {
  run_id: string;
  scenario_id: string;
  source: ResultSource | 'mixed';
  excerpt: string;
  line_start?: number;
  line_end?: number;
}

const INDEX_REL_DIR = '../.index';
const INDEX_FILE_NAME = 'results-search.jsonl';
const MANIFEST_FILE_NAME = 'manifest.json';

export function getResultsIndexPaths(runsDir: string): {
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

function ensureIndexDir(runsDir: string): ReturnType<typeof getResultsIndexPaths> {
  const paths = getResultsIndexPaths(runsDir);
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

export function listRunIdsDesc(runsDir: string): string[] {
  return listRunDirs(runsDir).slice().reverse();
}

function getRunFileSet(runDir: string): string[] {
  return ['results.json', 'trace.jsonl', 'summary.md'].filter((name) =>
    existsSync(join(runDir, name))
  );
}

function getRunMtime(runDir: string, files: string[]): number {
  // Empty run directories return 0; treated as stable sentinel for "no artifact mtime".
  let maxMtime = 0;
  for (const file of files) {
    const st = statSync(join(runDir, file));
    maxMtime = Math.max(maxMtime, st.mtimeMs);
  }
  return maxMtime;
}

export function resolveRunArtifactPath(runsDir: string, runId: string, file: string): string {
  if (!runId.trim()) throw new Error('run id must not be empty');
  const base = resolve(runsDir);
  const target = resolve(base, runId, file);
  if (target !== base && !target.startsWith(`${base}/`)) {
    throw new Error(`Invalid run id path: ${runId}`);
  }
  return target;
}

export function indexNeedsRefresh(runsDir: string): boolean {
  const { indexPath, manifestPath } = getResultsIndexPaths(runsDir);
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
        if (block.type === 'tool_use')
          eventTexts.push(`tool_use ${block.name} ${toShortText(block.input, 400)}`);
        if (block.type === 'tool_result') {
          const contentText = Array.isArray(block.content)
            ? block.content
                .filter((c): c is { type: 'text'; text: string } => c?.type === 'text')
                .map((c) => c.text)
                .join(' ')
            : '';
          eventTexts.push(
            `tool_result ${block.name} error=${block.is_error ? 'true' : 'false'} ${toShortText(
              contentText,
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
    const runDir = resolve(runsDir, runId);
    const resultsPath = resolveRunArtifactPath(runsDir, runId, 'results.json');
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

export function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9_.:-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    )
  );
}

export function makeSnippet(text: string, query: string, size = 240): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const terms = tokenize(query);
  const pos =
    terms
      .map((term) => lower.indexOf(term))
      .filter((idx) => idx >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, pos - Math.floor(size / 2));
  return text
    .slice(start, start + size)
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreDoc(doc: SearchDoc, query: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const title = doc.title.toLowerCase();
  const text = doc.text.toLowerCase();
  const tags = new Set(doc.tags.map((t) => t.toLowerCase()));
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (tags.has(term)) score += 6;
    if (text.includes(term)) score += 3;
    if (doc.scenario_id?.toLowerCase().includes(term)) score += 4;
    if (doc.agent?.toLowerCase().includes(term)) score += 4;
    if (doc.status?.includes(term as 'passed' | 'failed')) score += 2;
  }

  // Intentional ranking biases: failed scenarios first, then structured results docs.
  if (doc.status === 'failed') score += 4;
  if (doc.source === 'results') score += 2;
  if (doc.source === 'trace') score += 1;

  const tagBoost = ['error', 'timeout', 'assertion', 'tool_result'];
  for (const tag of tagBoost) {
    if (tags.has(tag) && terms.some((t) => tag.includes(t) || t.includes(tag))) score += 3;
  }

  const ts = doc.run_timestamp ? Date.parse(doc.run_timestamp) : NaN;
  if (!Number.isNaN(ts)) {
    const ageDays = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
    score += Math.max(0, 2 - ageDays / 7);
  }

  return Number(score.toFixed(4));
}

export function matchesFilters(doc: SearchDoc, filters: SearchFilters): boolean {
  if (!filters.source.includes(doc.source)) return false;
  if (filters.status !== 'all' && doc.status !== filters.status) return false;
  if (filters.scenario && doc.scenario_id !== filters.scenario) return false;
  if (filters.agent && doc.agent !== filters.agent) return false;
  return true;
}

export function searchDocs(docs: SearchDoc[], filters: SearchFilters): SearchHit[] {
  return docs
    .filter((doc) => matchesFilters(doc, filters))
    .map((doc) => ({ doc, score: scoreDoc(doc, filters.query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, filters.limit)
    .map(({ doc, score }) => ({
      run_id: doc.run_id,
      scenario_id: doc.scenario_id,
      agent: doc.agent,
      status: doc.status,
      source: doc.source,
      file: doc.file,
      line_start: doc.line_start,
      line_end: doc.line_end,
      snippet: makeSnippet(doc.text, filters.query),
      score,
      ...(doc.scenario_id
        ? {
            context_command: `mcplab results context --run ${JSON.stringify(
              doc.run_id
            )} --scenario ${JSON.stringify(doc.scenario_id)} --source ${doc.source}${
              doc.line_start ? ` --around ${doc.line_start}` : ''
            }`
          }
        : {})
    }));
}

function readResults(runsDir: string, runId: string): ResultsJson {
  const path = resolveRunArtifactPath(runsDir, runId, 'results.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ResultsJson;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read results.json for run ${runId} at ${path}: ${msg}`);
  }
}

function contextFromTrace(
  opts: Required<Pick<ContextOptions, 'runsDir' | 'runId' | 'scenarioId'>> & {
    around?: number;
    before: number;
    after: number;
  }
): ContextResult {
  const tracePath = resolveRunArtifactPath(opts.runsDir, opts.runId, 'trace.jsonl');
  if (!existsSync(tracePath)) throw new Error(`trace.jsonl not found for run ${opts.runId}`);
  const lines = readFileSync(tracePath, 'utf8').split('\n');
  const center = Math.max(1, opts.around ?? 1);
  const start = Math.max(1, center - opts.before);
  const end = Math.min(lines.length, center + opts.after);
  const excerpt = lines
    .slice(start - 1, end)
    .map((line, idx) => `${start + idx}: ${line}`)
    .join('\n')
    .trim();

  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'trace',
    line_start: start,
    line_end: end,
    excerpt
  };
}

function contextFromScenarioMixed(
  opts: Required<Pick<ContextOptions, 'runsDir' | 'runId' | 'scenarioId'>>
): ContextResult {
  const results = readResults(opts.runsDir, opts.runId);
  const scenario = results.scenarios.find((entry) => entry.scenario_id === opts.scenarioId);
  if (!scenario) throw new Error(`Scenario not found in run: ${opts.scenarioId}`);

  const failedRuns = scenario.runs.filter((run) => !run.pass);
  const recentFailure = failedRuns[failedRuns.length - 1];
  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'mixed',
    excerpt: JSON.stringify(
      {
        metadata: {
          run_id: results.metadata.run_id,
          timestamp: results.metadata.timestamp,
          run_note: results.metadata.run_note
        },
        scenario: {
          scenario_id: scenario.scenario_id,
          agent: scenario.agent,
          pass_rate: scenario.pass_rate,
          tool_usage_frequency: scenario.tool_usage_frequency,
          last_final_answer: scenario.last_final_answer
        },
        recent_failure: recentFailure
          ? {
              run_index: recentFailure.run_index,
              error: recentFailure.error,
              failures: recentFailure.failures,
              tool_calls: recentFailure.tool_calls,
              final_text: recentFailure.final_text
            }
          : null
      },
      null,
      2
    )
  };
}

function contextFromSummary(
  opts: Required<Pick<ContextOptions, 'runsDir' | 'runId' | 'scenarioId'>>
): ContextResult {
  const summaryPath = resolveRunArtifactPath(opts.runsDir, opts.runId, 'summary.md');
  if (!existsSync(summaryPath)) throw new Error(`summary.md not found for run ${opts.runId}`);
  const lines = readFileSync(summaryPath, 'utf8').split('\n');
  const matched = lines.filter((line) => line.includes(opts.scenarioId));
  const excerpt = matched.slice(0, 20).join('\n') || lines.slice(0, 80).join('\n');
  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'summary',
    excerpt
  };
}

function contextFromResults(
  opts: Required<Pick<ContextOptions, 'runsDir' | 'runId' | 'scenarioId'>>
): ContextResult {
  const results = readResults(opts.runsDir, opts.runId);
  const matches = results.scenarios.filter((s) => s.scenario_id === opts.scenarioId);
  if (matches.length === 0) throw new Error(`Scenario not found in run: ${opts.scenarioId}`);
  const excerpt = JSON.stringify(matches, null, 2);
  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'results',
    excerpt: toShortText(excerpt, 20_000)
  };
}

export function getContext(opts: ContextOptions): ContextResult {
  const before = opts.before ?? 20;
  const after = opts.after ?? 20;
  if (opts.source === 'trace' && (opts.around === undefined || opts.around <= 0)) {
    throw new Error('around is required when source=trace');
  }
  if (opts.around !== undefined && opts.around > 0) {
    return contextFromTrace({
      runsDir: opts.runsDir,
      runId: opts.runId,
      scenarioId: opts.scenarioId,
      around: opts.around,
      before,
      after
    });
  }
  if (opts.around !== undefined && opts.around <= 0) {
    throw new Error('around must be a positive integer');
  }
  if (!opts.source) {
    return contextFromScenarioMixed({
      runsDir: opts.runsDir,
      runId: opts.runId,
      scenarioId: opts.scenarioId
    });
  }
  if (opts.source === 'summary') {
    return contextFromSummary({
      runsDir: opts.runsDir,
      runId: opts.runId,
      scenarioId: opts.scenarioId
    });
  }
  return contextFromResults({
    runsDir: opts.runsDir,
    runId: opts.runId,
    scenarioId: opts.scenarioId
  });
}
