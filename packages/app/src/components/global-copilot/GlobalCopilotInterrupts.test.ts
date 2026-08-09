import { describe, expect, it } from 'vitest';
import { globalCopilotInterruptMessageFromMastra } from './GlobalCopilotCards';

describe('global Copilot interrupt mapping', () => {
  it('uses one message shape for live and persisted Mastra interrupts', () => {
    const message = globalCopilotInterruptMessageFromMastra('interrupt-1', {
      toolName: 'mcplab_list_library',
      suspendPayload: {
        serverName: 'mcp-lab',
        toolName: 'mcplab_list_library',
        arguments: { kind: 'test-cases' }
      }
    });

    expect(message).toMatchObject({
      id: 'interrupt-1',
      action: {
        kind: 'external_mcp_tool',
        serverName: 'mcp-lab',
        toolName: 'mcplab_list_library',
        arguments: { kind: 'test-cases' }
      }
    });
  });
});
