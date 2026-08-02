import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  root: string,
  toolAnalysisDir: string
): Promise<Map<string, RegisteredTool>> {
  process.chdir(root);
  process.env.MCPLAB_BUNDLE_ROOT = join(root, 'library');
  process.env.MCPLAB_TOOL_ANALYSIS_DIR = toolAnalysisDir;
  mkdirSync(process.env.MCPLAB_BUNDLE_ROOT, { recursive: true });
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

function writeReport(toolAnalysisDir: string, reportId: string, record: Record<string, unknown>) {
  const reportDir = join(toolAnalysisDir, reportId);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify(record), 'utf8');
}

describe('tool analysis MCP tool behavior', () => {
  it('lists all saved tool analysis reports with parsed metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const toolAnalysisDir = join(root, 'results', 'tool-analysis');
    writeReport(toolAnalysisDir, 'report-2026-02', {
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
      reportId: 'report-2026-01',
      createdAt: '2026-08-01T10:00:00.000Z',
      sourceJobId: 'job-01',
      serverNames: ['calendar'],
      report: { summary: { tool_count: 2, issue_count: 0 } }
    });

    const tools = await setupTools(root, 'results/tool-analysis');
    const result = await tools.get('mcplab_search_tool_analysis_results')!.cb({});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
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
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const toolAnalysisDir = join(root, 'results', 'tool-analysis');
    writeReport(toolAnalysisDir, 'weather-review', {
      reportId: 'weather-review',
      serverNames: ['weather'],
      report: { assistantAgentName: 'reviewer', summary: { issue_count: 2 } }
    });
    writeReport(toolAnalysisDir, 'calendar-review', {
      reportId: 'calendar-review',
      serverNames: ['calendar'],
      report: { assistantAgentName: 'reviewer', summary: { issue_count: 0 } }
    });

    const tools = await setupTools(root, 'results/tool-analysis');
    const result = await tools.get('mcplab_search_tool_analysis_results')!.cb({
      query: 'WEATHER',
      limit: 20
    });

    expect(result.structuredContent).toMatchObject({
      query: 'weather',
      total: 1,
      items: [expect.objectContaining({ report_id: 'weather-review' })]
    });
  });

  it('reads parsed metadata and summary with a truncated raw JSON preview', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const toolAnalysisDir = join(root, 'results', 'tool-analysis');
    const record = {
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

    const tools = await setupTools(root, 'results/tool-analysis');
    const result = await tools.get('mcplab_read_tool_analysis_result')!.cb({
      report_id: 'read-me',
      max_chars: 40,
      include_record: true
    });

    expect(result.structuredContent).toMatchObject({
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
    expect(result.structuredContent.raw_json_preview).toBe(
      `${raw.slice(0, 40)}\n...[truncated ${raw.length - 40} chars]`
    );
  });

  it('supports a dry-run delete without removing the report directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const toolAnalysisDir = join(root, 'results', 'tool-analysis');
    writeReport(toolAnalysisDir, 'keep-me', { reportId: 'keep-me' });

    const tools = await setupTools(root, 'results/tool-analysis');
    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'keep-me',
      dry_run: true,
      confirm: false
    });

    expect(result.structuredContent).toMatchObject({
      status: 'dry_run',
      report_id: 'keep-me',
      existed: true,
      deleted: false,
      would_delete: true
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.path).toBe(
      resolve(realpathSync(root), 'results/tool-analysis/keep-me')
    );
    expect(result.structuredContent.tool_analysis_results_dir).toBe(
      resolve(realpathSync(root), 'results/tool-analysis')
    );
  });

  it('returns not_found for a confirmed delete of a missing report', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const tools = await setupTools(root, 'results/tool-analysis');

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'missing',
      dry_run: false,
      confirm: true
    });

    expect(result.structuredContent).toMatchObject({
      status: 'not_found',
      report_id: 'missing',
      existed: false,
      deleted: false,
      would_delete: false
    });
    expect(result.isError).not.toBe(true);
  });

  it('rejects a non-dry-run delete without explicit confirmation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const toolAnalysisDir = join(root, 'results', 'tool-analysis');
    writeReport(toolAnalysisDir, 'guarded', { reportId: 'guarded' });
    const tools = await setupTools(root, 'results/tool-analysis');

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'guarded',
      dry_run: false,
      confirm: false
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm=true is required');
    expect(existsSync(resolve(toolAnalysisDir, 'guarded'))).toBe(true);
  });

  it('deletes a report directory after confirmation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-tool-analysis-'));
    temporaryRoots.push(root);
    const toolAnalysisDir = join(root, 'results', 'tool-analysis');
    writeReport(toolAnalysisDir, 'delete-me', { reportId: 'delete-me' });
    const tools = await setupTools(root, 'results/tool-analysis');

    const result = await tools.get('mcplab_delete_tool_analysis_result')!.cb({
      report_id: 'delete-me',
      dry_run: false,
      confirm: true
    });

    expect(result.structuredContent).toMatchObject({
      status: 'deleted',
      report_id: 'delete-me',
      existed: true,
      deleted: true,
      would_delete: true
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.path).toBe(
      resolve(realpathSync(root), 'results/tool-analysis/delete-me')
    );
    expect(existsSync(resolve(toolAnalysisDir, 'delete-me'))).toBe(false);
  });
});
