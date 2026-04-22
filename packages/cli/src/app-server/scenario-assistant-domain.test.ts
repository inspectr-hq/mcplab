import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentConfig } from '@inspectr/mcplab-core';
import {
  continueAssistantTurn,
  normalizeScenarioAssistantEvalRules,
  type ScenarioAssistantSession
} from './scenario-assistant-domain.js';

const { chatWithJsonRetryMock } = vi.hoisted(() => ({
  chatWithJsonRetryMock: vi.fn()
}));

vi.mock('./assistant-common.js', async () => {
  const actual = await vi.importActual<typeof import('./assistant-common.js')>(
    './assistant-common.js'
  );
  return {
    ...actual,
    chatWithJsonRetry: chatWithJsonRetryMock
  };
});

function baseSession(): ScenarioAssistantSession {
  return {
    id: 'sas-1',
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
    selectedAssistantAgentName: 'assistant-1',
    context: {
      scenario: {
        id: 'scn-1',
        name: 'Scenario 1',
        prompt: 'Prompt',
        serverNames: ['srv'],
        evalRules: [],
        extractRules: []
      }
    },
    agentConfig: { provider: 'openai', model: 'gpt-4o-mini' } as AgentConfig,
    mcp: {} as any,
    tools: [],
    toolPublicMap: new Map([['srv__refund_tool', { server: 'srv', tool: 'refund_tool' }]]),
    pendingToolCalls: [],
    chatMessages: [],
    llmMessages: [],
    warnings: []
  };
}

describe('normalizeScenarioAssistantEvalRules', () => {
  it('converts simple regex to response_contains', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_regex', value: 'refund processed' }
    ]);
    expect(result).toEqual([{ type: 'response_contains', value: 'refund processed' }]);
  });

  it('converts anchored literal regex to response_equals', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_regex', value: '^refund processed$' }
    ]);
    expect(result).toEqual([{ type: 'response_equals', value: 'refund processed' }]);
  });

  it('keeps complex regex unchanged', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_regex', value: 'refund\\s+(processed|completed)' }
    ]);
    expect(result).toEqual([{ type: 'response_regex', value: 'refund\\s+(processed|completed)' }]);
  });

  it('removes redundant regex when equivalent literal check exists', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: 'refund processed' },
      { type: 'response_regex', value: 'refund processed' }
    ]);
    expect(result).toEqual([{ type: 'response_contains', value: 'refund processed' }]);
  });

  it('deduplicates exact duplicate checks in deterministic order', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: 'ok' },
      { type: 'response_contains', value: 'ok' },
      { type: 'response_jsonpath_exists', path: '$.id' },
      { type: 'response_jsonpath_exists', path: '$.id' }
    ]);
    expect(result).toEqual([
      { type: 'response_contains', value: 'ok' },
      { type: 'response_jsonpath_exists', path: '$.id' }
    ]);
  });

  it('collapses off-by-one count guard checks into one explicit positive check', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: '9' },
      { type: 'response_not_contains', value: '10 tags' },
      { type: 'response_not_contains', value: '8 tags' }
    ]);
    expect(result).toEqual([{ type: 'response_contains', value: '9 tags' }]);
  });

  it('keeps non-adjacent count guard negatives when no off-by-one pair exists', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: '9' },
      { type: 'response_not_contains', value: '11 tags' },
      { type: 'response_not_contains', value: '8 tags' }
    ]);
    expect(result).toEqual([
      { type: 'response_contains', value: '9' },
      { type: 'response_not_contains', value: '11 tags' },
      { type: 'response_not_contains', value: '8 tags' }
    ]);
  });

  it('deduplicates same intent by keeping stronger positive literal check', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: 'Refund   Processed' },
      { type: 'response_equals', value: 'refund processed' }
    ]);
    expect(result).toEqual([{ type: 'response_equals', value: 'refund processed' }]);
  });

  it('deduplicates overlapping response_contains checks by keeping the broader phrase', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: 'found 9 tags' },
      { type: 'response_contains', value: '9 tags' }
    ]);
    expect(result).toEqual([{ type: 'response_contains', value: '9 tags' }]);
  });

  it('drops contradictory response_not_contains when a positive literal intent exists', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: 'refund processed' },
      { type: 'response_not_contains', value: 'Refund   Processed' }
    ]);
    expect(result).toEqual([{ type: 'response_contains', value: 'refund processed' }]);
  });

  it('drops forbidden_tool when same tool is also required', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'required_tool', value: 'search_tags' },
      { type: 'forbidden_tool', value: 'search_tags' }
    ]);
    expect(result).toEqual([{ type: 'required_tool', value: 'search_tags' }]);
  });

  it('drops response_jsonpath_not_exists when same path is marked exists', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_jsonpath_exists', path: '$.count' },
      { type: 'response_jsonpath_not_exists', path: '$.count' }
    ]);
    expect(result).toEqual([{ type: 'response_jsonpath_exists', path: '$.count' }]);
  });
});

describe('continueAssistantTurn normalization integration', () => {
  beforeEach(() => {
    chatWithJsonRetryMock.mockReset();
  });

  it('applies tool-name normalization and regex preference cleanup before returning suggestions', async () => {
    chatWithJsonRetryMock.mockResolvedValue({
      type: 'assistant_message',
      text: 'Updated checks',
      suggestions: {
        evalRules: {
          replacement: [
            { type: 'required_tool', value: 'srv__refund_tool' },
            { type: 'response_contains', value: 'refund processed' },
            { type: 'response_regex', value: 'refund processed' }
          ]
        }
      }
    });
    const session = baseSession();
    const output = await continueAssistantTurn(session);
    expect(output.response.type).toBe('assistant_message');
    expect(output.response.suggestions?.evalRules?.replacement).toEqual([
      { type: 'required_tool', value: 'refund_tool' },
      { type: 'response_contains', value: 'refund processed' }
    ]);
  });

  it('keeps complex regex suggestions when no literal equivalent exists', async () => {
    chatWithJsonRetryMock.mockResolvedValue({
      type: 'assistant_message',
      text: 'Updated checks',
      suggestions: {
        evalRules: {
          replacement: [{ type: 'response_regex', value: 'refund\\s+(processed|completed)' }]
        }
      }
    });
    const session = baseSession();
    const output = await continueAssistantTurn(session);
    expect(output.response.suggestions?.evalRules?.replacement).toEqual([
      { type: 'response_regex', value: 'refund\\s+(processed|completed)' }
    ]);
  });

  it('removes brittle off-by-one negatives when a count check exists', async () => {
    chatWithJsonRetryMock.mockResolvedValue({
      type: 'assistant_message',
      text: 'Updated checks',
      suggestions: {
        evalRules: {
          replacement: [
            { type: 'response_contains', value: 'TM5-BP2' },
            { type: 'response_contains', value: '9' },
            { type: 'response_not_contains', value: '10 tags' },
            { type: 'response_not_contains', value: '8 tags' }
          ]
        }
      }
    });
    const session = baseSession();
    const output = await continueAssistantTurn(session);
    expect(output.response.suggestions?.evalRules?.replacement).toEqual([
      { type: 'response_contains', value: 'TM5-BP2' },
      { type: 'response_contains', value: '9 tags' }
    ]);
  });

  it('removes contradictions before returning assistant suggestions', async () => {
    chatWithJsonRetryMock.mockResolvedValue({
      type: 'assistant_message',
      text: 'Updated checks',
      suggestions: {
        evalRules: {
          replacement: [
            { type: 'required_tool', value: 'srv__refund_tool' },
            { type: 'forbidden_tool', value: 'srv__refund_tool' },
            { type: 'response_contains', value: 'refund processed' },
            { type: 'response_not_contains', value: 'Refund Processed' },
            { type: 'response_jsonpath_exists', path: '$.count' },
            { type: 'response_jsonpath_not_exists', path: '$.count' }
          ]
        }
      }
    });
    const session = baseSession();
    const output = await continueAssistantTurn(session);
    expect(output.response.suggestions?.evalRules?.replacement).toEqual([
      { type: 'required_tool', value: 'refund_tool' },
      { type: 'response_contains', value: 'refund processed' },
      { type: 'response_jsonpath_exists', path: '$.count' }
    ]);
  });
});
