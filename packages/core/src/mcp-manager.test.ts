import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectEvents: string[] = [];
const closeEvents: string[] = [];
const callToolEvents: string[] = [];
let failFirstScopedConnect = false;

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockTransport {
    constructor(
      public url: URL,
      public options?: { requestInit?: { headers?: Record<string, string> } }
    ) {}
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    private readonly name: string;
    constructor(config: { name: string }) {
      this.name = config.name;
    }

    async connect(): Promise<void> {
      connectEvents.push(this.name);
      if (this.name.includes('-scoped')) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (failFirstScopedConnect) {
          failFirstScopedConnect = false;
          throw new Error('scoped connect transient failure');
        }
      }
    }

    async callTool(input: { name: string }): Promise<{ ok: true; tool: string }> {
      callToolEvents.push(`${this.name}:${input.name}`);
      return { ok: true, tool: input.name };
    }

    async close(): Promise<void> {
      closeEvents.push(this.name);
    }
  }
}));

describe('McpClientManager scoped clients', () => {
  beforeEach(() => {
    vi.resetModules();
    connectEvents.length = 0;
    closeEvents.length = 0;
    callToolEvents.length = 0;
    failFirstScopedConnect = false;
  });

  it('reuses a single scoped connection for concurrent calls with identical headers', async () => {
    const { McpClientManager } = await import('./mcp.js');
    const manager = new McpClientManager();
    await manager.connectAll({
      api: { transport: 'http', url: 'https://example.test/mcp' }
    });

    await Promise.all([
      manager.callTool('api', 'one', {}, { requestHeaders: { 'x-run-id': '123' } }),
      manager.callTool('api', 'two', {}, { requestHeaders: { 'x-run-id': '123' } })
    ]);

    const scopedConnections = connectEvents.filter((name) => name.endsWith('-scoped'));
    expect(scopedConnections).toHaveLength(1);
    expect(callToolEvents).toEqual(
      expect.arrayContaining(['mcp-eval-api-scoped:one', 'mcp-eval-api-scoped:two'])
    );

    await manager.disconnectAll();
  });

  it('retries scoped connection on transient failure', async () => {
    const { McpClientManager } = await import('./mcp.js');
    const manager = new McpClientManager();
    await manager.connectAll({
      api: { transport: 'http', url: 'https://example.test/mcp' }
    });
    failFirstScopedConnect = true;

    await manager.callTool('api', 'retry-me', {}, { requestHeaders: { 'x-run-id': '123' } });

    const scopedConnections = connectEvents.filter((name) => name.endsWith('-scoped'));
    expect(scopedConnections.length).toBeGreaterThanOrEqual(2);
    expect(callToolEvents).toContain('mcp-eval-api-scoped:retry-me');

    await manager.disconnectAll();
  });

  it('avoids key collisions when header values contain delimiters', async () => {
    const { McpClientManager } = await import('./mcp.js');
    const manager = new McpClientManager();
    await manager.connectAll({
      api: { transport: 'http', url: 'https://example.test/mcp' }
    });

    await manager.callTool('api', 'collision-a', {}, { requestHeaders: { a: 'b|c', d: 'e' } });
    await manager.callTool('api', 'collision-b', {}, { requestHeaders: { a: 'b', 'c|d': 'e' } });

    const scopedConnections = connectEvents.filter((name) => name.endsWith('-scoped'));
    expect(scopedConnections).toHaveLength(2);

    await manager.disconnectAll();
  });

  it('evicts least-recently-used scoped clients when the cache is full', async () => {
    const { McpClientManager } = await import('./mcp.js');
    const manager = new McpClientManager({ maxScopedClients: 2 });
    await manager.connectAll({
      api: { transport: 'http', url: 'https://example.test/mcp' }
    });

    await manager.callTool('api', 'r1', {}, { requestHeaders: { 'x-run-id': '1' } });
    await manager.callTool('api', 'r2', {}, { requestHeaders: { 'x-run-id': '2' } });
    await manager.callTool('api', 'r3', {}, { requestHeaders: { 'x-run-id': '3' } });

    expect(closeEvents).toContain('mcp-eval-api-scoped');
    await manager.disconnectAll();
  });

  it('closes each client once when disconnecting with in-flight scoped connections', async () => {
    const { McpClientManager } = await import('./mcp.js');
    const manager = new McpClientManager();
    await manager.connectAll({
      api: { transport: 'http', url: 'https://example.test/mcp' }
    });

    const inFlightCall = manager.callTool(
      'api',
      'in-flight',
      {},
      { requestHeaders: { 'x-run-id': 'inflight' } }
    );
    await new Promise((resolve) => setTimeout(resolve, 1));

    await manager.disconnectAll();
    await inFlightCall.catch(() => undefined);

    const scopedCloseCount = closeEvents.filter((name) => name === 'mcp-eval-api-scoped').length;
    expect(scopedCloseCount).toBe(1);
  });
});
