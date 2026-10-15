import { expect, it } from 'vitest';
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
