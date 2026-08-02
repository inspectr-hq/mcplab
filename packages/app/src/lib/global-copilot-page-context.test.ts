import { afterEach, describe, expect, it } from 'vitest';
import {
  clearGlobalCopilotPageContext,
  globalCopilotPageContext,
  globalCopilotPageContextForPath,
  setGlobalCopilotPageContext
} from './global-copilot-page-context';

afterEach(() => clearGlobalCopilotPageContext());

describe('globalCopilotPageContext', () => {
  it('keeps the active Test Cases filters compactly available to a copilot run', () => {
    setGlobalCopilotPageContext({
      testCases: {
        serverFilter: 'TrendMiner',
        searchQuery: 'profile',
        visibleCount: 2,
        totalCount: 13
      }
    });

    expect(globalCopilotPageContext()).toEqual({
      testCases: {
        serverFilter: 'TrendMiner',
        searchQuery: 'profile',
        visibleCount: 2,
        totalCount: 13
      }
    });
  });

  it('does not leak stale Tool Analysis context into the Test Cases route', () => {
    setGlobalCopilotPageContext({
      toolAnalysis: {
        selectedServerNames: ['weather'],
        selectedToolCount: 1,
        runState: 'idle'
      }
    });

    expect(globalCopilotPageContextForPath('/libraries/test-cases')).toEqual({});
  });
});
