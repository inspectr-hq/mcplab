import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeDefinition, AssistantRuntimeFactory } from '@inspectr/mcplab-core';

const mocked = vi.hoisted(() => ({ graphModuleEvaluated: vi.fn(), graphFactory: vi.fn() }));
vi.mock('./assistant-runtime.js', () => ({ createNativeAssistantRuntimeFactory: vi.fn() }));
vi.mock('./langchain-assistant-runtime.js', () => {
  mocked.graphModuleEvaluated();
  return { createLangChainAssistantRuntimeFactory: mocked.graphFactory };
});

import { createNativeAssistantRuntimeFactory } from './assistant-runtime.js';

const native = { create: vi.fn(async () => ({}) as any) } as AssistantRuntimeFactory;
const graph = { create: vi.fn(async () => ({}) as any) } as AssistantRuntimeFactory;

describe('assistant runtime selection', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(createNativeAssistantRuntimeFactory).mockReturnValue(native);
    mocked.graphFactory.mockReturnValue(graph);
  });

  async function select(options: { result?: string; scenario?: string }) {
    const { selectAssistantRuntime } = await import('./assistant-runtime-selection.js');
    return selectAssistantRuntime(options);
  }

  it('defaults both assistants to native without evaluating LangGraph', async () => {
    const selected = await select({});
    expect(selected).toEqual({ factory: native, modes: { result: 'native', scenario: 'native' } });
    expect(mocked.graphModuleEvaluated).not.toHaveBeenCalled();
    expect(mocked.graphFactory).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['blank', '  '],
    ['explicit native', 'native'],
    ['trimmed native', ' native ']
  ])('treats %s selection as native', async (_label, mode) => {
    expect(await select({ result: mode, scenario: mode })).toEqual({
      factory: native,
      modes: { result: 'native', scenario: 'native' }
    });
    expect(mocked.graphModuleEvaluated).not.toHaveBeenCalled();
  });

  it.each([
    ['Result only', { result: ' langgraph ', scenario: 'native' }, 'result'],
    ['Scenario only', { result: 'native', scenario: 'langgraph' }, 'scenario'],
    ['both', { result: 'langgraph', scenario: 'langgraph' }, 'both']
  ] as const)(
    'loads one graph factory and dispatches %s independently',
    async (_label, options, selection) => {
      const selected = await select(options);
      const dispatcher = selected.factory;
      expect(selected.modes.result).toBe(
        selection === 'result' || selection === 'both' ? 'langgraph' : 'native'
      );
      expect(selected.modes.scenario).toBe(
        selection === 'scenario' || selection === 'both' ? 'langgraph' : 'native'
      );
      const scenario = { assistant: 'scenario' } as AssistantRuntimeDefinition;
      const result = { assistant: 'result' } as AssistantRuntimeDefinition;
      await dispatcher.create(scenario);
      await dispatcher.create(result);
      if (selection === 'result') expect(mocked.graphModuleEvaluated).toHaveBeenCalledOnce();
      expect(mocked.graphFactory).toHaveBeenCalledOnce();
      expect(native.create).toHaveBeenCalledTimes(
        selection === 'scenario' ? 1 : selection === 'both' ? 0 : 1
      );
      expect(graph.create).toHaveBeenCalledTimes(
        selection === 'result' ? 1 : selection === 'both' ? 2 : 1
      );
      if (selection === 'result') {
        expect(graph.create).toHaveBeenCalledWith(result);
        expect(native.create).toHaveBeenCalledWith(scenario);
      }
      if (selection === 'scenario') {
        expect(graph.create).toHaveBeenCalledWith(scenario);
        expect(native.create).toHaveBeenCalledWith(result);
      }
      if (selection === 'both') {
        expect(graph.create).toHaveBeenNthCalledWith(1, scenario);
        expect(graph.create).toHaveBeenNthCalledWith(2, result);
      }
    }
  );

  it('allows independent rollback to native', async () => {
    const { factory: dispatcher } = await select({ result: 'langgraph', scenario: 'native' });
    await dispatcher.create({ assistant: 'scenario' } as AssistantRuntimeDefinition);
    await dispatcher.create({ assistant: 'result' } as AssistantRuntimeDefinition);
    expect(native.create).toHaveBeenCalledOnce();
    expect(graph.create).toHaveBeenCalledOnce();
  });

  it('keeps the reported modes and dispatch stable after the input options change', async () => {
    const options = { result: 'langgraph', scenario: 'native' };
    const selected = await select(options);
    options.result = 'native';
    await selected.factory.create({ assistant: 'result' } as AssistantRuntimeDefinition);
    expect(selected.modes).toEqual({ result: 'langgraph', scenario: 'native' });
    expect(graph.create).toHaveBeenCalledOnce();
  });

  it.each([
    ['result', { result: 'other' }, 'MCPLAB_RESULT_ASSISTANT_RUNTIME'],
    ['scenario', { scenario: 'other' }, 'MCPLAB_SCENARIO_ASSISTANT_RUNTIME'],
    [
      'invalid result paired with graph',
      { result: 'bad', scenario: 'langgraph' },
      'MCPLAB_RESULT_ASSISTANT_RUNTIME'
    ],
    [
      'invalid scenario paired with graph',
      { result: 'langgraph', scenario: 'bad' },
      'MCPLAB_SCENARIO_ASSISTANT_RUNTIME'
    ]
  ] as const)('rejects %s before loading LangGraph', async (_label, options, variable) => {
    await expect(select(options)).rejects.toThrow(variable);
    expect(mocked.graphModuleEvaluated).not.toHaveBeenCalled();
  });

  it('rejects the former langchain value and names the supported values', async () => {
    await expect(select({ result: 'langchain' })).rejects.toThrow(
      "MCPLAB_RESULT_ASSISTANT_RUNTIME 'langchain', expected 'native' or 'langgraph'"
    );
    expect(mocked.graphModuleEvaluated).not.toHaveBeenCalled();
  });
});
