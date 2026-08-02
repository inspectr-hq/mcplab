export type GlobalCopilotPageContext = {
  testCases?: {
    serverFilter: string;
    searchQuery?: string;
    visibleCount: number;
    totalCount: number;
  };
  servers?: {
    searchQuery?: string;
    visibleCount: number;
    totalCount: number;
  };
  agents?: {
    searchQuery?: string;
    visibleCount: number;
    totalCount: number;
  };
  evaluations?: {
    searchQuery?: string;
    suiteFilter: string;
    sortBy: string;
    sortDirection: 'asc' | 'desc';
    visibleCount: number;
    totalCount: number;
  };
  toolAnalysis?: {
    selectedServerNames: string[];
    selectedToolCount: number;
    toolSearchQuery?: string;
    runState: 'idle' | 'running' | 'stopped' | 'error';
    activeJobId?: string;
  };
};

let currentContext: GlobalCopilotPageContext = {};

export function setGlobalCopilotPageContext(context: GlobalCopilotPageContext): void {
  currentContext = context;
}

export function clearGlobalCopilotPageContext(): void {
  currentContext = {};
}

export function globalCopilotPageContext(): GlobalCopilotPageContext {
  return currentContext;
}

/**
 * Page state is published by mounted route components. During a route
 * transition an effect cleanup can lag the new location, so only forward the
 * context shape that belongs to the route being submitted with the request.
 */
export function globalCopilotPageContextForPath(pathname: string): GlobalCopilotPageContext {
  if (pathname === '/mcp-evaluations') {
    return currentContext.evaluations ? { evaluations: currentContext.evaluations } : {};
  }
  if (pathname === '/tool-analysis') {
    return currentContext.toolAnalysis ? { toolAnalysis: currentContext.toolAnalysis } : {};
  }
  if (pathname.startsWith('/libraries/test-cases')) {
    return currentContext.testCases ? { testCases: currentContext.testCases } : {};
  }
  if (pathname.startsWith('/libraries/servers')) {
    return currentContext.servers ? { servers: currentContext.servers } : {};
  }
  if (pathname.startsWith('/libraries/agents')) {
    return currentContext.agents ? { agents: currentContext.agents } : {};
  }
  return {};
}
