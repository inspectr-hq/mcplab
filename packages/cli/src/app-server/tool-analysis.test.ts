import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleToolAnalysisRoutes } from './tool-analysis.js';
import { writeToolAnalysisReportRecord } from './tool-analysis-storage.js';

const tempRoots: string[] = [];

function createBaseDeps() {
  return {
    parseBody: vi.fn(),
    asJson: vi.fn(),
    addJobEvent: vi.fn(),
    sendSseEvent: vi.fn(),
    readLibraries: vi.fn(),
    discoverMcpToolsForServers: vi.fn(),
    runToolAnalysisJob: vi.fn()
  };
}

describe('handleToolAnalysisRoutes', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns outputSchema in discover-tools response payload', async () => {
    const deps = createBaseDeps();
    deps.parseBody.mockResolvedValue({ serverNames: ['demo-server'] });
    deps.readLibraries.mockReturnValue({ servers: {}, agents: {} });
    deps.discoverMcpToolsForServers.mockResolvedValue({
      mcp: {
        getServerVersions: () => ({ 'demo-server': '1.2.3' }),
        getServerImplementations: () => ({
          'demo-server': {
            name: 'demo-server',
            title: 'Demo Server',
            version: '1.2.3',
            icons: [{ src: 'https://example.com/icon.png' }]
          }
        })
      },
      servers: [
        {
          serverName: 'demo-server',
          warnings: [],
          tools: [
            {
              tool: {
                name: 'get_user_profile',
                description: 'Get profile',
                inputSchema: { type: 'object' },
                outputSchema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                  required: ['name']
                }
              },
              safetyClassification: 'read_only',
              classificationReason: 'read prefix'
            }
          ]
        }
      ]
    });

    const handled = await handleToolAnalysisRoutes({
      req: {} as any,
      res: {} as any,
      pathname: '/api/tool-analysis/discover-tools',
      method: 'POST',
      settings: {
        workspaceRoot: '/tmp/ws',
        toolAnalysisResultsDir: '/tmp/ws/mcplab/results/tool-analysis',
        librariesDir: '/tmp/ws/libraries'
      } as any,
      toolAnalysisJobs: new Map(),
      oauthSessionManager: {
        getAuthHeadersForServers: vi.fn().mockResolvedValue({})
      } as any,
      deps: deps as any
    });

    expect(handled).toBe(true);
    expect(deps.asJson).toHaveBeenCalledWith(
      {},
      200,
      expect.objectContaining({
        servers: [
          expect.objectContaining({
            serverName: 'demo-server',
            mcpServerVersion: '1.2.3',
            mcpServerImplementation: expect.objectContaining({
              name: 'demo-server',
              title: 'Demo Server'
            }),
            tools: [
              expect.objectContaining({
                name: 'get_user_profile',
                outputSchema: expect.objectContaining({ type: 'object' })
              })
            ]
          })
        ]
      })
    );
  });

  it('includes legacy tool analysis reports when results dir is the default new path', async () => {
    const deps = createBaseDeps();
    const root = mkdtempSync(join(tmpdir(), 'mcplab-tool-analysis-'));
    tempRoots.push(root);
    const newDir = join(root, 'mcplab/results/tool-analysis');
    const legacyDir = join(root, 'mcplab/tool-analysis-results');
    mkdirSync(newDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });

    writeToolAnalysisReportRecord(legacyDir, {
      recordVersion: 1,
      reportId: 'ta-legacy',
      createdAt: '2026-06-05T00:00:00.000Z',
      sourceJobId: 'job-1',
      serverNames: ['legacy-server'],
      report: {
        assistantAgentName: 'Agent',
        assistantAgentModel: 'model',
        serverName: 'legacy-server',
        serverVersion: '1.0.0',
        tools: [],
        modes: [],
        summary: { totalTools: 0, safeTools: 0, warningTools: 0, blockedTools: 0 }
      } as any
    });

    await handleToolAnalysisRoutes({
      req: {
        url: '/api/tool-analysis-results',
        headers: { host: 'localhost' }
      } as any,
      res: {} as any,
      pathname: '/api/tool-analysis-results',
      method: 'GET',
      settings: {
        workspaceRoot: root,
        toolAnalysisResultsDir: newDir,
        librariesDir: join(root, 'libraries')
      } as any,
      toolAnalysisJobs: new Map(),
      oauthSessionManager: {} as any,
      deps: deps as any
    });

    expect(deps.asJson).toHaveBeenCalledWith(
      {},
      200,
      expect.objectContaining({
        data: [expect.objectContaining({ reportId: 'ta-legacy', serverNames: ['legacy-server'] })]
      })
    );
  });
});
