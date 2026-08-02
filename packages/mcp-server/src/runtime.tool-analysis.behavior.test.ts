import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type RegisteredTool = {
  cb: (args: Record<string, unknown>) => Promise<ToolResponse> | ToolResponse;
};

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type TestFixture = {
  root: string;
  toolAnalysisDir: string;
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

function createFixture(): TestFixture {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
  temporaryRoots.push(root);
  return { root, toolAnalysisDir: join(root, 'results', 'tool-analysis') };
}

async function setupTools(root: string): Promise<Map<string, RegisteredTool>> {
  process.chdir(root);
  process.env.MCPLAB_BUNDLE_ROOT = join(root, 'library');
  process.env.MCPLAB_TOOL_ANALYSIS_DIR = 'results/tool-analysis';
  mkdirSync(process.env.MCPLAB_BUNDLE_ROOT, { recursive: true });
  vi.resetModules();
  const { registerTools } = await import('./runtime.js');
  const tools = new Map<string, RegisteredTool>();
  registerTools({
    registerTool: (name: string, _config: unknown, cb: RegisteredTool['cb']) => {
      tools.set(name, { cb });
      return { name };
    }
  } as unknown as Parameters<typeof registerTools>[0]);
  return tools;
}

function structured(result: ToolResponse): Record<string, unknown> {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent!;
}

function writeReport(toolAnalysisDir: string, reportId: string, record: Record<string, unknown>) {
  const reportDir = join(toolAnalysisDir, reportId);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify(record), 'utf8');
}

describe('tool analysis MCP tool behavior', () => {
  it('lists all saved tool analysis reports with parsed metadata', async () => {
    const { root, toolAnalysisDir } = createFixture();
    writeReport(toolAnalysisDir, 'report-2026-02', {
      recordVersion: 1,
      reportId: 'report-2026-02',
      createdAt: '2026-08-02T10:00:00.000Z',
      sourceJobId: 'job-02',
      serverNames: ['weather', 'files'],
      report: {
        assistantAgentName: 'reviewer',
        assistantAgentModel: 'gpt-test',
        modes: { strict: true },
        summary: { tool_count: 4, issue_count: 1 }
      }
    });
    writeReport(toolAnalysisDir, 'report-2026-01', {
      recordVersion: 1,
      reportId: 'report-2026-01',
      createdAt: '2026-08-01T10:00:00.000Z',
      sourceJobId: 'job-01',
      serverNames: ['calendar'],
      report: { summary: { tool_count: 2, issue_count: 0 } }
    });

    const tools = await setupTools(root);
    const result = await tools.get('mcplab_search_tool_analysis_results')!.cb({});

    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      tool_analysis_results_dir: resolve(realpathSync(root), 'results/tool-analysis'),
      total: 2,
      items: [
        expect.objectContaining({
          report_id: 'report-2026-02',
          reportId: 'report-2026-02',
          sourceJobId: 'job-02',
          serverNames: ['weather', 'files'],
          assistantAgentName: 'reviewer',
          summary: { tool_count: 4, issue_count: 1 }
        }),
        expect.objectContaining({ report_id: 'report-2026-01', reportId: 'report-2026-01' })
      ]
    });
  });

  it('filters saved tool analysis reports by query across report metadata', async () => {
    const { root, toolAnalysisDir } = createFixture();
    writeReport(toolAnalysisDir, 'weather-review', {
      recordVersion: 1,
      reportId: 'weather-review',
      serverNames: ['weather'],
      report: { assistantAgentName: 'reviewer', summary: { issue_count: 2, finding: 'timeout' } }
    });
    writeReport(toolAnalysisDir, 'calendar-review', {
      recordVersion: 1,
      reportId: 'calendar-review',
      serverNames: ['calendar'],
      report: { assistantAgentName: 'reviewer', summary: { issue_count: 0 } }
    });
    writeReport(toolAnalysisDir, 'files-review', {
      recordVersion: 1,
      reportId: 'files-review',
      serverNames: ['files'],
      report: { assistantAgentName: 'other-agent', summary: { issue_count: 1 } }
    });

    const tools = await setupTools(root);
    const agentResult = await tools.get('mcplab_search_tool_analysis_results')!.cb({
      query: 'reviewer',
      limit: 1
    });
    const summaryResult = await tools.get('mcplab_search_tool_analysis_results')!.cb({
      query: 'TIMEOUT',
      limit: 20
    });

    expect(structured(agentResult)).toMatchObject({
      query: 'reviewer',
      total: 2,
      items: [expect.objectContaining({ assistantAgentName: 'reviewer' })]
    });
    expect((structured(agentResult).items as unknown[]).length).toBe(1);
    expect(structured(summaryResult)).toMatchObject({
      query: 'timeout',
      total: 1,
      items: [
        expect.objectContaining({
          report_id: 'weather-review',
          summary: expect.objectContaining({ finding: 'timeout' })
        })
      ]
    });
  });

  it('rejects read report IDs that escape the workspace', async () => {
    const { root } = createFixture();
    const tools = await setupTools(root);

    const result = await tools.get('mcplab_read_tool_analysis_result')!.cb({
      report_id: '../../../outside',
      include_record: false
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Path escapes workspace root');
  });

  it('reads a report without returning the full record when include_record is false', async () => {
    const { root, toolAnalysisDir } = createFixture();
    const record = {
      recordVersion: 1,
      reportId: 'without-record',
      report: { summary: { issue_count: 0 } }
    };
    writeReport(toolAnalysisDir, 'without-record', record);

    const tools = await setupTools(root);
    const result = await tools.get('mcplab_read_tool_analysis_result')!.cb({
      report_id: 'without-record',
      include_record: false
    });

    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      report_id: 'without-record',
      summary: { reportId: 'without-record', summary: { issue_count: 0 } }
    });
    expect('record' in structured(result)).toBe(false);
  });

  it('reads parsed metadata and summary with a truncated raw JSON preview', async () => {
    const { root, toolAnalysisDir } = createFixture();
    const record = {
      recordVersion: 1,
      reportId: 'read-me',
      createdAt: '2026-08-02T12:00:00.000Z',
      sourceJobId: 'job-read',
      serverNames: ['files'],
      report: {
        assistantAgentName: 'analyst',
        assistantAgentModel: 'gpt-test',
        modes: { deep: true },
        summary: { issue_count: 3, tool_count: 8 },
        details: 'x'.repeat(120)
      }
    };
    writeReport(toolAnalysisDir, 'read-me', record);
    const raw = JSON.stringify(record);

    const tools = await setupTools(root);
    const result = await tools.get('mcplab_read_tool_analysis_result')!.cb({
      report_id: 'read-me',
      max_chars: 40,
      include_record: true
    });

    expect(structured(result)).toMatchObject({
      report_id: 'read-me',
      truncated: true,
      summary: {
        reportId: 'read-me',
        createdAt: '2026-08-02T12:00:00.000Z',
        sourceJobId: 'job-read',
        serverNames: ['files'],
        assistantAgentName: 'analyst',
        assistantAgentModel: 'gpt-test',
        modes: { deep: true },
        summary: { issue_count: 3, tool_count: 8 }
      },
      record
    });
    expect(structured(result).raw_json_preview).toBe(
      `${raw.slice(0, 40)}\n...[truncated ${raw.length - 40} chars]`
    );
  });

  it('supports a dry-run delete without removing the report directory', async () => {
    const { root, toolAnalysisDir } = createFixture();
    writeReport(toolAnalysisDir, 'keep-me', { recordVersion: 1, reportId: 'keep-me' });

    const tools = await setupTools(root);
    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'keep-me',
      dry_run: true,
      confirm: false
    });

    expect(structured(result)).toMatchObject({
      status: 'dry_run',
      report_id: 'keep-me',
      existed: true,
      deleted: false,
      would_delete: true
    });
    expect(result.isError).not.toBe(true);
    expect(structured(result).path).toBe(
      resolve(realpathSync(root), 'results/tool-analysis/keep-me')
    );
    expect(structured(result).tool_analysis_results_dir).toBe(
      resolve(realpathSync(root), 'results/tool-analysis')
    );
  });

  it('returns not_found for a confirmed delete of a missing report', async () => {
    const { root } = createFixture();
    const tools = await setupTools(root);

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'missing',
      dry_run: false,
      confirm: true
    });

    expect(structured(result)).toMatchObject({
      status: 'not_found',
      report_id: 'missing',
      existed: false,
      deleted: false,
      would_delete: false
    });
    expect(result.isError).not.toBe(true);
  });

  it('rejects a non-dry-run delete without explicit confirmation', async () => {
    const { root, toolAnalysisDir } = createFixture();
    writeReport(toolAnalysisDir, 'guarded', { recordVersion: 1, reportId: 'guarded' });
    const tools = await setupTools(root);

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'guarded',
      dry_run: false,
      confirm: false
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('confirm=true is required');
    expect(existsSync(resolve(toolAnalysisDir, 'guarded'))).toBe(true);
  });

  it('rejects delete report IDs that escape the workspace', async () => {
    const { root } = createFixture();
    const tools = await setupTools(root);

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: '../../../outside',
      dry_run: true,
      confirm: false
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Path escapes workspace root');
  });

  it('deletes a report directory after confirmation', async () => {
    const { root, toolAnalysisDir } = createFixture();
    writeReport(toolAnalysisDir, 'delete-me', { recordVersion: 1, reportId: 'delete-me' });
    const tools = await setupTools(root);

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'delete-me',
      dry_run: false,
      confirm: true
    });

    expect(structured(result)).toMatchObject({
      status: 'deleted',
      report_id: 'delete-me',
      existed: true,
      deleted: true,
      would_delete: true
    });
    expect(result.isError).not.toBe(true);
    expect(structured(result).path).toBe(
      resolve(realpathSync(root), 'results/tool-analysis/delete-me')
    );
    expect(existsSync(resolve(toolAnalysisDir, 'delete-me'))).toBe(false);
  });

  it('reads the lexicographically greatest report when report_id is "LATEST"', async () => {
    const { root, toolAnalysisDir } = createFixture();
    writeReport(toolAnalysisDir, 'report-2026-01', {
      recordVersion: 1,
      reportId: 'report-2026-01',
      report: { summary: { issue_count: 5 } }
    });
    writeReport(toolAnalysisDir, 'report-2026-02', {
      recordVersion: 1,
      reportId: 'report-2026-02',
      report: { summary: { issue_count: 0 } }
    });

    const tools = await setupTools(root);
    const result = await tools.get('mcplab_read_tool_analysis_result')!.cb({
      report_id: 'LATEST',
      include_record: false
    });

    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      report_id: 'report-2026-02',
      summary: { reportId: 'report-2026-02', summary: { issue_count: 0 } }
    });
  });

  it('errors when reading "LATEST" with no reports present', async () => {
    const { root } = createFixture();
    const tools = await setupTools(root);

    const result = await tools.get('mcplab_read_tool_analysis_result')!.cb({
      report_id: 'LATEST',
      include_record: false
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No tool analysis reports found');
  });
});
