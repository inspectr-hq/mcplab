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
