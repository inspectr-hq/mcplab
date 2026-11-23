import { describe, it, expect, vi } from 'vitest';
import { classifyMcpToolSafety, McpClientManager } from '@inspectr/mcplab-core';
import {
  buildToolAnalysisExecutionReviewPayload,
  buildToolAnalysisMetadataPayload,
  buildToolAnalysisSamplePlanPayload,
  discoverMcpToolsForServers,
  parseJsonFromAssistantText
} from './tool-analysis-domain.js';
import { pickDefaultAssistantAgentName } from './assistant-agent.js';

describe('discoverMcpToolsForServers', () => {
  it('calls the advertised resource listing tool only on explicit request', async () => {
    const servers = { docs: { transport: 'http' as const, url: 'https://example.com/mcp' } };
    vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'getServerFeatures').mockReturnValue({
      tools: true,
      resources: false,
      prompts: false
    });
    vi.spyOn(McpClientManager.prototype, 'listToolsWithCoverage').mockResolvedValue({
      status: 'ready',
      items: [
        { name: 'list_resources', inputSchema: { type: 'object' } },
        {
          name: 'read_resource',
          inputSchema: { type: 'object', properties: { uri: { type: 'string' } } }
        }
      ]
    });
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
      const listTools = vi
        .spyOn(McpClientManager.prototype, 'listToolsWithCoverage')
        .mockResolvedValue({ status: 'ready', items: [] });
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

describe('classifyMcpToolSafety', () => {
  it('prioritizes destructiveHint true over readOnlyHint true', () => {
    const result = classifyMcpToolSafety({
      name: 'get_data',
      annotations: { readOnlyHint: true, destructiveHint: true }
    });
    expect(result).toMatchObject({
      safetyClassification: 'unsafe_or_unknown',
      contradictionField: 'annotations.destructiveHint'
    });
  });

  it('blocks a read-only tool with a destructive action in its name', () => {
    expect(
      classifyMcpToolSafety({ name: 'getOrDeleteData', annotations: { readOnlyHint: true } })
    ).toMatchObject({ safetyClassification: 'unsafe_or_unknown', contradictionField: 'name' });
  });

  it('skips unlabeled tools even with a read-only name', () => {
    expect(classifyMcpToolSafety({ name: 'get_user' }).safetyClassification).toBe(
      'unsafe_or_unknown'
    );
  });

  it('allows an explicitly read-only tool with a matching description', () => {
    expect(
      classifyMcpToolSafety({
        name: 'get_user',
        annotations: { readOnlyHint: true },
        description: 'Gets a user.'
      })
    ).toMatchObject({ safetyClassification: 'read_only' });
  });

  it.each([
    'Gets a report and sends an email.',
    'Use this tool to delete a workspace.',
    'Allows you to rename a project.',
    '  - Archive a project.',
    'The tool deletes a workspace.',
    'This tool permanently deletes a workspace.'
  ])('blocks a read-only tool with a side-effectful description %s', (description) => {
    expect(
      classifyMcpToolSafety({
        name: 'get_report',
        annotations: { readOnlyHint: true },
        description
      })
    ).toMatchObject({
      safetyClassification: 'unsafe_or_unknown',
      contradictionField: 'description'
    });
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
