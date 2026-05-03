import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listRunIdsDesc, type ResultsJson } from '@inspectr/mcplab-core';
import type { ContextResult } from './context.js';
import type { SearchHit } from './types.js';

export interface RunListItem {
  run_id: string;
  timestamp?: string;
  pass_rate?: number;
  total_runs?: number;
}

function listRunIds(runsDir: string): string[] {
  return listRunIdsDesc(runsDir);
}

export function listRuns(runsDir: string): RunListItem[] {
  return listRunIds(runsDir).map((runId) => {
    const resultsPath = join(runsDir, runId, 'results.json');
    if (!existsSync(resultsPath)) {
      return { run_id: runId };
    }
    try {
      const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
      return {
        run_id: runId,
        timestamp: parsed.metadata.timestamp,
        pass_rate: parsed.summary.pass_rate,
        total_runs: parsed.summary.total_runs
      };
    } catch {
      return { run_id: runId };
    }
  });
}

export function showRun(runsDir: string, runId: string, format: 'json' | 'markdown'): string {
  const runDir = join(runsDir, runId);
  if (format === 'markdown') {
    const summaryPath = join(runDir, 'summary.md');
    if (existsSync(summaryPath)) {
      return readFileSync(summaryPath, 'utf8');
    }
  }
  const resultsPath = join(runDir, 'results.json');
  if (!existsSync(resultsPath)) {
    throw new Error(`results.json not found for run ${runId}`);
  }
  const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
  return JSON.stringify(parsed, null, 2);
}

export function formatRunList(list: RunListItem[], format: 'json' | 'table'): string {
  if (format === 'json') {
    return JSON.stringify(list, null, 2);
  }
  const lines = ['RUN_ID\tTIMESTAMP\tPASS_RATE\tTOTAL_RUNS'];
  for (const item of list) {
    lines.push(
      `${item.run_id}\t${item.timestamp ?? '-'}\t${
        item.pass_rate === undefined ? '-' : (item.pass_rate * 100).toFixed(1) + '%'
      }\t${item.total_runs ?? '-'}`
    );
  }
  return lines.join('\n');
}

export function formatSearchHits(hits: SearchHit[], format: 'json' | 'jsonl' | 'markdown'): string {
  if (format === 'json') return JSON.stringify(hits, null, 2);
  if (format === 'jsonl') return hits.map((hit) => JSON.stringify(hit)).join('\n');
  const lines = ['# Search Results', ''];
  hits.forEach((hit, idx) => {
    lines.push(
      `${idx + 1}. run=${hit.run_id} scenario=${hit.scenario_id ?? '-'} agent=${
        hit.agent ?? '-'
      } status=${hit.status ?? '-'} score=${hit.score}`
    );
    lines.push(
      `   source=${hit.source} file=${hit.file}${hit.line_start ? `:${hit.line_start}` : ''}`
    );
    lines.push(`   snippet: ${hit.snippet}`);
    if (hit.context_command) {
      lines.push(`   next: ${hit.context_command}`);
    }
  });
  return lines.join('\n');
}

export function formatContext(result: ContextResult, format: 'json' | 'markdown'): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  return [
    `# Context ${result.run_id}/${result.scenario_id}`,
    '',
    `run: ${result.run_id}`,
    `scenario: ${result.scenario_id}`,
    `source: ${result.source}`,
    result.line_start ? `lines: ${result.line_start}-${result.line_end}` : '',
    '',
    '```',
    result.excerpt,
    '```'
  ]
    .filter(Boolean)
    .join('\n');
}
