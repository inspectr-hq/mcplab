import { describe, it, expect } from 'vitest';
import {
  buildToolAnalysisExecutionReviewPayload,
  buildToolAnalysisMetadataPayload,
  buildToolAnalysisSamplePlanPayload,
  classifyToolSafety,
  discoverMcpToolsForServers,
  parseJsonFromAssistantText
} from './tool-analysis-domain.js';
import { pickDefaultAssistantAgentName } from './scenario-assistant-domain.js';

describe('discoverMcpToolsForServers', () => {
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
      description: 'Get user profile',
      ...schemas
    });
    expect(payload.inputSchema).toEqual(schemas.inputSchema);
    expect(payload.outputSchema).toEqual(schemas.outputSchema);
  });

  it('includes input and output schema for sample-plan payloads', () => {
    const payload = buildToolAnalysisSamplePlanPayload({
      serverName: 'demo',
      toolName: 'get_user_profile',
      description: 'Get user profile',
      maxCalls: 2,
      ...schemas
    });
    expect(payload.inputSchema).toEqual(schemas.inputSchema);
    expect(payload.outputSchema).toEqual(schemas.outputSchema);
    expect(payload.maxCalls).toBe(2);
  });

  it('includes input and output schema for execution-review payloads', () => {
    const payload = buildToolAnalysisExecutionReviewPayload({
      serverName: 'demo',
      toolName: 'get_user_profile',
      description: 'Get user profile',
      arguments: { userId: 'u-1' },
      resultPreview: '{"name":"Alice"}',
      ...schemas
    });
    expect(payload.inputSchema).toEqual(schemas.inputSchema);
    expect(payload.outputSchema).toEqual(schemas.outputSchema);
    expect(payload.resultPreview).toContain('Alice');
  });
});

describe('classifyToolSafety', () => {
  it('classifies destructiveHint annotation as unsafe_or_unknown, overriding read prefix', () => {
    const result = classifyToolSafety('get_data', undefined, { destructiveHint: true });
    expect(result.safetyClassification).toBe('unsafe_or_unknown');
    expect(result.classificationReason).toContain('destructiveHint');
  });

  it('classifies readOnlyHint annotation as read_like, overriding delete prefix', () => {
    const result = classifyToolSafety('delete_data', undefined, { readOnlyHint: true });
    expect(result.safetyClassification).toBe('read_like');
    expect(result.classificationReason).toContain('readOnlyHint');
  });

  it('falls back to prefix matching when annotations absent', () => {
    expect(classifyToolSafety('delete_record').safetyClassification).toBe('unsafe_or_unknown');
    expect(classifyToolSafety('get_user').safetyClassification).toBe('read_like');
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
