import { describe, expect, it } from 'vitest';
import {
  GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE,
  GLOBAL_COPILOT_NAVIGATION_TARGETS,
  globalCopilotExternalServers,
  globalCopilotMcplabToolPolicy,
  globalCopilotMcpToolErrorMessage,
  globalCopilotMcpToolPayload,
  globalCopilotSystemPrompt,
  selectGlobalCopilotAgentName
} from './global-copilot-domain.js';

describe('Global Copilot domain policy', () => {
  it('prefers structured MCP payloads so metadata remains visible to Copilot', () => {
    expect(
      globalCopilotMcpToolPayload({
        content: [{ type: 'text', text: 'protocol envelope' }],
        structuredContent: {
          test_cases: [{ id: 'latest', created_at: '2026-08-09T10:00:00.000Z' }]
        }
      })
    ).toEqual({
      test_cases: [{ id: 'latest', created_at: '2026-08-09T10:00:00.000Z' }]
    });
  });

  it('turns MCP error content into a failed tool result', () => {
    expect(
      globalCopilotMcpToolErrorMessage({
        isError: true,
        content: [{ type: 'text', text: 'Error: Evaluation Judge is missing' }]
      })
    ).toBe('Error: Evaluation Judge is missing');
  });

  it('preserves the five-call automatic read batch', () => {
    expect(GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE).toBe(5);
  });

  it('auto-approves reads and generators, confirms selected writes, and hides other writes', () => {
    expect(globalCopilotMcplabToolPolicy('mcplab_validate_config')).toEqual({ expose: true, automatic: true });
    expect(globalCopilotMcplabToolPolicy('mcplab_generate_scenario_entry')).toEqual({ expose: true, automatic: true });
    expect(globalCopilotMcplabToolPolicy('mcplab_write_markdown_report')).toEqual({ expose: true, automatic: false });
    expect(globalCopilotMcplabToolPolicy('mcplab_create_evaluation_config')).toEqual({ expose: true, automatic: false });
    expect(globalCopilotMcplabToolPolicy('mcplab_run_eval')).toEqual({ expose: false, automatic: false });
    expect(globalCopilotMcplabToolPolicy('mcplab_delete_tool_analysis_result')).toEqual({ expose: false, automatic: false });
  });

  it('prefers the dedicated Global Copilot setting and preserves fallbacks', () => {
    expect(
      selectGlobalCopilotAgentName({
        globalCopilotAgentName: 'global',
        scenarioAssistantAgentName: 'scenario',
        agentNames: ['first', 'global', 'scenario']
      })
    ).toBe('global');
    expect(
      selectGlobalCopilotAgentName({
        scenarioAssistantAgentName: 'scenario',
        agentNames: ['first', 'scenario']
      })
    ).toBe('scenario');
    expect(selectGlobalCopilotAgentName({ agentNames: ['first'] })).toBe('first');
  });

  it('keeps navigation instructions and context in the Mastra system prompt', () => {
    expect(GLOBAL_COPILOT_NAVIGATION_TARGETS).toContain('/oauth-debugger');
    expect(globalCopilotSystemPrompt({ currentView: 'Tool Analysis' })).toContain(
      '"currentView":"Tool Analysis"'
    );
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

    expect(Object.keys(globalCopilotExternalServers(libraries, 'weather-case'))).toEqual(['weather']);
    expect(globalCopilotExternalServers(libraries, undefined)).toEqual({});
  });

  it('includes servers referenced by the scenario editor context', () => {
    const libraries = {
      servers: { weather: { transport: 'http', url: 'http://weather.test/mcp' } },
      scenarios: []
    } as any;

    expect(
      Object.keys(
        globalCopilotExternalServers(libraries, undefined, {
          scenarios: [{ serverIds: ['weather'] }]
        })
      )
    ).toEqual(['weather']);
  });
});
