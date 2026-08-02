import { beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
  connectAll: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  disconnectAll: vi.fn()
}));

vi.mock('@inspectr/mcplab-core', () => ({
  chatWithAgent: vi.fn(),
  McpClientManager: class {
    connectAll = mcpMocks.connectAll;
    listTools = mcpMocks.listTools;
    callTool = mcpMocks.callTool;
    disconnectAll = mcpMocks.disconnectAll;
  }
}));

vi.mock('./libraries-store.js', () => ({
  readLibraries: vi.fn(() => ({
    servers: {
      weather: { transport: 'http', url: 'http://weather.test/mcp' }
    },
    scenarios: [{ id: 'weather-case', mcp_servers: [{ ref: 'weather' }] }]
  }))
}));

import {
  handleGlobalCopilotMarkdownReportWriteConfirmation,
  handleGlobalCopilotRunEvaluationConfirmation,
  handleGlobalCopilotToolConfirmation
} from './global-copilot-domain.js';

type CapturedResponse = { status: number; body: unknown };

function captureResponse(): {
  responses: CapturedResponse[];
  asJson: (_res: unknown, status: number, body: unknown) => void;
} {
  const responses: CapturedResponse[] = [];
  return {
    responses,
    asJson: (_res, status, body) => responses.push({ status, body })
  };
}

const errorResult = {
  isError: true,
  content: [{ type: 'text' as const, text: 'Error: Evaluation Judge is missing' }]
};

describe('global copilot MCP confirmation endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpMocks.listTools.mockResolvedValue([
      { name: 'mcplab_run_eval' },
      { name: 'mcplab_write_markdown_report' },
      { name: 'search' }
    ]);
    mcpMocks.callTool.mockResolvedValue(errorResult);
    mcpMocks.disconnectAll.mockResolvedValue(undefined);
  });

  it('returns HTTP 502 when the confirmed evaluation run returns an MCP error', async () => {
    const captured = captureResponse();

    await handleGlobalCopilotRunEvaluationConfirmation({
      req: {} as any,
      res: {} as any,
      parseBody: async () => ({ arguments: { config_path: 'eval.yaml' } }),
      asJson: captured.asJson
    });

    expect(captured.responses).toEqual([{ status: 502, body: { error: errorResult.content[0].text } }]);
  });

  it('returns HTTP 502 when the confirmed Markdown report write returns an MCP error', async () => {
    const captured = captureResponse();

    await handleGlobalCopilotMarkdownReportWriteConfirmation({
      req: {} as any,
      res: {} as any,
      parseBody: async () => ({ arguments: { output_path: 'reports/result.md' } }),
      asJson: captured.asJson
    });

    expect(captured.responses).toEqual([{ status: 502, body: { error: errorResult.content[0].text } }]);
  });

  it('returns HTTP 502 when a confirmed external MCP tool returns an MCP error', async () => {
    const captured = captureResponse();

    await handleGlobalCopilotToolConfirmation({
      req: {} as any,
      res: {} as any,
      settings: { librariesDir: '/tmp/libraries' } as any,
      parseBody: async () => ({
        activeTestCaseId: 'weather-case',
        serverName: 'weather',
        toolName: 'search',
        arguments: { query: 'rain' }
      }),
      asJson: captured.asJson
    });

    expect(captured.responses).toEqual([{ status: 502, body: { error: errorResult.content[0].text } }]);
  });
});
