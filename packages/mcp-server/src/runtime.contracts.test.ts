import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { handleMcplabMcpHttpRequest, registerTools } from './runtime.js';

type RegisteredTool = {
  config: { inputSchema?: unknown; outputSchema?: unknown };
  cb: (args: Record<string, unknown>) => Promise<any> | any;
};

function asSchema(schemaOrShape: unknown): z.ZodTypeAny {
  if (schemaOrShape && typeof (schemaOrShape as { safeParse?: unknown }).safeParse === 'function') {
    return schemaOrShape as z.ZodTypeAny;
  }
  return z.object((schemaOrShape ?? {}) as z.ZodRawShape);
}

function setupTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool: (
      name: string,
      config: { inputSchema?: unknown; outputSchema?: unknown },
      cb: (args: Record<string, unknown>) => Promise<any> | any
    ) => {
      tools.set(name, { config, cb });
      return { name };
    }
  };
  registerTools(fakeServer as any);
  return tools;
}

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe('mcp tool contracts', () => {
  it('returns 404 for requests using a stale session after an MCP server restart', async () => {
    const sessions = new Map();
    const response = {
      statusCode: 200,
      headers: new Map<string, string>(),
      setHeader(name: string, value: string) {
        this.headers.set(name, value);
      },
      end() {}
    };
    const request = Object.assign(Readable.from(['{}']), {
      method: 'POST',
      url: '/mcp',
      headers: { host: 'localhost', 'mcp-session-id': 'session-from-before-restart' }
    });

    await handleMcplabMcpHttpRequest(request as any, response as any, sessions, { path: '/mcp' });

    expect(response.statusCode).toBe(404);
  });

  it('uses distinct search descriptions for results, traces, reports, and tool analysis', () => {
    const tools = setupTools();
    expect((tools.get('mcplab_results_search')!.config as any).description).toContain('INDEXED');
    expect((tools.get('mcplab_trace_search')!.config as any).description).toContain('RAW');
    expect((tools.get('mcplab_search_markdown_reports')!.config as any).description).toContain(
      'FILES'
    );
    expect((tools.get('mcplab_search_tool_analysis_results')!.config as any).description).toContain(
      'TOOL-ANALYSIS'
    );
  });

  it('declares scenario names in the shared output schema', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_generate_scenario_entry');
    const scenarioSchema = asSchema((tool!.config.outputSchema as any).scenario);
    const parsed = scenarioSchema.safeParse({
      id: 'named-scenario',
      name: 'Named scenario',
      mcp_servers: [{ ref: 'server-a' }],
      prompt: 'Run the scenario.'
    });

    expect(parsed.success).toBe(true);
    expect((parsed as any).data.name).toBe('Named scenario');
  });

  it('generates scenario-owned MCP server refs', async () => {
    const tool = setupTools().get('mcplab_generate_scenario_entry');
    const result = await tool!.cb({
      id: 'owned-server-scenario',
      servers: ['mcp-lab'],
      prompt: 'Use the MCP server to inspect the library and report the result clearly.'
    });

    expect(result.structuredContent.scenario.mcp_servers).toEqual([{ ref: 'mcp-lab' }]);
    expect(result.structuredContent.scenario.servers).toBeUndefined();
  });

  it('queues runs through the APP with agent and server overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobId: 'job-123', queued: true, position: 2 }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const tool = setupTools().get('mcplab_queue_run');

    const result = await tool!.cb({
      config_path: 'evals/suite.yaml',
      scenario_ids: ['one', 'two'],
      agents: ['gpt-5'],
      runs_per_scenario: 3,
      server_override_all: ['mcp-lab'],
      scenario_server_overrides: { two: ['other-server'] }
    });

    expect(result.structuredContent).toEqual({
      jobId: 'job-123',
      queued: true,
      position: 2,
      queue_url: 'http://127.0.0.1:8787/run'
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8787/api/runs');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      configPath: 'evals/suite.yaml',
      runsPerScenario: 3,
      scenarioIds: ['one', 'two'],
      agents: ['gpt-5'],
      serverOverrideAll: ['mcp-lab'],
      scenarioServerOverrides: { two: ['other-server'] }
    });
    vi.unstubAllGlobals();
  });

  it('clearly distinguishes queueing from immediate evaluation', () => {
    const tools = setupTools();
    const runDescription = (tools.get('mcplab_run_eval')!.config as any).description;
    const queueDescription = (tools.get('mcplab_queue_run')!.config as any).description;

    expect(runDescription).toContain('immediately');
    expect(queueDescription).toContain('APP queue');
    expect(queueDescription).toContain('does not execute');
  });

  it('accepts the actual nested row shape from aggregate runs', () => {
    const tool = setupTools().get('mcplab_aggregate_runs');
    const schema = asSchema(tool!.config.outputSchema);
    const parsed = schema.safeParse({
      runs: [{ run_id: 'run-1', timestamp: '2026-08-31T00:00:00Z', config_hash: 'hash' }],
      group_by: 'run',
      summary: {
        total_runs: 1,
        passed_runs: 1,
        failed_runs: 0,
        pass_rate: 1,
        avg_tool_calls_per_run: 1,
        avg_tool_latency_ms: 10,
        selected_run_count: 1
      },
      top_worst: [
        {
          key: 'run-1',
          run_id: 'run-1',
          run_count: 1,
          summary: {
            total_runs: 1,
            passed_runs: 1,
            failed_runs: 0,
            pass_rate: 1,
            avg_tool_calls_per_run: 1,
            avg_tool_latency_ms: 10
          }
        }
      ],
      top_best: []
    });
    expect(parsed.success).toBe(true);
  });

  it('mcplab_list_library returns canonical array shapes for servers/agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-lib-'));
    const bundle = join(root, 'mcplab');
    mkdirSync(join(bundle, 'scenarios'), { recursive: true });
    writeFileSync(
      join(bundle, 'servers.yaml'),
      'server-a:\n  transport: http\n  url: http://localhost:3001/mcp\n',
      'utf8'
    );
    writeFileSync(
      join(bundle, 'agents.yaml'),
      'agent-a:\n  provider: openai\n  model: gpt-5\n',
      'utf8'
    );
    writeFileSync(
      join(bundle, 'scenarios', 'one.yaml'),
      'id: scenario-one\nservers: [server-a]\nprompt: test\n',
      'utf8'
    );

    const tools = setupTools();
    const tool = tools.get('mcplab_list_library');
    expect(tool).toBeDefined();

    process.chdir(root);
    const result = await tool!.cb({ includeContent: false });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(Array.isArray(sc.servers)).toBe(true);
    expect(Array.isArray(sc.agents)).toBe(true);
    for (const server of sc.servers as Array<Record<string, unknown>>) {
      expect(typeof server.id).toBe('string');
    }
    for (const agent of sc.agents as Array<Record<string, unknown>>) {
      expect(typeof agent.id).toBe('string');
    }

    const outputSchema = asSchema(tool!.config.outputSchema);
    const parsed = outputSchema.safeParse(sc);
    expect(parsed.success).toBe(true);
  });

  it('mcplab_generate_server_entry exposes required inputs and enforces auth requirements at runtime', async () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_generate_server_entry');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.inputSchema);

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ id: 's1' }).success).toBe(false);
    expect(schema.safeParse({ url: 'http://x/mcp' }).success).toBe(false);
    expect(schema.safeParse({ id: 's1', url: 'http://x/mcp', auth_type: 'bearer' }).success).toBe(
      false
    );
    expect(schema.safeParse({ id: 's1', url: 'http://x/mcp', auth_type: 'api_key' }).success).toBe(
      false
    );
    expect(
      schema.safeParse({ id: 's1', url: 'http://x/mcp', auth_type: 'oauth_client_credentials' })
        .success
    ).toBe(false);

    expect(
      schema.safeParse({
        id: 's1',
        url: 'http://x/mcp',
        auth_type: 'bearer',
        bearer_env: 'TOKEN_ENV'
      }).success
    ).toBe(true);

    const bad = await tool!.cb({ id: 's1', url: 'http://x/mcp', auth_type: 'bearer' });
    expect(bad.isError).toBe(true);

    const good = await tool!.cb({
      id: 's1',
      url: 'http://x/mcp',
      auth_type: 'bearer',
      bearer_env: 'TOKEN_ENV'
    });
    expect(good.isError).not.toBe(true);
  });

  it('mcplab_write_markdown_report has explicit output schema with error_code enum', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_write_markdown_report');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.outputSchema);

    expect(
      schema.safeParse({
        ok: true,
        path: '/tmp/a.md',
        bytes: 1,
        chars: 1,
        overwritten: false,
        workspace_root: '/tmp'
      }).success
    ).toBe(true);

    expect(
      schema.safeParse({ ok: false, error_code: 'INVALID_EXTENSION', error_message: 'bad' }).success
    ).toBe(true);

    expect(
      schema.safeParse({ ok: false, error_code: 'NOT_A_REAL_CODE', error_message: 'x' }).success
    ).toBe(false);
  });

  it('mcplab_read_markdown_report rejects traversal/absolute paths', async () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_read_markdown_report');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.inputSchema);
    expect(schema.safeParse({ path: '../../etc/passwd' }).success).toBe(false);
    expect(schema.safeParse({ path: '/etc/passwd' }).success).toBe(false);
    const prefixed = await tool!.cb({ path: 'mcplab/reports/ok.md' });
    expect(prefixed.isError).toBe(true);

    const bad = await tool!.cb({ path: '../../etc/passwd' });
    expect(bad.isError).toBe(true);
  });

  it('mcplab_validate_config output schema has typed scenarios/run_defaults fields', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_validate_config');
    expect(tool).toBeDefined();

    const schema = asSchema(tool!.config.outputSchema);
    const parsed = schema.safeParse({
      configPath: '/tmp/eval.yaml',
      bundleRoot: '/tmp',
      hash: 'abc',
      summary: {
        server_count: 1,
        agent_count: 1,
        scenario_count: 1,
        servers: ['s1'],
        agents: ['a1'],
        scenarios: [{ id: 'x', servers: ['s1'], has_eval: false, extract_count: 0 }]
      },
      resolved_config: {
        servers: { s1: { transport: 'http', url: 'http://localhost:3001/mcp' } },
        agents: { a1: { provider: 'openai', model: 'gpt-5' } },
        scenarios: [
          {
            id: 'x',
            servers: ['s1'],
            prompt: 'p',
            eval: { response_assertions: [{ type: 'contains', value: 'ok' }] }
          }
        ],
        run_defaults: { selected_agents: ['a1'], timeout_ms: 1000 }
      }
    });
    expect(parsed.success).toBe(true);
  });

  it('mcplab_delete_tool_analysis_result requires confirm when dry_run=false', async () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_delete_tool_analysis_result');
    expect(tool).toBeDefined();
    const denied = await tool!.cb({ report_id: 'r1', dry_run: false, confirm: false });
    expect(denied.isError).toBe(true);
  });

  it('public MCP schemas do not expose directory override args', () => {
    const tools = setupTools();
    const schemaObject = (name: string): Record<string, unknown> => {
      const schema = tools.get(name)!.config.inputSchema as Record<string, unknown>;
      return schema ?? {};
    };

    expect('reports_dir' in schemaObject('mcplab_search_markdown_reports')).toBe(false);
    expect('reports_dir' in schemaObject('mcplab_read_markdown_report')).toBe(false);
    expect('runs_dir' in schemaObject('mcplab_results_search')).toBe(false);
    expect('runs_dir' in schemaObject('mcplab_results_context')).toBe(false);
    expect('runs_dir' in schemaObject('mcplab_trace_search')).toBe(false);
    expect('tool_analysis_results_dir' in schemaObject('mcplab_search_tool_analysis_results')).toBe(
      false
    );
    expect('tool_analysis_results_dir' in schemaObject('mcplab_read_tool_analysis_result')).toBe(
      false
    );
    expect('tool_analysis_results_dir' in schemaObject('mcplab_delete_tool_analysis_result')).toBe(
      false
    );
    expect('bundleRoot' in schemaObject('mcplab_list_library')).toBe(false);
  });

  it('mcplab_results_search requires non-empty query', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_results_search');
    expect(tool).toBeDefined();
    const schema = asSchema(tool!.config.inputSchema);
    expect(schema.safeParse({ query: '' }).success).toBe(false);
    expect(schema.safeParse({ query: 'timeout' }).success).toBe(true);
  });

  it('mcplab_results_context schema keeps around/source inputs for trace context', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_results_context');
    expect(tool).toBeDefined();
    const schema = asSchema(tool!.config.inputSchema);
    expect(schema.safeParse({ run_id: 'r1', scenario_id: 's1' }).success).toBe(true);
    expect(
      schema.safeParse({ run_id: 'r1', scenario_id: 's1', source: 'trace', around: 42 }).success
    ).toBe(true);
  });

  it('mcplab_search_markdown_reports schema supports pagination and defaults', () => {
    const tools = setupTools();
    const tool = tools.get('mcplab_search_markdown_reports');
    expect(tool).toBeDefined();
    const schema = asSchema(tool!.config.inputSchema);
    expect(schema.safeParse({ offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    const parsed = schema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(0);
  });
});
