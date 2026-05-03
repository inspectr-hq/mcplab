import type { SearchDoc, SearchFilters, SearchHit } from './types.js';

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
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

  if (doc.status === 'failed') score += 4;
  if (doc.source === 'results') score += 2;
  if (doc.source === 'trace') score += 1;

  const tagBoost = ['error', 'timeout', 'assertion', 'tool_result'];
  for (const tag of tagBoost) {
    if (tags.has(tag) && terms.some((t) => tag.includes(t) || t.includes(tag))) {
      score += 3;
    }
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
      context_command: `mcplab results context --run ${doc.run_id}${
        doc.scenario_id ? ` --scenario ${doc.scenario_id}` : ''
      }${doc.line_start ? ` --around ${doc.line_start}` : ''}`
    }));
}
