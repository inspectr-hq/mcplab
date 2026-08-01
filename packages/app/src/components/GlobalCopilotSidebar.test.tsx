import { describe, expect, it } from 'vitest';
import type { Message } from '@ag-ui/client';
import {
  globalCopilotToolDisplayName,
  globalCopilotToolLabel,
  storedGlobalCopilotFrontendAction
} from './GlobalCopilotSidebar';

describe('globalCopilotToolDisplayName', () => {
  it('removes the internal MCPLab routing prefix while retaining the MCP tool name', () => {
    expect(globalCopilotToolDisplayName('mcplab__mcplab_list_runs')).toBe(
      'mcplab_list_runs'
    );
    expect(globalCopilotToolDisplayName('mcplab_mcplab_read_run_artifact')).toBe(
      'mcplab_read_run_artifact'
    );
  });

  it('uses the MCP tool title in the collapsed card', () => {
    expect(globalCopilotToolLabel('mcplab_read_markdown_report')).toBe('Read Markdown Report');
    expect(globalCopilotToolLabel('mcplab_aggregate_runs')).toBe('Aggregate Runs');
  });

  it('restores a navigation confirmation from its streamed action marker', () => {
    expect(
      storedGlobalCopilotFrontendAction({
        id: 'assistant-1',
        role: 'assistant',
        content: '[mcplab-action]{"kind":"navigate_to_view","path":"/mcp-evaluations"}'
      } as Message)
    ).toMatchObject({
      action: { kind: 'navigate_to_view', path: '/mcp-evaluations', status: 'pending' }
    });
  });

  it('restores a Result Detail suggestion without navigating automatically', () => {
    expect(
      storedGlobalCopilotFrontendAction({
        id: 'assistant-2',
        role: 'assistant',
        content: '[mcplab-action]{"kind":"open_result_detail","runId":"run-42"}'
      } as Message)
    ).toMatchObject({
      action: { kind: 'open_result_detail', runId: 'run-42', status: 'pending' }
    });
  });
});
