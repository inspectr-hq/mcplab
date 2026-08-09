import { describe, expect, it } from 'vitest';
import { globalCopilotMemoryMessages } from './use-global-copilot-thread';
import { globalCopilotRunIdFromInterruptId } from './use-global-copilot-run';

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
