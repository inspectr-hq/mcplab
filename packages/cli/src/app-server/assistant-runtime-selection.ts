import type { AssistantRuntimeFactory } from '@inspectr/mcplab-core';
import { createNativeAssistantRuntimeFactory } from './assistant-runtime.js';

export interface AssistantRuntimeSelectionOptions {
  result?: string;
  scenario?: string;
}

export async function selectAssistantRuntime(
  options: AssistantRuntimeSelectionOptions
): Promise<AssistantRuntimeFactory> {
  const resultMode = normalizeMode(options.result, 'MCPLAB_RESULT_ASSISTANT_RUNTIME');
  const scenarioMode = normalizeMode(options.scenario, 'MCPLAB_SCENARIO_ASSISTANT_RUNTIME');
  const native = createNativeAssistantRuntimeFactory();
  if (resultMode !== 'langchain' && scenarioMode !== 'langchain') return native;

  const { createLangChainAssistantRuntimeFactory } =
    await import('./langchain-assistant-runtime.js');
  const langchain = createLangChainAssistantRuntimeFactory();
  return {
    create(definition) {
      const mode = definition.assistant === 'result' ? resultMode : scenarioMode;
      return (mode === 'langchain' ? langchain : native).create(definition);
    }
  };
}

function normalizeMode(value: string | undefined, variable: string): 'native' | 'langchain' {
  const mode = value?.trim();
  if (!mode || mode === 'native') return 'native';
  if (mode === 'langchain') return mode;
  throw new Error(`Unsupported ${variable} '${mode}', expected 'native' or 'langchain'`);
}
