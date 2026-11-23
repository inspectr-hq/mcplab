import { describe, it, expect, vi } from 'vitest';
import { McpClientManager } from '@inspectr/mcplab-core';
import { OAuthAuthorizationRequiredError } from './oauth-session-manager.js';
import {
  buildToolAnalysisExecutionReviewPayload,
  buildToolAnalysisMetadataPayload,
  buildToolAnalysisSamplePlanPayload,
  classifyToolSafety,
  discoverMcpToolsForServers,
  parseJsonFromAssistantText
} from './tool-analysis-domain.js';
import { pickDefaultAssistantAgentName } from './assistant-agent.js';

describe('discoverMcpToolsForServers', () => {
  it('refreshes and reconnects once when the MCP handshake returns invalid_token', async () => {
    const server = { transport: 'http' as const, url: 'https://example.com/mcp' };
    const connect = vi
      .spyOn(McpClientManager.prototype, 'connectAll')
      .mockRejectedValueOnce(
        new Error('Streamable HTTP error: {"error": "invalid_token"}')
      )
      .mockResolvedValueOnce();
    vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([]);
    const refreshOAuthHeaders = vi.fn().mockResolvedValue({ authorization: 'Bearer fresh' });
    try {
      const result = await discoverMcpToolsForServers(
        { demo: server },
        ['demo'],
        { refreshOAuthHeaders }
      );
      expect(result.servers[0].warnings).toEqual([]);
      expect(refreshOAuthHeaders).toHaveBeenCalledOnce();
      expect(connect).toHaveBeenCalledTimes(2);
      expect(connect.mock.calls[1][2]).toEqual({
        serverAuthHeaders: { demo: { authorization: 'Bearer fresh' } }
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('starts fresh authorization if the refreshed token is also rejected', async () => {
    const server = { transport: 'http' as const, url: 'https://example.com/mcp' };
    const connect = vi
      .spyOn(McpClientManager.prototype, 'connectAll')
      .mockRejectedValue(new Error('Streamable HTTP error: {"error": "invalid_token"}'));
    const disconnect = vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    const refreshOAuthHeaders = vi.fn().mockResolvedValue({ authorization: 'Bearer fresh' });
    const reauthorizeOAuth = vi
      .fn()
      .mockRejectedValue(
        new OAuthAuthorizationRequiredError([
          {
            serverName: 'demo',
            runtimeSessionId: 'oauthrt-new',
            message: 'OAuth authorization required for server \'demo\'.'
          }
        ])
      );
    try {
      await expect(
        discoverMcpToolsForServers({ demo: server }, ['demo'], {
          refreshOAuthHeaders,
          reauthorizeOAuth
        })
      ).rejects.toMatchObject({
        name: 'OAuthAuthorizationRequiredError',
        details: [expect.objectContaining({ runtimeSessionId: 'oauthrt-new' })]
      });
      expect(connect).toHaveBeenCalledTimes(2);
      expect(refreshOAuthHeaders).toHaveBeenCalledOnce();
      expect(reauthorizeOAuth).toHaveBeenCalledOnce();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('refreshes and reconnects when listing tools returns invalid_token', async () => {
    const server = { transport: 'http' as const, url: 'https://example.com/mcp' };
    const connect = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    const listTools = vi
      .spyOn(McpClientManager.prototype, 'listTools')
      .mockRejectedValueOnce(new Error('Streamable HTTP error: {"error": "invalid_token"}'))
      .mockResolvedValueOnce([]);
    const refreshOAuthHeaders = vi.fn().mockResolvedValue({ authorization: 'Bearer fresh' });
    try {
      const result = await discoverMcpToolsForServers(
        { demo: server },
        ['demo'],
        { refreshOAuthHeaders }
      );
      expect(result.servers[0].warnings).toEqual([]);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(listTools).toHaveBeenCalledTimes(2);
      expect(refreshOAuthHeaders).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('calls the advertised resource listing tool only on explicit request', async () => {
    const servers = { docs: { transport: 'http' as const, url: 'https://example.com/mcp' } };
    vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
      tools: true,
      resources: false,
      prompts: false
    });
    vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([
      { name: 'list_resources', inputSchema: { type: 'object' } },
      {
        name: 'read_resource',
        inputSchema: { type: 'object', properties: { uri: { type: 'string' } } }
      }
    ]);
    vi.spyOn(McpClientManager.prototype, 'listCatalog').mockImplementation(async () => ({
      resources: { status: 'unsupported' },
      resourceTemplates: { status: 'unsupported' },
      prompts: { status: 'unsupported' }
    }));
    const call = vi.spyOn(McpClientManager.prototype, 'callTool').mockResolvedValue({
      structuredContent: { resources: [{ name: 'Review', uri: 'skill://review/SKILL.md' }] }
    });
    try {
      const initial = await discoverMcpToolsForServers(servers, ['docs'], { includeCatalog: true });
      expect(initial.servers[0].catalog?.toolResources).toEqual({ status: 'available' });
      expect(call).not.toHaveBeenCalled();
      const requested = await discoverMcpToolsForServers(servers, ['docs'], {
        includeCatalog: true,
        includeToolResources: true
      });
      expect(requested.servers[0].catalog?.toolResources).toEqual({
        status: 'ready',
        canRead: true,
        resources: [
          { name: 'Review', uri: 'skill://review/SKILL.md', estimatedTokens: expect.any(Number) }
        ],
        resourceTemplates: []
      });
      expect(call).toHaveBeenCalledWith('docs', 'list_resources', {});
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([true, false])(
    'preserves tools-only discovery and lists a resource-only server when catalog access is %s',
    async (includeCatalog) => {
      const servers = { docs: { transport: 'http' as const, url: 'https://example.com/mcp' } };
      const catalog = {
        resources: { status: 'ready' as const, items: [{ name: 'Guide', uri: 'docs://guide' }] },
        resourceTemplates: { status: 'ready' as const, items: [] },
        prompts: { status: 'unsupported' as const }
      };
      const connect = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
      const features = vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
        tools: false,
        resources: true,
        prompts: false
      });
      const listTools = vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([]);
      const listCatalog = vi
        .spyOn(McpClientManager.prototype, 'listCatalog')
        .mockResolvedValue(catalog);
      try {
        const {
          servers: [discovered]
        } = await discoverMcpToolsForServers(servers, ['docs'], { includeCatalog });
        expect(discovered.catalog).toEqual(
          includeCatalog
            ? {
                ...catalog,
                resources: {
                  status: 'ready',
                  items: [
                    { name: 'Guide', uri: 'docs://guide', estimatedTokens: expect.any(Number) }
                  ]
                }
              }
            : undefined
        );
        expect(discovered.tools).toEqual([]);
        expect(discovered.warnings).toEqual([]);
        expect(listCatalog).toHaveBeenCalledTimes(includeCatalog ? 1 : 0);
        expect(listTools).toHaveBeenCalledTimes(includeCatalog ? 0 : 1);
      } finally {
        connect.mockRestore();
        features.mockRestore();
        listTools.mockRestore();
        listCatalog.mockRestore();
      }
    }
  );

  it('returns a "not found" warning when server name does not match any key', async () => {
    const servers = {
      trendminer: { transport: 'http' as const, url: 'https://example.com/mcp' }
    };
    const { servers: results } = await discoverMcpToolsForServers(servers, ['TrendMiner']);
    expect(results).toHaveLength(1);
    expect(results[0].serverName).toBe('TrendMiner');
    expect(results[0].warnings).toEqual(["Server 'TrendMiner' not found."]);
    expect(results[0].tools).toEqual([]);
  });

  it('finds a server when the exact key is used', async () => {
    const servers = {
      trendminer: { transport: 'http' as const, url: 'https://example.com/mcp' }
    };
    const { servers: results } = await discoverMcpToolsForServers(servers, ['trendminer']);
    expect(results).toHaveLength(1);
    expect(results[0].serverName).toBe('trendminer');
    // Connection will fail since there's no real server, but it should NOT be "not found"
    const notFoundWarning = results[0].warnings.find((w) => w.includes('not found'));
    expect(notFoundWarning).toBeUndefined();
  });

  it('handles empty server names array', async () => {
    const servers = {
      trendminer: { transport: 'http' as const, url: 'https://example.com/mcp' }
    };
    const { servers: results } = await discoverMcpToolsForServers(servers, []);
    expect(results).toHaveLength(0);
  });

  it('lookup is case-sensitive — display name casing causes not-found', async () => {
    const servers = {
      'my-server': { transport: 'http' as const, url: 'https://example.com/mcp' }
    };
    const { servers: results } = await discoverMcpToolsForServers(servers, ['My Server']);
    expect(results[0].warnings[0]).toContain('not found');
  });
});

describe('pickDefaultAssistantAgentName', () => {
  const agentNames = ['claude-sonnet-46', 'claude-opus-46'];

  it('returns the requested name when provided', () => {
    expect(pickDefaultAssistantAgentName({ requested: 'claude-opus-46', agentNames })).toBe(
      'claude-opus-46'
    );
  });

  it('falls back to settingsDefault when no requested name', () => {
    expect(pickDefaultAssistantAgentName({ settingsDefault: 'claude-sonnet-46', agentNames })).toBe(
      'claude-sonnet-46'
    );
  });

  it('falls back to the first agent name when no requested or default', () => {
    expect(pickDefaultAssistantAgentName({ agentNames })).toBe('claude-sonnet-46');
  });

  it('returns empty string when no agents available', () => {
    expect(pickDefaultAssistantAgentName({ agentNames: [] })).toBe('');
  });

  it('returns a display name as-is — callers must pass the key, not display name', () => {
    // This test documents the contract: pickDefaultAssistantAgentName does NOT
    // validate against agentNames. If a display name like "Claude Sonnet 4.6"
    // is passed, it returns it unchanged — and the subsequent agent lookup will fail.
    // The fix must be in the caller (frontend) to always pass the key/id.
    expect(pickDefaultAssistantAgentName({ requested: 'Claude Sonnet 4.6', agentNames })).toBe(
      'Claude Sonnet 4.6'
    );
  });
});

describe('tool-analysis payload builders', () => {
  const schemas = {
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
    outputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    }
  };

  it('includes input and output schema for metadata review payloads', () => {
    const payload = buildToolAnalysisMetadataPayload({
      serverName: 'demo',
      toolName: 'get_user_profile',
      title: 'Get User Profile',
      description: 'Get user profile',
      ...schemas
    });
    expect(payload.title).toBe('Get User Profile');
    expect(payload.inputSchema).toEqual(schemas.inputSchema);
    expect(payload.outputSchema).toEqual(schemas.outputSchema);
  });

  it('includes input and output schema for sample-plan payloads', () => {
    const payload = buildToolAnalysisSamplePlanPayload({
      serverName: 'demo',
      toolName: 'get_user_profile',
      title: 'Get User Profile',
      description: 'Get user profile',
      maxCalls: 2,
      ...schemas
    });
    expect(payload.title).toBe('Get User Profile');
    expect(payload.inputSchema).toEqual(schemas.inputSchema);
    expect(payload.outputSchema).toEqual(schemas.outputSchema);
    expect(payload.maxCalls).toBe(2);
  });

  it('includes input and output schema for execution-review payloads', () => {
    const payload = buildToolAnalysisExecutionReviewPayload({
      serverName: 'demo',
      toolName: 'get_user_profile',
      title: 'Get User Profile',
      description: 'Get user profile',
      arguments: { userId: 'u-1' },
      resultPreview: '{"name":"Alice"}',
      ...schemas
    });
    expect(payload.title).toBe('Get User Profile');
    expect(payload.inputSchema).toEqual(schemas.inputSchema);
    expect(payload.outputSchema).toEqual(schemas.outputSchema);
    expect(payload.resultPreview).toContain('Alice');
  });
});

describe('classifyToolSafety', () => {
  it('prioritizes destructiveHint true over readOnlyHint true', () => {
    const result = classifyToolSafety('delete_data', undefined, {
      readOnlyHint: true,
      destructiveHint: true
    });
    expect(result.safetyClassification).toBe('unsafe_or_unknown');
    expect(result.classificationReason).toContain('destructiveHint');
  });

  it('classifies destructiveHint annotation as unsafe_or_unknown, overriding read prefix', () => {
    const result = classifyToolSafety('get_data', undefined, { destructiveHint: true });
    expect(result.safetyClassification).toBe('unsafe_or_unknown');
    expect(result.classificationReason).toContain('destructiveHint');
  });

  it('classifies readOnlyHint annotation as read_only, overriding delete prefix', () => {
    const result = classifyToolSafety('delete_data', undefined, { readOnlyHint: true });
    expect(result.safetyClassification).toBe('read_only');
    expect(result.classificationReason).toContain('readOnlyHint');
  });

  it('falls back to prefix matching when annotations absent', () => {
    expect(classifyToolSafety('delete_record').safetyClassification).toBe('unsafe_or_unknown');
    expect(classifyToolSafety('get_user').safetyClassification).toBe('read_only');
  });

  it('classifies destructiveHint false as non-read-only additive behavior', () => {
    const result = classifyToolSafety('create_note', undefined, { destructiveHint: false });
    expect(result.safetyClassification).toBe('unsafe_or_unknown');
    expect(result.classificationReason).toContain('additive behavior');
  });
});

describe('parseJsonFromAssistantText', () => {
  it('parses raw JSON object', () => {
    const parsed = parseJsonFromAssistantText<{ ok: boolean }>('{"ok":true}');
    expect(parsed.ok).toBe(true);
  });

  it('parses fenced JSON', () => {
    const parsed = parseJsonFromAssistantText<{ ok: boolean }>('```json\n{"ok":true}\n```');
    expect(parsed.ok).toBe(true);
  });

  it('parses JSON embedded in prose', () => {
    const parsed = parseJsonFromAssistantText<{ ok: boolean; items: number[] }>(
      'Here is the result:\n{"ok":true,"items":[1,2,3]}\nThanks.'
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toEqual([1, 2, 3]);
  });

  it('throws on text without JSON', () => {
    expect(() => parseJsonFromAssistantText('No JSON available.')).toThrow(
      'Assistant returned invalid JSON'
    );
  });
});
