import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '@inspectr/mcplab-core';
import {
  createScenarioAssistantRuntimeDefinition,
  normalizeScenarioAssistantEvalRules,
  type ScenarioAssistantSession
} from './scenario-assistant-domain.js';

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
    initialMessages: [],
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

  it('normalizes tool_sequence entries and preserves ordered sequences', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'tool_sequence', sequence: ['  srv__refund_tool  ', 'search_tags'] }
    ]);

    expect(result).toEqual([
      { type: 'tool_sequence', sequence: ['srv__refund_tool', 'search_tags'] }
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

  it('keeps overlap dedupe stable after replacing a contains rule with a stronger literal rule', () => {
    const result = normalizeScenarioAssistantEvalRules([
      { type: 'response_contains', value: 'found 9 tags' },
      { type: 'response_equals', value: 'found 9 tags' },
      { type: 'response_contains', value: '9 tags' }
    ]);
    expect(result).toEqual([
      { type: 'response_equals', value: 'found 9 tags' },
      { type: 'response_contains', value: '9 tags' }
    ]);
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

describe('Scenario Assistant runtime definition', () => {
  it('keeps scenario authoring guidance in the dynamic system prompt', () => {
    const definition = createScenarioAssistantRuntimeDefinition(baseSession());
    const prompt = definition.getSystemPrompt();
    expect(prompt).toContain('Optional checks you may suggest when useful');
    expect(prompt).toContain('tool_sequence');
    expect(prompt).toContain('agent_check');
    expect(prompt).toContain('tool_input_regex to match a regular expression anywhere');
  });

  it('normalizes tool names and redundant regex suggestions during output decoding', () => {
    const definition = createScenarioAssistantRuntimeDefinition(baseSession());
    const output = definition.decodeOutput(JSON.stringify({
      type: 'assistant_message',
      text: 'Updated checks',
      suggestions: { evalRules: { replacement: [
        { type: 'required_tool', value: 'srv__refund_tool' },
        { type: 'response_contains', value: 'refund processed' },
        { type: 'response_regex', value: 'refund processed' }
      ] } }
    }));
    expect(output).toMatchObject({ type: 'assistant_message', text: 'Updated checks' });
    if (output.type !== 'assistant_message') throw new Error('Expected assistant message');
    expect(output.suggestions?.evalRules?.replacement).toEqual([
      { type: 'required_tool', value: 'refund_tool' },
      { type: 'response_contains', value: 'refund processed' }
    ]);
  });

  it('normalizes sequence and tool-input names and removes contradictory rules', () => {
    const definition = createScenarioAssistantRuntimeDefinition(baseSession());
    const output = definition.decodeOutput(JSON.stringify({
      type: 'assistant_message',
      text: 'Updated checks',
      suggestions: { evalRules: { replacement: [
        { type: 'tool_sequence', sequence: ['srv__refund_tool', 'search_tags'] },
        { type: 'tool_input_contains', tool: ' srv__refund_tool ', value: 'Paris' },
        { type: 'required_tool', value: 'srv__refund_tool' },
        { type: 'forbidden_tool', value: 'srv__refund_tool' }
      ] } }
    }));
    if (output.type !== 'assistant_message') throw new Error('Expected assistant message');
    expect(output.suggestions?.evalRules?.replacement).toEqual([
      { type: 'tool_sequence', sequence: ['refund_tool', 'search_tags'] },
      { type: 'tool_input_contains', tool: 'refund_tool', value: 'Paris' },
      { type: 'required_tool', value: 'refund_tool' }
    ]);
  });
});
