import { describe, expect, it, vi } from 'vitest';
import {
  createLangSmithTraceExporter,
  toLangSmithMessages,
  type LangSmithRunFactory,
  type TraceExporter
} from './langsmith-tracing.js';
import type { TraceMessage } from './types.js';

function makeFactory() {
  const runs: Array<{
    config: Record<string, unknown>;
    end: ReturnType<typeof vi.fn>;
    postRun: ReturnType<typeof vi.fn>;
    createChild: ReturnType<typeof vi.fn>;
  }> = [];
  const factory: LangSmithRunFactory = (config) => {
    const run = {
      config,
      end: vi.fn(),
      postRun: vi.fn(async () => undefined),
      createChild: vi.fn((childConfig: Record<string, unknown>) => factory({
        ...childConfig,
        parent_run: run
      }))
    };
    runs.push(run);
    return run as any;
  };
  return { factory, runs };
}

describe('createLangSmithTraceExporter', () => {
  it('maps the complete MCPLab conversation to LangSmith messages', () => {
    const traceMessages: TraceMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Find the tag profile.' }]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'search_tags',
            input: { name: 'TM5' },
            server: 'server-1'
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"matches":["TM5"]}' }],
            is_error: false,
            server: 'server-1'
          }
        ]
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'The tag profile is ready.' }]
      },
      {
        role: 'user',
        content: [
          { type: 'image', media_type: 'image/png', data: 'image-data', name: 'chart.png' },
          { type: 'document', media_type: 'application/pdf', data: 'pdf-data', name: 'report.pdf' }
        ]
      }
    ];

    expect(toLangSmithMessages(traceMessages)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Find the tag profile.' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'call-1', name: 'search_tags', args: { name: 'TM5' } }]
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'search_tags',
        content: [{ type: 'text', text: '{"matches":["TM5"]}' }]
      },
      { role: 'assistant', content: [{ type: 'text', text: 'The tag profile is ready.' }] },
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source_type: 'base64',
            data: 'image-data',
            mime_type: 'image/png',
            name: 'chart.png'
          },
          {
            type: 'file',
            source_type: 'base64',
            data: 'pdf-data',
            mime_type: 'application/pdf',
            name: 'report.pdf'
          }
        ]
      }
    ]);
  });

  it('is a no-op unless tracing and an API key are configured', async () => {
    const { factory, runs } = makeFactory();
    const exporter = createLangSmithTraceExporter({}, factory);

    const parent = exporter.startScenario({ scenarioId: 'scenario-1' });
    await parent.end({ outputs: { pass: true } });
    await exporter.flush();

    expect(runs).toHaveLength(0);
  });

  it('creates a scenario parent and nested llm/tool spans', async () => {
    const { factory, runs } = makeFactory();
    const exporter = createLangSmithTraceExporter(
      {
        LANGSMITH_TRACING: 'true',
        LANGSMITH_API_KEY: 'test-key',
        LANGSMITH_PROJECT: 'mcplab-tests'
      },
      factory
    );

    const parent = exporter.startScenario({
      runId: 'run-1',
      requestId: 'request-1',
      scenarioId: 'scenario-1',
      agent: 'agent-1',
      provider: 'openai',
      model: 'gpt-test',
      configHash: 'hash-1',
      cliVersion: '1.0.0'
    });
    const llm = parent.startLlm({
      turn: 0,
      inputs: { prompt: 'hello' },
      metadata: { ls_provider: 'openai', ls_model_name: 'gpt-test' }
    });
    await llm.end({ outputs: { text: 'hi' } });
    const tool = parent.startTool({ server: 'server-1', tool: 'tool-1', inputs: { x: 1 } });
    await tool.end({ outputs: { ok: true } });
    await parent.end({ outputs: { finalText: 'hi', pass: true } });
    await exporter.flush();

    expect(runs).toHaveLength(3);
    expect(runs[0]?.config).toMatchObject({
      name: 'MCPLab scenario: scenario-1',
      run_type: 'chain',
      project_name: 'mcplab-tests',
      metadata: {
        ls_provider: 'openai',
        ls_model_name: 'gpt-test'
      }
    });
    expect(runs[1]?.config).toMatchObject({
      name: 'LLM turn 0',
      run_type: 'llm',
      metadata: { ls_provider: 'openai', ls_model_name: 'gpt-test' }
    });
    expect(runs[2]?.config).toMatchObject({
      name: 'tool-1',
      run_type: 'tool',
      inputs: { x: 1 },
      metadata: { server: 'server-1', tool: 'tool-1' }
    });
    expect(runs[2]?.config.tags ?? []).not.toContain('mcp-server:server-1');
    expect(runs.every((run) => run.end)).toBe(true);
    expect(runs.every((run) => run.postRun)).toBe(true);
    expect(runs[0]?.postRun).toHaveBeenCalledWith();
    expect(runs[1]?.postRun).toHaveBeenCalledWith();
    expect(runs[2]?.postRun).toHaveBeenCalledWith();
  });

  it('swallows SDK failures and reports a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const factory: LangSmithRunFactory = () => {
      throw new Error('sdk unavailable');
    };
    const exporter = createLangSmithTraceExporter(
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'test-key' },
      factory
    );

    const parent = exporter.startScenario({ scenarioId: 'scenario-1' });
    await parent.end({ outputs: { pass: false } });
    await exporter.flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LangSmith tracing'));
    warn.mockRestore();
  });

  it('returns a direct trace URL after flushing the root run', async () => {
    const projectUrl = vi.fn(async () => 'https://smith.langchain.com/o/org/projects/p/project');
    const root = {
      id: 'root-run-id',
      trace_id: 'root-run-id',
      project_name: 'mcplab-tests',
      client: { getProjectUrl: projectUrl },
      end: vi.fn(async () => undefined),
      postRun: vi.fn(async () => undefined),
      createChild: vi.fn(() => {
        throw new Error('not needed');
      })
    };
    const exporter = createLangSmithTraceExporter(
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'test-key' },
      () => root as any
    );

    const scenario = exporter.startScenario({ requestId: 'request-1', scenarioId: 'scenario-1' });
    await scenario.end({ outputs: { pass: true } });
    const result = await exporter.flush();

    expect(result.traceUrls).toEqual({
      'request-1': 'https://smith.langchain.com/o/org/projects/p/project/r/root-run-id?poll=true'
    });
    expect(projectUrl).toHaveBeenCalledWith({ projectName: 'mcplab-tests' });
  });
});
