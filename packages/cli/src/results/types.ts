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
  context_command: string;
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
  runs: Record<
    string,
    {
      mtime_ms: number;
      files: string[];
    }
  >;
}
