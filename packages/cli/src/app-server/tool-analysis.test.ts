import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClientManager } from '@inspectr/mcplab-core';
import { handleToolAnalysisRoutes } from './tool-analysis.js';
import { writeToolAnalysisReportRecord } from './tool-analysis-storage.js';
import { OAuthAuthorizationRequiredError } from './oauth-session-manager.js';

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
    vi.restoreAllMocks();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns outputSchema in discover-tools response payload', async () => {
    const deps = createBaseDeps();
    deps.parseBody.mockResolvedValue({
      serverNames: ['demo-server'],
      includeCatalog: true,
      includeToolResources: true
    });
    deps.readLibraries.mockReturnValue({ servers: {}, agents: {} });
    deps.discoverMcpToolsForServers.mockResolvedValue({
      mcp: {
        getServerVersions: () => ({ 'demo-server': '1.2.3' }),
        disconnectAll: vi.fn(),
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
          catalog: {
            resources: { status: 'ready', items: [{ name: 'Guide', uri: 'docs://guide' }] },
            resourceTemplates: { status: 'error', message: 'Listing failed' },
            prompts: { status: 'unsupported' }
          },
          tokenEstimate: {
            toolCount: 1,
            total: 42,
            tools: [{ name: 'get_user_profile', total: 42 }],
            method: 'js_tiktoken_fallback'
          },
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
    expect(deps.discoverMcpToolsForServers).toHaveBeenCalledWith({}, ['demo-server'], {
      includeCatalog: true,
      includeToolResources: true,
      serverAuthHeaders: undefined
    });
    expect(deps.asJson).toHaveBeenCalledWith(
      {},
      200,
      expect.objectContaining({
        servers: [
          expect.objectContaining({
            serverName: 'demo-server',
            mcpServerVersion: '1.2.3',
            catalog: expect.objectContaining({
              resources: { status: 'ready', items: [{ name: 'Guide', uri: 'docs://guide' }] },
              resourceTemplates: { status: 'error', message: 'Listing failed' }
            }),
            mcpServerImplementation: expect.objectContaining({
              name: 'demo-server',
              title: 'Demo Server'
            }),
            tools: [
              expect.objectContaining({
                name: 'get_user_profile',
                outputSchema: expect.objectContaining({ type: 'object' })
              })
            ],
            tokenEstimate: expect.objectContaining({
              toolCount: 1,
              total: 42,
              tools: [{ name: 'get_user_profile', total: 42 }]
            })
          })
        ]
      })
    );
  });

  it('starts fresh authorization after an OAuth refresh grant fails', async () => {
    const deps = createBaseDeps();
    deps.parseBody.mockResolvedValue({ serverNames: ['demo'] });
    deps.readLibraries.mockReturnValue({
      servers: {
        demo: {
          transport: 'http',
          url: 'https://example.com/mcp',
          auth: { type: 'oauth_authorization_code' }
        }
      },
      agents: {}
    });
    const authRequired = new OAuthAuthorizationRequiredError([
      {
        serverName: 'demo',
        runtimeSessionId: 'oauthrt-new',
        message: 'OAuth authorization required for server \'demo\'.'
      }
    ]);
    const oauthSessionManager = {
      getAuthHeadersForServers: vi.fn().mockResolvedValue({
        demo: { authorization: 'Bearer original' }
      }),
      refreshAfterUnauthorized: vi.fn().mockResolvedValue(false),
      reauthorizeAfterUnauthorized: vi.fn().mockRejectedValue(authRequired)
    };
    deps.discoverMcpToolsForServers.mockImplementation(async (_servers, _names, options) => {
      await options.refreshOAuthHeaders('demo');
    });
    const res = {};

    await handleToolAnalysisRoutes({
      req: { headers: { host: 'localhost' } } as any,
      res: res as any,
      pathname: '/api/tool-analysis/discover-tools',
      method: 'POST',
      settings: { librariesDir: '/tmp/ws/libraries' } as any,
      toolAnalysisJobs: new Map(),
      oauthSessionManager: oauthSessionManager as any,
      deps: deps as any
    });

    expect(oauthSessionManager.refreshAfterUnauthorized).toHaveBeenCalledWith('demo');
    expect(oauthSessionManager.reauthorizeAfterUnauthorized).toHaveBeenCalledWith(
      'demo',
      'localhost'
    );
    expect(oauthSessionManager.getAuthHeadersForServers).toHaveBeenCalledOnce();
    expect(deps.asJson).toHaveBeenCalledWith(res, 401, {
      error: authRequired.message,
      oauth: { required: authRequired.details }
    });
  });

  describe('preview', () => {
    const server = {
      transport: 'http',
      url: 'https://example.com/mcp',
      auth: { type: 'oauth_authorization_code' }
    };

    async function preview(body: unknown) {
      const deps = createBaseDeps();
      deps.parseBody.mockResolvedValue(body);
      deps.readLibraries.mockReturnValue({ servers: { demo: server }, agents: {} });
      const getAuthHeadersForServers = vi
        .fn()
        .mockResolvedValue({ demo: { Authorization: 'token' } });
      const res = { once: vi.fn(), off: vi.fn() };
      const handled = await handleToolAnalysisRoutes({
        req: { headers: { host: 'localhost' } } as any,
        res: res as any,
        pathname: '/api/tool-analysis/preview',
        method: 'POST',
        settings: { librariesDir: '/tmp/ws/libraries' } as any,
        toolAnalysisJobs: new Map(),
        oauthSessionManager: { getAuthHeadersForServers } as any,
        deps: deps as any
      });
      expect(handled).toBe(true);
      return { respond: deps.asJson, res, getAuthHeadersForServers };
    }

    it('uses the configured server and OAuth headers to read a resource and disconnects', async () => {
      const connect = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
      const close = vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
      const contents = [
        { uri: 'docs://guide', text: 'Guide' },
        { uri: 'docs://logo', blobBytes: 3 }
      ];
      const read = vi.spyOn(McpClientManager.prototype, 'readResource').mockResolvedValue(contents);
      vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
        resources: true,
        prompts: false,
        tools: false
      });
      const { respond, res, getAuthHeadersForServers } = await preview({
        kind: 'resource',
        serverName: 'demo',
        uri: 'docs://guide'
      });
      expect(getAuthHeadersForServers).toHaveBeenCalledWith(['demo'], 'localhost');
      expect(connect).toHaveBeenCalledWith({ demo: server }, expect.any(AbortSignal), {
        serverAuthHeaders: { demo: { Authorization: 'token' } }
      });
      expect(read).toHaveBeenCalledWith('demo', 'docs://guide', expect.any(AbortSignal));
      expect(respond).toHaveBeenCalledWith(res, 200, { kind: 'resource', contents });
      expect(close).toHaveBeenCalledOnce();
    });

    it('rejects non-string prompt arguments before connecting', async () => {
      const connect = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
      const { respond, res } = await preview({
        kind: 'prompt',
        serverName: 'demo',
        name: 'review',
        arguments: { topic: 42 }
      });
      expect(respond).toHaveBeenCalledWith(
        res,
        400,
        expect.objectContaining({ error: expect.any(String) })
      );
      expect(connect).not.toHaveBeenCalled();
    });

    it('reads a tool catalog resource through the advertised URI argument', async () => {
      vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
      vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
      vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
        tools: true,
        resources: false,
        prompts: false
      });
      vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([
        {
          name: 'read_resource',
          inputSchema: { type: 'object', properties: { resource_uri: { type: 'string' } } }
        }
      ]);
      const call = vi
        .spyOn(McpClientManager.prototype, 'callTool')
        .mockResolvedValue({ content: [{ type: 'text', text: '# Review' }] });
      const { respond, res } = await preview({
        kind: 'resource',
        serverName: 'demo',
        uri: 'skill://review/SKILL.md',
        via: 'tool'
      });
      expect(call).toHaveBeenCalledWith(
        'demo',
        'read_resource',
        { resource_uri: 'skill://review/SKILL.md' },
        { signal: expect.any(AbortSignal) }
      );
      expect(respond).toHaveBeenCalledWith(res, 200, {
        kind: 'resource',
        contents: [{ uri: 'skill://review/SKILL.md', text: '# Review' }]
      });
    });

    it('returns a preview error and disconnects when the server cannot render the prompt', async () => {
      vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
      const close = vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
      const get = vi
        .spyOn(McpClientManager.prototype, 'getPrompt')
        .mockRejectedValue(new Error('Prompt unavailable'));
      vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
        resources: false,
        prompts: true,
        tools: false
      });
      const { respond, res } = await preview({
        kind: 'prompt',
        serverName: 'demo',
        name: 'review',
        arguments: { topic: 'docs' }
      });
      expect(get).toHaveBeenCalledWith(
        'demo',
        'review',
        { topic: 'docs' },
        expect.any(AbortSignal)
      );
      expect(respond).toHaveBeenCalledWith(res, 502, { error: 'Prompt unavailable' });
      expect(close).toHaveBeenCalledOnce();
    });
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
