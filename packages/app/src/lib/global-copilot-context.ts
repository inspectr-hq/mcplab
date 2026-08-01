export type GlobalCopilotRouteContext = {
  pathname: string;
  search: string;
  activeTestCaseId?: string;
  selectedEntity?: { type: 'evaluation' | 'result' | 'tool_analysis_result' | 'server' | 'agent'; id: string };
  resultsFilter?: { since?: string; until?: string };
};

const PRESET_DURATIONS_MS: Record<string, number> = {
  '15min': 15 * 60_000, '30min': 30 * 60_000, '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000,
  '14d': 14 * 24 * 60 * 60_000, '30d': 30 * 24 * 60 * 60_000
};

function resultsFilterFromSearch(search: string, now: Date): { since?: string; until?: string } | undefined {
  const params = new URLSearchParams(search);
  if (params.get('time_filter') === 'last') {
    const duration = PRESET_DURATIONS_MS[params.get('time_preset') ?? ''];
    return duration ? { since: new Date(now.getTime() - duration).toISOString(), until: now.toISOString() } : undefined;
  }
  if (params.get('time_filter') !== 'custom') return undefined;
  const parse = (value: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : undefined;
  const start = parse(params.get('time_start'));
  const end = parse(params.get('time_end'));
  if (!start && !end) return undefined;
  return start && end && start > end ? { since: end, until: start } : { since: start, until: end };
}

export function globalCopilotRouteContext(pathname: string, search: string, now = new Date()): GlobalCopilotRouteContext {
  const match = (pattern: RegExp, type: NonNullable<GlobalCopilotRouteContext['selectedEntity']>['type']) => {
    const id = pathname.match(pattern)?.[1];
    return id ? { type, id: decodeURIComponent(id) } : undefined;
  };
  const activeTestCaseId = pathname.match(/^\/libraries\/test-cases\/([^/]+)/)?.[1];
  return {
    pathname,
    search,
    ...(activeTestCaseId ? { activeTestCaseId: decodeURIComponent(activeTestCaseId) } : {}),
    ...(pathname === '/results' && resultsFilterFromSearch(search, now) ? { resultsFilter: resultsFilterFromSearch(search, now) } : {}),
    selectedEntity:
      match(/^\/mcp-evaluations\/([^/]+)/, 'evaluation') ??
      match(/^\/results\/([^/]+)/, 'result') ??
      match(/^\/tool-analysis-results\/([^/]+)/, 'tool_analysis_result') ??
      match(/^\/libraries\/servers\/([^/]+)/, 'server') ??
      match(/^\/libraries\/agents\/([^/]+)/, 'agent')
  };
}
