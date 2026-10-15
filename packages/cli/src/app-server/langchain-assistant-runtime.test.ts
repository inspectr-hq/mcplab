import { expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Client, RunTree } from 'langsmith';
import { withRunTree, getCurrentRunTree } from 'langsmith/traceable';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { assistantRuntimeContract } from '../../test-support/assistant-runtime-contract.js';
import type { AssistantRuntimeDefinition } from '@inspectr/mcplab-core';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';

assistantRuntimeContract('LangGraph assistant runtime', createLangChainAssistantRuntimeFactory);

it('fences an abort-ignoring old model completion from a newer turn', async () => {
  let releaseOld!: (value: { type: 'assistant_message'; text: string }) => void;
  let started!: () => void;
  const oldStarted = new Promise<void>((resolve) => (started = resolve));
  let calls = 0;
  const session = await createLangChainAssistantRuntimeFactory(async () => {
    calls++;
    if (calls === 1) {
      started();
      return new Promise((resolve) => (releaseOld = resolve));
    }
    return { type: 'assistant_message', text: 'new answer' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  const controller = new AbortController();
  const oldTurn = session.sendMessage('old request', controller.signal);
  await oldStarted;
  controller.abort();
  await expect(oldTurn).rejects.toThrow();
  await expect(session.sendMessage('new request')).resolves.toMatchObject({ text: 'new answer' });
  const current = session.getSnapshot();
  releaseOld({ type: 'assistant_message', text: 'late old answer' });
  await Promise.resolve();
  expect(session.getSnapshot()).toEqual(current);
});

it('keeps UI message IDs unique when the provider repeats its native response ID', async () => {
  const histories: BaseMessage[][] = [];
  const session = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
    histories.push(messages);
    return {
      type: 'assistant_message' as const,
      text: 'answer',
      nativeMessage: new AIMessage({ id: 'reused-provider-id', content: 'answer' })
    };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);

  await session.sendMessage('first');
  await session.sendMessage('second');

  const visibleIds = session.getSnapshot().messages.map((message) => message.id);
  expect(new Set(visibleIds).size).toBe(visibleIds.length);
  expect(histories[1]?.filter((message) => AIMessage.isInstance(message)).at(-1)?.id).toBe(
    'reused-provider-id'
  );
});

it('isolates assistant trace export inside an inherited evaluation trace', async () => {
  vi.stubEnv('LANGSMITH_TRACING', 'true');
  vi.stubEnv('LANGCHAIN_TRACING_V2', 'true');
  vi.stubEnv('LANGCHAIN_TRACING', 'true');
  vi.stubEnv('LANGSMITH_ENDPOINT', 'https://assistant-export-leak.invalid');
  const exportedRequests: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body =
        init.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : String(init.body ?? '');
      exportedRequests.push({ url, body });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const observed: boolean[] = [];
  let modelRounds = 0;
  let releaseTool!: () => void;
  let markToolStarted!: () => void;
  const toolStarted = new Promise<void>((resolve) => (markToolStarted = resolve));
  const toolGate = new Promise<void>((resolve) => (releaseTool = resolve));
  const execute = vi.fn(async () => {
    markToolStarted();
    await toolGate;
    return { ok: true };
  });
  const session = await createLangChainAssistantRuntimeFactory(async () => {
    observed.push(getCurrentRunTree().tracingEnabled === true);
    modelRounds++;
    if (modelRounds === 1)
      return {
        type: 'tool_call_request' as const,
        text: 'Using the tool.',
        toolCalls: [
          { id: 'private-tool-call', name: 'lookup', arguments: { secret: 'private-input' } }
        ],
        nativeMessage: new AIMessage({
          content: 'Using the tool.',
          tool_calls: [
            {
              id: 'private-tool-call',
              name: 'lookup',
              args: { secret: 'private-input' },
              type: 'tool_call'
            }
          ]
        })
      };
    return { type: 'assistant_message', text: 'answer' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'lookup', server: 'private', tool: 'lookup', execute }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  const evaluationClient = new Client({
    apiUrl: 'https://trace.test',
    apiKey: 'test-key',
    tracingSamplingRate: 1
  });
  const evaluationRun = new RunTree({
    name: 'MCPLab Assistant',
    run_type: 'chain',
    tracingEnabled: true,
    inputs: { evaluation: 'eval-only' },
    client: evaluationClient
  });
  try {
    await withRunTree(evaluationRun, async () => {
      expect(getCurrentRunTree().tracingEnabled).toBe(true);
      const pending = await session.sendMessage('hello');
      expect(pending.type).toBe('tool_call_request');
      const approval = session.resolveToolCalls([
        { toolCallId: 'private-tool-call', decision: 'approve' }
      ]);
      await toolStarted;
      const concurrentEvaluation = new RunTree({
        name: 'Concurrent Evaluation',
        run_type: 'chain',
        tracingEnabled: true,
        inputs: { evaluation: 'eval-only' },
        client: evaluationClient
      });
      await concurrentEvaluation.postRun();
      await evaluationClient.awaitPendingTraceBatches();
      releaseTool();
      await approval;
      await awaitAllCallbacks();
      expect(getCurrentRunTree().tracingEnabled).toBe(true);
    });
    expect(observed).toEqual([true, true]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(evaluationRun.tracingEnabled).toBe(true);
    expect(exportedRequests).toHaveLength(1);
    expect(exportedRequests[0]!.body).toContain('eval-only');
    expect(exportedRequests.some((request) => request.body.includes('private-input'))).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

it('returns malformed calls individually while approving valid siblings and preserving native history', async () => {
  const execute = vi.fn(async () => ({ value: 'ok' }));
  const seen: unknown[][] = [];
  const modelCall = async (_definition: AssistantRuntimeDefinition, messages: any[]) => {
    seen.push(messages);
    if (seen.length === 1)
      return {
        type: 'tool_call_request' as const,
        text: 'Working',
        toolCalls: [
          {
            id: 'malformed',
            name: 'write',
            arguments: {},
            validationError: 'Malformed JSON: {broken'
          },
          { id: 'valid', name: 'write', arguments: { value: 1 } }
        ],
        nativeMessage: new AIMessage({
          id: 'provider-response-1',
          content: [{ type: 'text', text: 'Working' }],
          response_metadata: { provider: 'openai' },
          tool_calls: [
            { id: 'malformed', name: 'write', args: {}, type: 'tool_call' },
            { id: 'valid', name: 'write', args: { value: 1 }, type: 'tool_call' }
          ]
        })
      };
    return { type: 'assistant_message' as const, text: 'Done' };
  };
  const session = await createLangChainAssistantRuntimeFactory(modelCall).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  const pending = await session.sendMessage('write');
  expect(pending).toMatchObject({ type: 'tool_call_request', pendingToolCalls: [{ id: 'valid' }] });
  expect(session.getSnapshot().pendingToolCalls).toMatchObject([
    { id: 'malformed', status: 'error', error: 'Malformed JSON: {broken' },
    { id: 'valid', status: 'pending' }
  ]);
  expect(execute).not.toHaveBeenCalled();
  await session.resolveToolCalls([{ toolCallId: 'valid', decision: 'approve' }]);
  expect(execute).toHaveBeenCalledTimes(1);
  const followup = seen[1] as Array<AIMessage | ToolMessage | HumanMessage>;
  const assistant = followup.find((message) => AIMessage.isInstance(message));
  expect(assistant).toMatchObject({
    id: 'provider-response-1',
    content: [{ type: 'text', text: 'Working' }],
    response_metadata: { provider: 'openai' },
    tool_calls: [
      { id: 'malformed', args: {} },
      { id: 'valid', args: { value: 1 } }
    ]
  });
  expect(
    followup
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message.tool_call_id)
  ).toEqual(['malformed', 'valid']);
});
