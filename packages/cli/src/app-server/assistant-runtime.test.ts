import { describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeDefinition, AssistantRuntimeModelOutput } from '@inspectr/mcplab-core';
import { createNativeAssistantRuntimeFactory } from './assistant-runtime.js';

describe('native assistant runtime', () => {
  it('holds tool results until the full batch resolves and appends them in request order', async () => {
    const histories: Array<Array<{ role: string; content: string }>> = [];
    const outputs: AssistantRuntimeModelOutput[] = [
      { type: 'tool_call_request', text: 'Reading both', toolCalls: [{ name: 'first' }, { name: 'second' }] },
      { type: 'assistant_message', text: 'Done' }
    ];
    const factory = createNativeAssistantRuntimeFactory(async (_definition, messages) => {
      histories.push(messages.map(({ role, content }) => ({ role, content: String(content) })));
      return outputs.shift()!;
    });
    const definition = makeDefinition({
      tools: [
        { name: 'first', server: 's', tool: 'first', execute: async () => ({ n: 1 }) },
        { name: 'second', server: 's', tool: 'second', execute: async () => ({ n: 2 }) }
      ],
      approvalPolicy: () => 'approval_required'
    });
    const session = await factory.create(definition);
    const request = await session.sendMessage('Read');
    if (request.type !== 'tool_call_request') throw new Error('Expected tool request');
    const [first, second] = request.pendingToolCalls;

    const partial = await session.resolveToolCalls([{ toolCallId: second.id, decision: 'approve' }]);
    expect(partial.type).toBe('tool_call_resolved');
    expect(histories).toHaveLength(1);

    await session.resolveToolCalls([{ toolCallId: first.id, decision: 'approve' }]);
    expect(histories[1].slice(-2)).toEqual([
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('"n":1') }),
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('"n":2') })
    ]);
  });

  it('pairs an approved tool result before asking the model to continue', async () => {
    const histories: Array<Array<{ role: string; content: string }>> = [];
    const execute = vi.fn(async () => ({ ok: true }));
    const outputs: AssistantRuntimeModelOutput[] = [
      { type: 'tool_call_request', text: 'Reading', toolCalls: [{ name: 'read', arguments: { q: 1 } }] },
      { type: 'assistant_message', text: 'Done' }
    ];
    const factory = createNativeAssistantRuntimeFactory(async (_definition, messages) => {
      histories.push(messages.map(({ role, content }) => ({ role, content: String(content) })));
      return outputs.shift()!;
    });
    const definition: AssistantRuntimeDefinition = {
      assistant: 'result',
      outputMode: 'native',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'Prompt',
      tools: [{ name: 'read', server: 'mcplab', tool: 'read', execute }],
      approvalPolicy: () => 'approval_required',
      decodeOutput: (value) => value as AssistantRuntimeModelOutput
    };

    const session = await factory.create(definition);
    const pending = await session.sendMessage('Find it');
    expect(pending.type).toBe('tool_call_request');
    if (pending.type !== 'tool_call_request') throw new Error('Expected tool request');
    const resolved = await session.resolveToolCalls([
      { toolCallId: pending.pendingToolCalls[0].id, decision: 'approve' }
    ]);

    expect(resolved).toMatchObject({ type: 'assistant_message', text: 'Done' });
    expect(execute).toHaveBeenCalledWith({ q: 1 }, undefined);
    expect(histories[1].at(-1)).toMatchObject({ role: 'tool' });
    expect(histories[1].at(-1)?.content).toContain('ok');
    expect(session.getSnapshot().pendingToolCalls[0].status).toBe('approved');
  });
});

function makeDefinition(overrides: Partial<AssistantRuntimeDefinition> = {}): AssistantRuntimeDefinition {
  return {
    assistant: 'result',
    outputMode: 'native',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required',
    decodeOutput: (value) => value as AssistantRuntimeModelOutput,
    ...overrides
  };
}
