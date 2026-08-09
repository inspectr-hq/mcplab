import { describe, expect, it } from 'vitest';
import {
  globalCopilotMemoryMessages,
  mergeRefreshedGlobalCopilotThread
} from './use-global-copilot-thread';
import {
  globalCopilotRunIdFromInterruptId,
  preferGlobalCopilotThreadMessages
} from './use-global-copilot-run';

describe('globalCopilotRunIdFromInterruptId', () => {
  it('extracts the Mastra run id from a persisted interrupt id', () => {
    expect(globalCopilotRunIdFromInterruptId('run-42::tool-7')).toBe('run-42');
  });

  it('preserves ids without the compound interrupt delimiter', () => {
    expect(globalCopilotRunIdFromInterruptId('run-42')).toBe('run-42');
  });
});

describe('globalCopilotMemoryMessages', () => {
  it('restores text messages from Mastra v2 content', () => {
    expect(
      globalCopilotMemoryMessages({
        id: 'assistant-1',
        role: 'assistant',
        createdAt: '2026-08-08T12:00:00.000Z',
        content: { format: 2, parts: [{ type: 'text', text: 'Stored answer' }] }
      })
    ).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Stored answer',
        createdAt: '2026-08-08T12:00:00.000Z'
      }
    ]);
  });

  it('restores completed Mastra tool invocations for the existing tool cards', () => {
    expect(
      globalCopilotMemoryMessages({
        id: 'assistant-2',
        role: 'assistant',
        createdAt: '2026-08-08T12:01:00.000Z',
        content: {
          format: 2,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: {
                toolCallId: 'call-1',
                toolName: 'mcplab__mcplab_get_results',
                args: { limit: 2 },
                result: { count: 2 }
              }
            }
          ]
        }
      })
    ).toEqual([
      {
        id: 'assistant-2-call-1',
        role: 'tool',
        content: '{\n  "count": 2\n}',
        createdAt: '2026-08-08T12:01:00.000Z',
        toolCallId: 'call-1',
        toolName: 'mcplab__mcplab_get_results',
        toolArguments: { limit: 2 }
      }
    ]);
  });

  it('does not expose unsupported stored message roles', () => {
    expect(globalCopilotMemoryMessages({ id: 'tool-1', role: 'tool', content: 'raw' })).toEqual([]);
  });
});

describe('mergeRefreshedGlobalCopilotThread', () => {
  it('updates pending interrupts on the active thread without clearing loaded messages', () => {
    const current = {
      id: 'thread-1',
      messages: [{ id: 'message-1', role: 'assistant' as const, content: 'Stored' }]
    };
    const refreshed = {
      id: 'thread-1',
      messages: [],
      pendingInterrupts: [{ id: 'run-1::tool-1' }]
    };

    expect(mergeRefreshedGlobalCopilotThread(current as any, refreshed as any)).toEqual({
      ...current,
      pendingInterrupts: refreshed.pendingInterrupts
    });
  });
});

describe('preferGlobalCopilotThreadMessages', () => {
  it('shows persisted messages while the CopilotKit agent is still empty', () => {
    const persisted = [{ id: 'message-1', role: 'assistant' as const, content: 'Previous answer' }];

    expect(preferGlobalCopilotThreadMessages([], persisted)).toBe(persisted);
  });

  it('uses live agent messages once they are available', () => {
    const live = [{ id: 'message-2', role: 'assistant' as const, content: 'Current answer' }];
    const persisted = [{ id: 'message-1', role: 'assistant' as const, content: 'Previous answer' }];

    expect(preferGlobalCopilotThreadMessages(live, persisted)).toBe(live);
  });
});
