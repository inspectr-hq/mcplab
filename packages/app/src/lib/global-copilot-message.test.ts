import { describe, expect, it } from 'vitest';
import { globalCopilotToolDisplayName } from './global-copilot-message';

describe('globalCopilotMessage', () => {
  it('normalizes MCPLab tool names outside the sidebar component', () => {
    expect(globalCopilotToolDisplayName('mcplab__mcplab_list_runs')).toBe('mcplab_list_runs');
  });
});
