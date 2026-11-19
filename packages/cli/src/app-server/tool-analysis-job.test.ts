import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClientManager } from '@inspectr/mcplab-core';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { runToolAnalysisJob, type ToolAnalysisJob } from './tool-analysis-domain.js';
import { readLibraries } from './libraries-store.js';

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('@inspectr/mcplab-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inspectr/mcplab-core')>()),
  chatWithAgent: chat
}));
vi.mock('./libraries-store.js', () => ({ readLibraries: vi.fn() }));

function jobOptions(): Parameters<typeof runToolAnalysisJob>[0] {
  const job: ToolAnalysisJob = {
    id: 'test',
    status: 'running',
    events: [],
    clients: new Set(),
    abortController: new AbortController()
  };
  return {
    job,
    settings: {} as Parameters<typeof runToolAnalysisJob>[0]['settings'],
    serverNames: ['demo'],
    oauthSessionManager: {} as Parameters<typeof runToolAnalysisJob>[0]['oauthSessionManager'],
    modes: { metadataReview: false, deeperAnalysis: true },
    deeper: { autoRunPolicy: 'read_only_allowlist', sampleCallsPerTool: 1, toolCallTimeoutMs: 20 },
    maxParallelTools: 1
  };
}

describe('runToolAnalysisJob', () => {
  beforeEach(() => {
    vi.mocked(readLibraries).mockReturnValue({
      servers: { demo: { transport: 'http', url: 'https://example.test/mcp' } },
      agents: { review: { provider: 'openai', model: 'gpt-4o-mini' } }
    } as ReturnType<typeof readLibraries>);
    vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'listToolsWithCoverage').mockResolvedValue({
      status: 'ready',
      items: [{ name: 'get_report', annotations: { readOnlyHint: true } }]
    });
    chat.mockImplementation(async ({ system }) => ({
      content: system.includes('generate safe sample') ? '{"sampleCalls":[{"arguments":{}}]}' : '{}'
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    chat.mockReset();
  });

  it('runs catalog checks on a prompt-only server without an assistant or live calls', async () => {
    const libraries = vi.mocked(readLibraries)('unused');
    vi.mocked(readLibraries).mockReturnValue({ ...libraries, agents: {} });
    vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
      tools: false,
      resources: false,
      prompts: true
    });
    vi.spyOn(McpClientManager.prototype, 'listCatalog').mockResolvedValue({
      resources: { status: 'unsupported' },
      resourceTemplates: { status: 'unsupported' },
      prompts: { status: 'ready', items: [{ name: 'review', description: 'Review a note.' }] }
    });
    const forbidden = ['callTool', 'readResource', 'getPrompt'] as const;
    const spies = forbidden.map((method) => vi.spyOn(McpClientManager.prototype, method));
    const options = jobOptions();
    options.modes = { metadataReview: false, deeperAnalysis: false, catalogChecks: true };
    options.selectedToolsByServer = { demo: [] };

    await runToolAnalysisJob(options);

    expect(options.job.result?.assistantAgentName).toBeUndefined();
    expect(options.job.result?.servers[0].catalogChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'prompts', status: 'pass', itemsChecked: 1 })
      ])
    );
    expect(options.job.result?.summary.catalogChecks?.itemsChecked).toBe(1);
    expect(chat).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('checks the full tool catalog when assistant review selects only one tool', async () => {
    vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
      tools: true,
      resources: false,
      prompts: false
    });
    vi.spyOn(McpClientManager.prototype, 'listCatalog').mockResolvedValue({
      resources: { status: 'unsupported' },
      resourceTemplates: { status: 'unsupported' },
      prompts: { status: 'unsupported' }
    });
    vi.mocked(McpClientManager.prototype.listToolsWithCoverage).mockResolvedValue({
      status: 'ready',
      items: [{ name: 'get_report', inputSchema: { type: 'object' } }, { name: 'get_notes' }]
    });
    const options = jobOptions();
    options.modes = { catalogChecks: true, metadataReview: true, deeperAnalysis: false };
    options.selectedToolsByServer = { demo: ['get_report'] };
    await runToolAnalysisJob(options);

    const server = options.job.result?.servers[0];
    expect(server?.tools.map(({ toolName }) => toolName)).toEqual(['get_report']);
    expect(server?.catalogChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'tools', itemsChecked: 2 })])
    );
  });

  it.each(['duplicate', 'partial', 'unlabeled'] as const)(
    'skips automatic sampling when tool metadata is %s',
    async (caseName) => {
      const tool =
        caseName === 'unlabeled'
          ? { name: 'get_report' }
          : { name: 'get_report', annotations: { readOnlyHint: true } };
      const items = [tool];
      if (caseName === 'duplicate')
        items.push({
          name: 'get_report',
          annotations: { readOnlyHint: false }
        });
      vi.mocked(McpClientManager.prototype.listToolsWithCoverage).mockResolvedValue(
        caseName === 'partial'
          ? { status: 'partial', items, message: 'Missing page.' }
          : { status: 'ready', items }
      );
      const call = vi.spyOn(McpClientManager.prototype, 'callTool');
      const options = jobOptions();
      await runToolAnalysisJob(options);

      const report = options.job.result?.servers[0];
      expect(report?.tools).toHaveLength(1);
      expect(report?.tools[0].safetyClassification).toBe('unsafe_or_unknown');
      expect(report?.tools[0].deeperAnalysis).toMatchObject({
        attempted: false,
        skippedReason: expect.stringContaining(report?.tools[0].classificationReason ?? '')
      });
      expect(call).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['success', { content: [] }, true],
    [
      'tool_error',
      { isError: true, content: [{ type: 'text', text: 'Could not retrieve report' }] },
      false
    ]
  ])('records %s for an MCP result', async (outcome, result, ok) => {
    const call = vi.spyOn(McpClientManager.prototype, 'callTool').mockResolvedValue(result);
    const options = jobOptions();
    await runToolAnalysisJob(options);

    const sample = options.job.result?.servers[0].tools[0].deeperAnalysis?.sampleCalls[0];
    expect(sample).toMatchObject({ outcome, ok });
    expect(call).toHaveBeenCalledWith(
      'demo',
      'get_report',
      {},
      { signal: expect.any(AbortSignal) }
    );
  });

  it.each([
    [
      'schema_error',
      new McpError(
        ErrorCode.InvalidParams,
        "Structured content does not match the tool's output schema: expected a string"
      )
    ],
    ['protocol_error', new McpError(ErrorCode.MethodNotFound, 'Unknown tool')],
    ['transport_error', new Error('Connection closed')]
  ])('records %s for rejected calls', async (outcome, cause) => {
    vi.spyOn(McpClientManager.prototype, 'callTool').mockRejectedValue(
      new Error(cause.message, { cause })
    );
    const options = jobOptions();
    await runToolAnalysisJob(options);

    expect(options.job.result?.servers[0].tools[0].deeperAnalysis?.sampleCalls[0]).toMatchObject({
      outcome,
      ok: false
    });
  });

  it('reports an observed invalid input and redacts sensitive error evidence', async () => {
    vi.mocked(McpClientManager.prototype.listToolsWithCoverage).mockResolvedValue({
      status: 'ready',
      items: [
        {
          name: 'get_report',
          annotations: { readOnlyHint: true },
          inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
        }
      ]
    });
    const call = vi.spyOn(McpClientManager.prototype, 'callTool').mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'password=pretend-value' }]
    });
    const options = jobOptions();
    await runToolAnalysisJob(options);

    const report = options.job.result?.servers[0];
    expect(call).toHaveBeenCalledTimes(1);
    expect(report?.health?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bad_inputs', status: 'pass' }),
        expect.objectContaining({ id: 'errors', status: 'fail' })
      ])
    );
    expect(report?.tools[0].deeperAnalysis?.sampleCalls[0]).toMatchObject({
      inputSchemaStatus: 'invalid',
      errorIndicators: ['credential']
    });
    expect(JSON.stringify(options.job.result)).not.toContain('pretend-value');
  });

  it('aborts the real request signal when the sample deadline expires', async () => {
    vi.spyOn(McpClientManager.prototype, 'callTool').mockImplementation(
      async (_server, _name, _args, options) => {
        const signal = options?.signal;
        if (!signal) throw new Error('Missing request signal');
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        );
      }
    );
    const options = jobOptions();
    await runToolAnalysisJob(options);

    expect(options.job.result?.servers[0].tools[0].deeperAnalysis?.sampleCalls[0]).toMatchObject({
      outcome: 'timeout',
      ok: false
    });
  });

  it('aborts an in-flight sample when the user stops the job', async () => {
    const options = jobOptions();
    vi.spyOn(McpClientManager.prototype, 'callTool').mockImplementation(
      async (_server, _name, _args, callOptions) => {
        options.job.abortController.abort();
        expect(callOptions?.signal?.aborted).toBe(true);
        throw callOptions?.signal?.reason;
      }
    );

    await expect(runToolAnalysisJob(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(options.job.result).toBeUndefined();
  });
});
