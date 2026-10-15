import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeModelOutput,
  LlmMessage,
  ToolDef
} from '@inspectr/mcplab-core';
import { chatWithAgent } from '@inspectr/mcplab-core';

export type AssistantModelCall = (
  definition: AssistantRuntimeDefinition,
  messages: LlmMessage[],
  signal?: AbortSignal
) => Promise<AssistantRuntimeModelOutput>;

export const callAssistantModel: AssistantModelCall = async (definition, messages, signal) => {
  const tools = definition.tools.map((tool): ToolDef => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema
  }));
  const response = await chatWithAgent({
    agent: definition.agent,
    messages,
    tools,
    system: definition.getSystemPrompt(),
    signal
  });
  if (response.tool_calls?.length)
    return {
      type: 'tool_call_request',
      text: response.content?.trim() || 'I need a tool to help answer.',
      toolCalls: response.tool_calls.map(({ id, name, arguments: args }) => ({
        id,
        name,
        arguments: args
      }))
    };
  return { type: 'assistant_message', text: response.content?.trim() ?? '' };
};
