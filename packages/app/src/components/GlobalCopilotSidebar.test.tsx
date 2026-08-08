import { describe, expect, it } from 'vitest';
import {
  globalCopilotToolDisplayName,
  globalCopilotToolLabel
} from './GlobalCopilotSidebar';

describe('globalCopilotToolDisplayName', () => {
  it('removes the internal MCPLab routing prefix while retaining the MCP tool name', () => {
    expect(globalCopilotToolDisplayName('mcplab__mcplab_list_runs')).toBe('mcplab_list_runs');
    expect(globalCopilotToolDisplayName('mcplab_mcplab_read_run_artifact')).toBe(
      'mcplab_read_run_artifact'
    );
  });

  it('uses the MCP tool title in the collapsed card', () => {
    expect(globalCopilotToolLabel('mcplab_read_markdown_report')).toBe('Read Markdown Report');
    expect(globalCopilotToolLabel('mcplab_aggregate_runs')).toBe('Aggregate Runs');
  });
});
