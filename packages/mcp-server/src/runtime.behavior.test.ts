import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type RegisteredTool = {
  cb: (args: Record<string, unknown>) => Promise<any> | any;
};

const originalEnvironment = { ...process.env };
const originalCwd = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

async function setupTools(
  bundleRoot: string,
  options: { runsDir?: string; reportsDir?: string } = {}
): Promise<Map<string, RegisteredTool>> {
  process.chdir(join(bundleRoot, '..'));
  process.env.MCPLAB_BUNDLE_ROOT = bundleRoot;
  if (options.runsDir) process.env.MCPLAB_RUNS_DIR = options.runsDir;
  if (options.reportsDir) process.env.MCPLAB_REPORTS_DIR = options.reportsDir;
  vi.resetModules();
  const { registerTools } = await import('./runtime.js');
  const tools = new Map<string, RegisteredTool>();
  registerTools({
    registerTool: (name: string, _config: unknown, cb: RegisteredTool['cb']) => {
      tools.set(name, { cb });
      return { name };
    }
  } as any);
  return tools;
}

describe('mcp tool behavior', () => {
  it('lists Test Cases from the canonical test-cases directory when filtering scenarios', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-library-'));
    temporaryRoots.push(root);
    const libraryRoot = join(root, 'library');
    mkdirSync(join(libraryRoot, 'test-cases'), { recursive: true });
    writeFileSync(
      join(libraryRoot, 'test-cases', 'tag-profile.yaml'),
      'id: tag-profile\nprompt: Find a tag profile\nmcp_servers:\n  - ref: tags\n',
      'utf8'
    );

    const tools = await setupTools(libraryRoot);
    const result = await tools.get('mcplab_list_library')!.cb({
      kind: 'scenarios',
      includeContent: true
    });

    expect(result.structuredContent.scenarios).toEqual([
      expect.objectContaining({
        file: 'tag-profile.yaml',
        id: 'tag-profile',
        content: expect.objectContaining({ id: 'tag-profile' })
      })
    ]);
  });

  it('retrieves a Test Case by its scenario id from the canonical directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-library-'));
    temporaryRoots.push(root);
    const libraryRoot = join(root, 'library');
    mkdirSync(join(libraryRoot, 'test-cases'), { recursive: true });
    writeFileSync(
      join(libraryRoot, 'test-cases', 'tag-profile.yaml'),
      'id: tag-profile\nprompt: Find a tag profile\nmcp_servers:\n  - ref: tags\n',
      'utf8'
    );

    const tools = await setupTools(libraryRoot);
    const result = await tools.get('mcplab_get_library_item')!.cb({
      kind: 'scenarios',
      id: 'tag-profile'
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: 'scenarios',
      id: 'tag-profile',
      file: 'tag-profile.yaml',
      content: { prompt: 'Find a tag profile', mcp_servers: [{ ref: 'tags' }] }
    });
  });

  it('validates a config that references library servers, agents, and Test Cases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-validate-'));
    temporaryRoots.push(root);
    const libraryRoot = join(root, 'library');
    mkdirSync(join(libraryRoot, 'test-cases'), { recursive: true });
    writeFileSync(
      join(libraryRoot, 'servers.yaml'),
      'tags:\n  transport: http\n  url: http://127.0.0.1:3333/mcp\n',
      'utf8'
    );
    writeFileSync(
      join(libraryRoot, 'agents.yaml'),
      'test-agent:\n  provider: openai\n  model: gpt-test\n',
      'utf8'
    );
    writeFileSync(
      join(libraryRoot, 'test-cases', 'tag-profile.yaml'),
      'id: tag-profile\nprompt: Find a tag profile\nmcp_servers:\n  - ref: tags\n',
      'utf8'
    );
    const configPath = join(root, 'eval.yaml');
    writeFileSync(
      configPath,
      'servers: []\nagents:\n  - ref: test-agent\nscenarios:\n  - ref: tag-profile\n',
      'utf8'
    );

    const tools = await setupTools(libraryRoot);
    const result = await tools.get('mcplab_validate_config')!.cb({ config_path: configPath });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.resolved_config).toMatchObject({
      servers: { tags: expect.any(Object) },
      agents: { 'test-agent': expect.any(Object) },
      scenarios: [expect.objectContaining({ id: 'tag-profile', servers: ['tags'] })]
    });
  });

  it('runs an empty selection with an agent override without changing the source config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-run-'));
    temporaryRoots.push(root);
    const libraryRoot = join(root, 'library');
    mkdirSync(libraryRoot, { recursive: true });
    writeFileSync(
      join(libraryRoot, 'servers.yaml'),
      'unused-server:\n  transport: http\n  url: http://127.0.0.1:3333/mcp\n',
      'utf8'
    );
    writeFileSync(
      join(libraryRoot, 'agents.yaml'),
      'test-agent:\n  provider: openai\n  model: gpt-test\n',
      'utf8'
    );
    const configPath = join(root, 'empty-eval.yaml');
    const source = 'servers: []\nagents:\n  - ref: test-agent\nscenarios: []\n';
    writeFileSync(configPath, source, 'utf8');

    const tools = await setupTools(libraryRoot, { runsDir: 'runs' });
    const result = await tools.get('mcplab_run_eval')!.cb({
      config_path: configPath,
      agent_override: ['test-agent'],
      server_override_all: ['unused-server']
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      total_scenarios: 0,
      total_runs: 0,
      effective_agent_override: ['test-agent'],
      effective_server_overrides: {}
    });
    expect(readFileSync(configPath, 'utf8')).toBe(source);
  });

  it('returns generator drafts without writing library files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-generate-'));
    temporaryRoots.push(root);
    const libraryRoot = join(root, 'library');
    mkdirSync(join(libraryRoot, 'test-cases'), { recursive: true });
    const tools = await setupTools(libraryRoot);

    const agent = await tools.get('mcplab_generate_agent_entry')!.cb({
      id: 'draft-agent',
      provider: 'openai',
      model: 'gpt-test'
    });
    const scenario = await tools.get('mcplab_generate_scenario_entry')!.cb({
      id: 'draft-case',
      servers: ['tags'],
      prompt: 'Draft a test case',
      as_library_file: true
    });
    const server = await tools.get('mcplab_generate_server_entry')!.cb({
      id: 'draft-server',
      url: 'http://127.0.0.1:3333/mcp'
    });

    expect(agent.structuredContent).toMatchObject({ id: 'draft-agent' });
    expect(scenario.structuredContent).toMatchObject({
      scenario: { id: 'draft-case' },
      format: 'library-scenario-file'
    });
    expect(server.structuredContent).toMatchObject({ id: 'draft-server' });
    expect(existsSync(join(libraryRoot, 'agents.yaml'))).toBe(false);
    expect(existsSync(join(libraryRoot, 'servers.yaml'))).toBe(false);
    expect(existsSync(join(libraryRoot, 'test-cases', 'draft-case.yaml'))).toBe(false);
  });

  it('writes Markdown only inside the workspace and rejects a path escape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-report-'));
    temporaryRoots.push(root);
    process.chdir(root);
    const tools = await setupTools(join(root, 'library'), { reportsDir: 'reports' });

    const written = await tools.get('mcplab_write_markdown_report')!.cb({
      output_path: 'reports/investigation.md',
      markdown: '# Investigation',
      overwrite: false,
      create_dirs: true
    });
    const escaped = await tools.get('mcplab_write_markdown_report')!.cb({
      output_path: '../outside.md',
      markdown: '# Not allowed'
    });

    expect(written.structuredContent).toMatchObject({ ok: true, overwritten: false });
    expect(readFileSync(join(root, 'reports', 'investigation.md'), 'utf8')).toBe('# Investigation\n');
    expect(escaped.isError).toBe(true);
    expect(escaped.structuredContent).toMatchObject({ error_code: 'PATH_ESCAPE' });
  });

  it('filters run listings by time and filters trace events by scenario and agent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-results-'));
    temporaryRoots.push(root);
    const runsDir = join(root, 'runs');
    const runDir = join(runsDir, 'run-new');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'results.json'),
      JSON.stringify({
        metadata: {
          run_id: 'run-new',
          timestamp: '2026-08-01T12:00:00.000Z',
          config_hash: 'hash',
          cli_version: 'test',
          mcp_server_versions: {}
        },
        summary: {
          total_scenarios: 1,
          total_runs: 1,
          pass_rate: 1,
          avg_tool_calls_per_run: 1,
          avg_tool_latency_ms: 10
        },
        scenarios: []
      }),
      'utf8'
    );
    writeFileSync(
      join(runDir, 'trace.jsonl'),
      `${JSON.stringify({
        type: 'scenario_run',
        trace_version: 3,
        scenario_id: 'tag-profile',
        agent: 'test-agent',
        provider: 'openai',
        model: 'gpt-test',
        ts_start: '2026-08-01T12:00:00.000Z',
        ts_end: '2026-08-01T12:00:01.000Z',
        pass: true,
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Done' }] }]
      })}\n`,
      'utf8'
    );
    const tools = await setupTools(join(root, 'library'), { runsDir: 'runs' });

    const listed = await tools.get('mcplab_list_runs')!.cb({
      since: '2026-08-01T00:00:00.000Z',
      until: '2026-08-01T23:59:59.000Z'
    });
    const trace = await tools.get('mcplab_trace_list_events')!.cb({
      run_id: 'run-new',
      scenario_id: 'tag-profile',
      agent: 'test-agent',
      event_types: ['text']
    });

    expect(listed.structuredContent).toMatchObject({
      total_matching: 1,
      runs: [expect.objectContaining({ run_id: 'run-new' })]
    });
    expect(trace.structuredContent).toMatchObject({
      total_matching: 1,
      items: [expect.objectContaining({ type: 'text', text: 'Done' })]
    });
  });
});
