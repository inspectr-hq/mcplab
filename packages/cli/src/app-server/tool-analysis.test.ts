import { describe, expect, it, vi } from 'vitest';
import { handleToolAnalysisRoutes } from './tool-analysis.js';

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
              safetyClassification: 'read_like',
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
});
