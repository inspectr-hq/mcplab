import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeModelOutput
} from '@inspectr/mcplab-core';
import { createLangChainAssistantRuntimeFactory } from '../src/app-server/langchain-assistant-runtime.js';

export type AssistantModelOutput = AssistantRuntimeModelOutput & { nativeMessage?: AIMessage };

/** A scripted model turn: receives the history without the system prompt, like a provider call. */
export type AssistantModelCall = (
  definition: AssistantRuntimeDefinition,
  messages: BaseMessage[],
  signal?: AbortSignal,
  onText?: (delta: string) => void
) => Promise<AssistantModelOutput>;

/** Plays scripted outputs through a real LangChain chat model inside the standard agent loop. */
export class ScriptedChatModel extends BaseChatModel {
  constructor(
    private readonly definition: AssistantRuntimeDefinition,
    private readonly modelCall: AssistantModelCall,
    callbacks: BaseCallbackHandler[]
  ) {
    super({ callbacks });
  }

  _llmType() {
    return 'mcplab-scripted';
  }

  bindTools() {
    return this as never;
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const tokens: Promise<unknown>[] = [];
    const output = await this.modelCall(
      this.definition,
      messages.filter((message) => message.getType() !== 'system'),
      options.signal,
      (delta) => tokens.push(runManager?.handleLLMNewToken(delta) ?? Promise.resolve())
    );
    await Promise.all(tokens);
    const message = toAIMessage(output);
    return { generations: [{ text: output.text, message }] };
  }
}

export function createScriptedRuntimeFactory(modelCall?: AssistantModelCall) {
  return createLangChainAssistantRuntimeFactory(
    modelCall
      ? {
          createChatModel: (definition, { callbacks }) => ({
            model: new ScriptedChatModel(definition, modelCall, callbacks),
            middleware: []
          })
        }
      : {}
  );
}

function toAIMessage(output: AssistantModelOutput): AIMessage {
  if (output.nativeMessage) return output.nativeMessage;
  if (output.type === 'assistant_message') return new AIMessage({ content: output.text });
  const valid = output.toolCalls.filter((call) => !call.validationError);
  const invalid = output.toolCalls.filter((call) => call.validationError);
  return new AIMessage({
    content: output.text,
    tool_calls: valid.map((call) => ({
      id: call.id ?? '',
      name: call.name,
      args: (call.arguments ?? {}) as Record<string, unknown>,
      type: 'tool_call' as const
    })),
    invalid_tool_calls: invalid.map((call) => ({
      id: call.id,
      name: call.name,
      args: JSON.stringify(call.arguments ?? {}),
      error: call.validationError,
      type: 'invalid_tool_call' as const
    }))
  });
}
