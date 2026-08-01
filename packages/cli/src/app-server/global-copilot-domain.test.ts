import { describe, expect, it } from 'vitest';
import {
  GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE,
  GLOBAL_COPILOT_FRONTEND_TOOLS,
  globalCopilotExternalServers,
  globalCopilotFrontendTools,
  isExplicitGlobalCopilotNavigationRequest,
  selectGlobalCopilotAgentName,
  toGlobalCopilotLlmMessages
} from './global-copilot-domain.js';

describe('selectGlobalCopilotAgentName', () => {
  it('allows five automatic read-only MCP calls before requesting confirmation', () => {
    expect(GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE).toBe(5);
  });

  it('prefers the dedicated global copilot setting', () => {
    expect(
      selectGlobalCopilotAgentName({
        globalCopilotAgentName: 'global',
        scenarioAssistantAgentName: 'scenario',
        agentNames: ['first', 'global', 'scenario']
      })
    ).toBe('global');
  });

  it('falls back to the scenario assistant, then the first agent', () => {
    expect(
      selectGlobalCopilotAgentName({
        scenarioAssistantAgentName: 'scenario',
        agentNames: ['first', 'scenario']
      })
    ).toBe('scenario');
    expect(selectGlobalCopilotAgentName({ agentNames: ['first'] })).toBe('first');
  });

  it('only offers navigation to supported MCPLab routes', () => {
    expect(GLOBAL_COPILOT_FRONTEND_TOOLS).toEqual([
      expect.objectContaining({ name: 'navigate_to_view' })
    ]);
    expect(JSON.stringify(GLOBAL_COPILOT_FRONTEND_TOOLS)).not.toContain('http://');
  });

  it('only treats direct requests to open a view as navigation', () => {
    expect(
      isExplicitGlobalCopilotNavigationRequest([
        { role: 'user', content: 'When was the last run for Tag Profile and was it successful?' }
      ])
    ).toBe(false);
    expect(
      isExplicitGlobalCopilotNavigationRequest([
        { role: 'user', content: 'Go to the evaluations list.' }
      ])
    ).toBe(true);
  });

  it('converts persisted AG-UI tool results into plain history context', () => {
    expect(
      toGlobalCopilotLlmMessages({
        messages: [
          { id: 'assistant-1', role: 'assistant', content: 'I will inspect the run.' },
          {
            id: 'tool-1',
            role: 'tool',
            toolCallId: 'toolu_previous_run',
            content: '{"status":"failed"}'
          }
        ]
      } as any)
    ).toEqual([
      { role: 'assistant', content: 'I will inspect the run.' },
      {
        role: 'system',
        content: 'Previously retrieved MCPLab tool data:\n{"status":"failed"}'
      }
    ]);
  });

  it('only scopes external MCP servers to the active test case', () => {
    const libraries = {
      servers: {
        weather: { transport: 'http', url: 'http://weather.test/mcp' },
        finance: { transport: 'http', url: 'http://finance.test/mcp' }
      },
      scenarios: [
        { id: 'weather-case', mcp_servers: [{ ref: 'weather' }] },
        { id: 'finance-case', mcp_servers: [{ ref: 'finance' }] }
      ]
    } as any;

    expect(Object.keys(globalCopilotExternalServers(libraries, 'weather-case'))).toEqual([
      'weather'
    ]);
    expect(globalCopilotExternalServers(libraries, undefined)).toEqual({});
  });

  it('only offers start actions explicitly published by the active page', () => {
    expect(globalCopilotFrontendTools({ availableActions: [] }).map((tool) => tool.name)).toEqual([
      'navigate_to_view'
    ]);
    expect(
      globalCopilotFrontendTools({ availableActions: ['start_tool_analysis'] }).map(
        (tool) => tool.name
      )
    ).toEqual(['navigate_to_view', 'start_tool_analysis']);
  });
});
