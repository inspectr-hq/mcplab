import type { AssistantRuntimeFactory } from '@inspectr/mcplab-core';
import { createNativeAssistantRuntimeFactory } from './assistant-runtime.js';

export interface AssistantRuntimeSelectionOptions {
  result?: string;
  scenario?: string;
}

export interface AssistantRuntimeSelection {
  factory: AssistantRuntimeFactory;
  modes: { result: 'native' | 'langgraph'; scenario: 'native' | 'langgraph' };
}

export async function selectAssistantRuntime(
  options: AssistantRuntimeSelectionOptions
): Promise<AssistantRuntimeSelection> {
  const resultMode = normalizeMode(options.result, 'MCPLAB_RESULT_ASSISTANT_RUNTIME');
  const scenarioMode = normalizeMode(options.scenario, 'MCPLAB_SCENARIO_ASSISTANT_RUNTIME');
  const native = createNativeAssistantRuntimeFactory();
  const modes = { result: resultMode, scenario: scenarioMode };
  if (resultMode !== 'langgraph' && scenarioMode !== 'langgraph') return { factory: native, modes };

  const { createLangChainAssistantRuntimeFactory } =
    await import('./langchain-assistant-runtime.js');
  const langgraph = createLangChainAssistantRuntimeFactory();
  return {
    modes,
    factory: {
      create(definition) {
        const mode = definition.assistant === 'result' ? resultMode : scenarioMode;
        return (mode === 'langgraph' ? langgraph : native).create(definition);
      }
    }
  };
}

function normalizeMode(value: string | undefined, variable: string): 'native' | 'langgraph' {
  const mode = value?.trim();
  if (!mode || mode === 'native') return 'native';
  if (mode === 'langgraph') return mode;
  throw new Error(`Unsupported ${variable} '${mode}', expected 'native' or 'langgraph'`);
}
