export type GlobalCopilotRouteContext = {
  pathname: string;
  search: string;
  activeTestCaseId?: string;
  selectedEntity?: { type: 'evaluation' | 'result' | 'tool_analysis_result' | 'server' | 'agent'; id: string };
};

export function globalCopilotRouteContext(pathname: string, search: string): GlobalCopilotRouteContext {
  const match = (pattern: RegExp, type: NonNullable<GlobalCopilotRouteContext['selectedEntity']>['type']) => {
    const id = pathname.match(pattern)?.[1];
    return id ? { type, id: decodeURIComponent(id) } : undefined;
  };
  const activeTestCaseId = pathname.match(/^\/libraries\/test-cases\/([^/]+)/)?.[1];
  return {
    pathname,
    search,
    ...(activeTestCaseId ? { activeTestCaseId: decodeURIComponent(activeTestCaseId) } : {}),
    selectedEntity:
      match(/^\/mcp-evaluations\/([^/]+)/, 'evaluation') ??
      match(/^\/results\/([^/]+)/, 'result') ??
      match(/^\/tool-analysis-results\/([^/]+)/, 'tool_analysis_result') ??
      match(/^\/libraries\/servers\/([^/]+)/, 'server') ??
      match(/^\/libraries\/agents\/([^/]+)/, 'agent')
  };
}
