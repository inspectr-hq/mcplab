import { describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeDefinition } from '@inspectr/mcplab-core';
import {
  setupScenarioAssistantSession,
  normalizeScenarioAssistantEvalRules,
  validateScenarioAssistantProposal,
  type ScenarioAssistantSessionInitializer
} from './scenario-assistant-domain.js';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';
import { McpClientManager } from '@inspectr/mcplab-core';

function baseSession(): ScenarioAssistantSessionInitializer {
  return {
    id: 'sas-1',
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
    selectedAssistantAgentName: 'assistant-1',
    model: 'gpt-4o-mini',
    provider: 'openai',
    toolsLoaded: 0,
    toolServers: [],
    events: [],
    clients: new Set(),
    initialMessages: [],
    warnings: []
  };
}

async function createDefinition(): Promise<AssistantRuntimeDefinition> {
  let definition: AssistantRuntimeDefinition | undefined;
  await setupScenarioAssistantSession({
    session: baseSession(),
    agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
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
    serversByName: {},
    selectedServerNames: [],
    assistantRuntimeFactory: {
      create: async (runtimeDefinition) => {
        definition = runtimeDefinition;
        return {
          sendMessage: async () => ({ type: 'assistant_message', text: '' }),
          resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
          getSnapshot: () => ({ messages: [], pendingToolCalls: [] }),
          isBusy: () => false,
          dispose: async () => {}
        };
      }
    },
    onEvent: () => {},
    onActivity: () => {}
  });
  return definition!;
}

it('publishes factory-time Scenario events with a finalized runtime session', async () => {
  const observed: Array<{ type: string; session: ScenarioAssistantSessionInitializer }> = [];
  const initializer = baseSession();
  let emitLateEvent: NonNullable<AssistantRuntimeDefinition['onEvent']> | undefined;
  const session = await setupScenarioAssistantSession({
    session: initializer,
    agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
    context: {
      scenario: {
        id: 'scn-1',
        prompt: 'Prompt',
        serverNames: [],
        evalRules: [],
        extractRules: []
      }
    },
    serversByName: {},
    selectedServerNames: [],
    assistantRuntimeFactory: {
      create: async (definition) => {
        emitLateEvent = definition.onEvent;
        definition.onEvent?.({
          type: 'session_warning',
          ts: new Date().toISOString(),
          payload: { warning: 'startup' }
        });
        return {
          sendMessage: async () => ({ type: 'assistant_message', text: '' }),
          resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
          getSnapshot: () => ({ messages: [], pendingToolCalls: [] }),
          isBusy: () => false,
          dispose: async () => {}
        };
      }
    },
    onEvent: (event, readySession) => {
      observed.push({ type: event.type, session: readySession });
    },
    onActivity: () => {}
  });
  expect(session).toBe(initializer);
  expect(observed).toEqual([{ type: 'session_warning', session }]);
  emitLateEvent?.({
    type: 'session_warning',
    ts: new Date().toISOString(),
    payload: { warning: 'later' }
  });
  expect(observed).toEqual([
    { type: 'session_warning', session },
    { type: 'session_warning', session }
  ]);
  expect(session.runtime.getSnapshot()).toEqual({ messages: [], pendingToolCalls: [] });
});

it('disposes the Scenario runtime and MCP client when a startup observer throws', async () => {
  const runtimeDispose = vi.fn();
  const disconnectAll = vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
  try {
    await expect(
      setupScenarioAssistantSession({
        session: baseSession(),
        agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        context: {
          scenario: {
            id: 'scn-1',
            prompt: 'Prompt',
            serverNames: [],
            evalRules: [],
            extractRules: []
          }
        },
        serversByName: {},
        selectedServerNames: [],
        assistantRuntimeFactory: {
          create: async (definition) => {
            definition.onEvent?.({
              type: 'session_warning',
              ts: new Date().toISOString(),
              payload: { warning: 'startup' }
            });
            return {
              sendMessage: async () => ({ type: 'assistant_message', text: '' }),
              resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
              getSnapshot: () => ({ messages: [], pendingToolCalls: [] }),
              isBusy: () => false,
              dispose: runtimeDispose
            };
          }
        },
        onEvent: () => {
          throw new Error('observer failed');
        },
        onActivity: () => {}
      })
    ).rejects.toThrow('observer failed');
    expect(runtimeDispose).toHaveBeenCalledOnce();
    expect(disconnectAll).toHaveBeenCalledOnce();
  } finally {
    disconnectAll.mockRestore();
  }
});

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
  it('keeps scenario authoring guidance in the dynamic system prompt', async () => {
    const definition = await createDefinition();
    const prompt = definition.getSystemPrompt();
    expect(prompt).toContain('Optional checks you may suggest when useful');
    expect(prompt).toContain('tool_sequence');
    expect(prompt).toContain('agent_check');
    expect(prompt).toContain('tool_input_regex to match a regular expression anywhere');
    expect(prompt).toContain('ordinary prose');
    expect(prompt).toContain('up to three external tool calls');
    expect(prompt).toContain('per batch');
    expect(prompt).toContain('including read calls');
    expect(prompt).not.toContain('call a tool and wait for approval');
    expect(prompt).not.toContain('Respond ONLY as JSON');
    expect(definition.tools.some((tool) => tool.name === 'propose_scenario_changes')).toBe(true);
  });

  it('normalizes tool names and redundant regex suggestions in native proposals', () => {
    const output = validateScenarioAssistantProposal(
      {
        evalRules: {
          replacement: [
            { type: 'required_tool', value: 'srv__refund_tool' },
            { type: 'response_contains', value: 'refund processed' },
            { type: 'response_regex', value: 'refund processed' }
          ]
        }
      },
      new Map([['srv__refund_tool', { server: 'srv', tool: 'refund_tool' }]])
    );
    expect(output.evalRules?.replacement).toEqual([
      { type: 'required_tool', value: 'refund_tool' },
      { type: 'response_contains', value: 'refund processed' }
    ]);
  });

  it('normalizes sequence and tool-input names and removes contradictory rules', () => {
    const output = validateScenarioAssistantProposal(
      {
        evalRules: {
          replacement: [
            { type: 'tool_sequence', sequence: ['srv__refund_tool', 'search_tags'] },
            { type: 'tool_input_contains', tool: ' srv__refund_tool ', value: 'Paris' },
            { type: 'required_tool', value: 'srv__refund_tool' },
            { type: 'forbidden_tool', value: 'srv__refund_tool' }
          ]
        }
      },
      new Map([['srv__refund_tool', { server: 'srv', tool: 'refund_tool' }]])
    );
    expect(output.evalRules?.replacement).toEqual([
      { type: 'tool_sequence', sequence: ['refund_tool', 'search_tags'] },
      { type: 'tool_input_contains', tool: 'refund_tool', value: 'Paris' },
      { type: 'required_tool', value: 'refund_tool' }
    ]);
  });

  it('returns corrective validation errors for malformed or empty proposals', () => {
    expect(() =>
      validateScenarioAssistantProposal(
        { evalRules: { replacement: [{ type: 'unknown' }] } },
        new Map()
      )
    ).toThrow('Invalid scenario proposal');
    expect(() => validateScenarioAssistantProposal({}, new Map())).toThrow(
      'Invalid scenario proposal'
    );
    expect(() => validateScenarioAssistantProposal({ notes: ['only a note'] }, new Map())).toThrow(
      'Invalid scenario proposal'
    );
    expect(() =>
      validateScenarioAssistantProposal(
        { evalRules: { replacement: [{ type: 'required_tool' }] } },
        new Map()
      )
    ).toThrow('Invalid scenario proposal');
  });

  it.each([
    [{ surprise: true }, 'proposal.surprise'],
    [{ '': true }, 'proposal.'],
    [
      { evalRules: { replacement: [{ type: 'agent_check', prompt: 'Check' }] } },
      'evalRules.replacement[0].label'
    ],
    [
      { evalRules: { replacement: [{ type: 'response_contains', value: 4 }] } },
      'evalRules.replacement[0].value'
    ],
    [{ extractRules: { replacement: [{ name: 'tag' }] } }, 'extractRules.replacement[0].pattern'],
    [{ notes: ['ok', 1] }, 'notes[1]']
  ])('reports the JSON path for invalid proposal fields', (proposal, path) => {
    expect(() => validateScenarioAssistantProposal(proposal, new Map())).toThrow(path);
  });

  it('returns detailed proposal paths to the model as LangGraph tool feedback', async () => {
    const histories: Array<Array<{ role: string; content: string }>> = [];
    let round = 0;
    const definition = await createDefinition();
    const runtime = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
      histories.push(
        messages.map((message) => ({ role: message.getType(), content: String(message.content) }))
      );
      round += 1;
      return round === 1
        ? {
            type: 'tool_call_request',
            text: '',
            toolCalls: [
              {
                id: 'invalid-proposal',
                name: 'propose_scenario_changes',
                arguments: {
                  evalRules: { replacement: [{ type: 'agent_check', prompt: 'Check' }] }
                }
              }
            ]
          }
        : { type: 'assistant_message', text: 'I will add the missing label.' };
    }).create(definition);

    const result = await runtime.sendMessage('Add a semantic check');
    expect(result).toMatchObject({
      type: 'assistant_message',
      text: 'I will add the missing label.'
    });
    expect(JSON.parse(histories[1]!.at(-1)!.content)).toMatchObject({
      error: expect.stringContaining('evalRules.replacement[0].label')
    });
  });
});
