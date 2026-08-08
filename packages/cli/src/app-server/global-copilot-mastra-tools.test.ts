import { describe, expect, it, vi } from 'vitest';
import {
  createGlobalCopilotMcpTool,
  type GlobalCopilotReadBudget
} from './global-copilot-mastra-tools.js';

const definition = {
  name: 'mcplab_list_runs',
  description: 'List evaluation runs.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { limit: { type: 'number' } }
  }
} as any;

describe('createGlobalCopilotMcpTool', () => {
  it('executes an automatic MCP tool without suspending inside the read budget', async () => {
    const execute = vi.fn().mockResolvedValue({ runs: [] });
    const suspend = vi.fn();
    const budget: GlobalCopilotReadBudget = { used: 0, batchSize: 5 };
    const tool = createGlobalCopilotMcpTool({
      definition,
      serverName: 'mcplab',
      toolName: definition.name,
      approval: 'automatic',
      budget,
      execute
    });

    await expect(tool.execute?.({ limit: 3 }, { agent: { suspend } } as any)).resolves.toEqual({
      runs: []
    });
    expect(suspend).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(budget.used).toBe(1);
  });

  it('suspends the next automatic read after five calls', async () => {
    const execute = vi.fn();
    const suspend = vi.fn().mockResolvedValue(undefined);
    const tool = createGlobalCopilotMcpTool({
      definition,
      serverName: 'mcplab',
      toolName: definition.name,
      approval: 'automatic',
      budget: { used: 5, batchSize: 5 },
      execute
    });

    await tool.execute?.({}, { agent: { suspend } } as any);

    expect(suspend).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'continue_reading', batchSize: 5 }),
      undefined
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires approval before executing a protected MCP tool', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const suspend = vi.fn().mockResolvedValue(undefined);
    const tool = createGlobalCopilotMcpTool({
      definition: { ...definition, name: 'mcplab_write_markdown_report' },
      serverName: 'mcplab',
      toolName: 'mcplab_write_markdown_report',
      approval: 'confirmation',
      budget: { used: 0, batchSize: 5 },
      execute
    });

    await tool.execute?.({ path: 'report.md' }, { agent: { suspend } } as any);
    expect(suspend).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mcp_tool_approval', serverName: 'mcplab' }),
      undefined
    );
    expect(execute).not.toHaveBeenCalled();

    await expect(
      tool.execute?.(
        { path: 'report.md' },
        { agent: { resumeData: { approved: true }, suspend } } as any
      )
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns a denial result without calling MCP', async () => {
    const execute = vi.fn();
    const tool = createGlobalCopilotMcpTool({
      definition,
      serverName: 'weather',
      toolName: definition.name,
      approval: 'confirmation',
      budget: { used: 0, batchSize: 5 },
      execute
    });

    await expect(
      tool.execute?.({}, { agent: { resumeData: { approved: false } } } as any)
    ).resolves.toEqual({ approved: false, reason: 'Denied by user.' });
    expect(execute).not.toHaveBeenCalled();
  });
});
