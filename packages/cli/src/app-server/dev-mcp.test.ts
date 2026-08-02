import { describe, expect, it } from 'vitest';
import { buildDevMcpEnvironment } from './dev-mcp.js';

describe('buildDevMcpEnvironment', () => {
  it('passes the configured MCPLab library root to the local MCP server', () => {
    const environment = buildDevMcpEnvironment({
      base: { EXISTING_VALUE: 'kept' },
      host: '127.0.0.1',
      port: 3011,
      path: '/mcp',
      librariesDir: '/workspace/custom-libraries'
    });

    expect(environment).toMatchObject({
      EXISTING_VALUE: 'kept',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: '3011',
      MCP_PATH: '/mcp',
      MCPLAB_BUNDLE_ROOT: '/workspace/custom-libraries'
    });
  });
});
