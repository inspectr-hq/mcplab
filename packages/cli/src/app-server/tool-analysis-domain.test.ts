import { describe, it, expect } from 'vitest';
import { discoverMcpToolsForServers } from './tool-analysis-domain.js';

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
});
