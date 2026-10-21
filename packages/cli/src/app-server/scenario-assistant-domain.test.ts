import { describe, expect, it, vi } from 'vitest';
import {
  setupScenarioAssistantSession,
  normalizeScenarioAssistantEvalRules,
  validateScenarioAssistantProposal,
  type ScenarioAssistantSessionInitializer
} from './scenario-assistant-domain.js';
import { createScriptedRuntimeFactory } from '../../test-support/scripted-chat-model.js';
import { McpClientManager } from '@inspectr/mcplab-core';
import type { AssistantRuntimeDefinition } from './assistant-runtime-contract.js';

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
          cancel: vi.fn().mockResolvedValue(undefined),
          getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
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
          cancel: vi.fn().mockResolvedValue(undefined),
          getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
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
  expect(session.runtime.getSnapshot()).toEqual({
    revision: 0,
    messages: [],
    pendingToolCalls: []
  });
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
              cancel: vi.fn().mockResolvedValue(undefined),
              getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
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
    expect(prompt).toContain('Read-only tools run immediately');
    expect(prompt).not.toContain('up to three external tool calls');
    expect(prompt).not.toContain('call a tool and wait for approval');
    expect(prompt).not.toContain('Respond ONLY as JSON');
    expect(definition.tools.some((tool) => tool.name === 'propose_scenario_changes')).toBe(true);
  });

  it('offers MCP resources and prompts as automatically approved tools when servers advertise them', async () => {
    const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    const listTools = vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([]);
    const features = vi
      .spyOn(McpClientManager.prototype, 'getServerFeatures')
      .mockImplementation((server: string) => ({
        tools: true,
        resources: server === 'docs',
        prompts: server === 'docs'
      }));
    try {
      let definition: AssistantRuntimeDefinition | undefined;
      await setupScenarioAssistantSession({
        session: baseSession(),
        agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        context: {
          scenario: {
            id: 'scn-1',
            prompt: 'Prompt',
            serverNames: ['docs', 'plain'],
            evalRules: [],
            extractRules: []
          }
        },
        serversByName: {
          docs: { transport: 'http', url: 'https://docs.example/mcp' },
          plain: { transport: 'http', url: 'https://plain.example/mcp' }
        },
        selectedServerNames: ['docs', 'plain'],
        assistantRuntimeFactory: {
          create: async (runtimeDefinition) => {
            definition = runtimeDefinition;
            return {
              sendMessage: async () => ({ type: 'assistant_message', text: '' }),
              resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
              cancel: vi.fn().mockResolvedValue(undefined),
              getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
              dispose: async () => {}
            };
          }
        },
        onEvent: () => {},
        onActivity: () => {}
      });
      const names = definition!.tools.map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'list_mcp_resources',
          'read_mcp_resource',
          'list_mcp_prompts',
          'get_mcp_prompt'
        ])
      );
      expect(definition!.approvalPolicy('read_mcp_resource')).toBe('automatic');
      expect(definition!.approvalPolicy('get_mcp_prompt')).toBe('automatic');
      const prompt = definition!.getSystemPrompt();
      expect(prompt).toContain('MCP resources are available from: docs');
      expect(prompt).not.toContain('available from: docs, plain');
    } finally {
      connectAll.mockRestore();
      listTools.mockRestore();
      features.mockRestore();
    }
  });

  it('keeps the tools of a server whose resources and prompts cannot be detected', async () => {
    const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    const listTools = vi
      .spyOn(McpClientManager.prototype, 'listTools')
      .mockResolvedValue([{ name: 'lookup', inputSchema: { type: 'object' } }]);
    const features = vi
      .spyOn(McpClientManager.prototype, 'getServerFeatures')
      .mockImplementation(() => {
        throw new Error('capabilities unavailable');
      });
    try {
      const session = baseSession();
      let definition: AssistantRuntimeDefinition | undefined;
      await setupScenarioAssistantSession({
        session,
        agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        context: {
          scenario: {
            id: 'scn-1',
            prompt: 'P',
            serverNames: ['docs'],
            evalRules: [],
            extractRules: []
          }
        },
        serversByName: { docs: { transport: 'http', url: 'https://docs.example/mcp' } },
        selectedServerNames: ['docs'],
        assistantRuntimeFactory: {
          create: async (runtimeDefinition) => {
            definition = runtimeDefinition;
            return {
              sendMessage: async () => ({ type: 'assistant_message', text: '' }),
              resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
              cancel: vi.fn().mockResolvedValue(undefined),
              getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
              dispose: async () => {}
            };
          }
        },
        onEvent: () => {},
        onActivity: () => {}
      });
      expect(definition!.tools.map((tool) => tool.name)).toContain('docs__lookup');
      expect(definition!.tools.map((tool) => tool.name)).not.toContain('list_mcp_resources');
      expect(session.warnings).toEqual([]);
    } finally {
      connectAll.mockRestore();
      listTools.mockRestore();
      features.mockRestore();
    }
  });

  it('offers resources from servers whose tools are missing or fail to load', async () => {
    const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    const listTools = vi
      .spyOn(McpClientManager.prototype, 'listTools')
      .mockRejectedValue(new Error('Method not found'));
    const features = vi
      .spyOn(McpClientManager.prototype, 'getServerFeatures')
      .mockImplementation((server: string) => ({
        tools: server === 'broken',
        resources: true,
        prompts: false
      }));
    try {
      const session = baseSession();
      let definition: AssistantRuntimeDefinition | undefined;
      await setupScenarioAssistantSession({
        session,
        agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        context: {
          scenario: {
            id: 'scn-1',
            prompt: 'P',
            serverNames: ['docs', 'broken'],
            evalRules: [],
            extractRules: []
          }
        },
        serversByName: {
          docs: { transport: 'http', url: 'https://docs.example/mcp' },
          broken: { transport: 'http', url: 'https://broken.example/mcp' }
        },
        selectedServerNames: ['docs', 'broken'],
        assistantRuntimeFactory: {
          create: async (runtimeDefinition) => {
            definition = runtimeDefinition;
            return {
              sendMessage: async () => ({ type: 'assistant_message', text: '' }),
              resolveToolCalls: async () => ({ type: 'assistant_message', text: '' }),
              cancel: vi.fn().mockResolvedValue(undefined),
              getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [] }),
              dispose: async () => {}
            };
          }
        },
        onEvent: () => {},
        onActivity: () => {}
      });
      // The resource-only server is not asked for tools; the failing one keeps its resources.
      expect(listTools.mock.calls.map(([server]) => server)).toEqual(['broken']);
      expect(definition!.tools.map((tool) => tool.name)).toContain('read_mcp_resource');
      expect(definition!.getSystemPrompt()).toContain(
        'MCP resources are available from: docs, broken'
      );
      expect(session.warnings).toHaveLength(1);
      expect(session.warnings[0]).toContain('broken');
    } finally {
      connectAll.mockRestore();
      listTools.mockRestore();
      features.mockRestore();
    }
  });

  it('offers no MCP context tools when no selected server has resources or prompts', async () => {
    const definition = await createDefinition();
    expect(definition.tools.map((tool) => tool.name)).not.toContain('list_mcp_resources');
    expect(definition.getSystemPrompt()).not.toContain('MCP resources are available');
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

  it('maps each tool alternative to its raw name and rejects malformed groups', () => {
    const output = validateScenarioAssistantProposal(
      {
        evalRules: {
          replacement: [
            { type: 'required_tool', value: 'srv__search | lookup' },
            { type: 'tool_sequence', sequence: ['srv__search | lookup', 'search'] }
          ]
        }
      },
      new Map([['srv__search', { server: 'srv', tool: 'search' }]])
    );
    expect(output.evalRules?.replacement).toEqual([
      { type: 'required_tool', value: 'search|lookup' },
      { type: 'tool_sequence', sequence: ['search|lookup', 'search'] }
    ]);
    expect(() =>
      validateScenarioAssistantProposal(
        { evalRules: { replacement: [{ type: 'required_tool', value: 'search |' }] } },
        new Map()
      )
    ).toThrow(/non-empty and unique/);
  });

  it('omits unchanged placeholders while preserving proposed checks', () => {
    const evalRules = { replacement: [{ type: 'response_contains', value: 'answer' }] };
    expect(
      validateScenarioAssistantProposal({ prompt: null, extractRules: {}, evalRules }, new Map())
    ).toEqual({ evalRules });
  });

  it('rejects placeholder-only changes even when notes are supplied', () => {
    expect(() =>
      validateScenarioAssistantProposal({ prompt: '', notes: ['x'] }, new Map())
    ).toThrow('must include at least one change');
  });

  it.each(['evalRules', 'extractRules'])('preserves explicit removal of all %s', (field) => {
    const proposal = { [field]: { replacement: [] } };
    expect(validateScenarioAssistantProposal(proposal, new Map())).toEqual(proposal);
  });

  it('rejects an explicitly empty replacement prompt', () => {
    expect(() =>
      validateScenarioAssistantProposal({ prompt: { replacement: '' } }, new Map())
    ).toThrow('prompt.replacement');
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
    [
      { evalRules: { replacement: [{ type: 'tool_sequence', sequence: ['lookup', '  '] }] } },
      'evalRules.replacement[0].sequence'
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
    const runtime = await createScriptedRuntimeFactory(async (_definition, messages) => {
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
