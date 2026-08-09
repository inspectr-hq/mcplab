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

  it('forwards scenario editor context on configuration and test-case editor routes', () => {
    const scenarioEditor = {
      configId: 'cfg-1',
      agents: [{ id: 'agent-1', name: 'Agent 1' }],
      defaultAgentId: 'agent-1',
      scenarios: [
        {
          id: 'scn-1',
          name: 'Greeting',
          prompt: 'Say hello',
          serverIds: ['server-1'],
          evalRules: [],
          extractRules: []
        }
      ]
    };
    setGlobalCopilotPageContext({ scenarioEditor });

    expect(globalCopilotPageContextForPath('/mcp-evaluations/cfg-1')).toEqual({ scenarioEditor });
    expect(globalCopilotPageContextForPath('/libraries/test-cases/scn-1')).toEqual({
      scenarioEditor
    });
  });
});
