export type GlobalCopilotPageContext = {
  testCases?: {
    serverFilter: string;
    searchQuery?: string;
    visibleCount: number;
    totalCount: number;
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
