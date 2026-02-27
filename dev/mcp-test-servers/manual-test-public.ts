#!/usr/bin/env node
import { envServerOptions, startManualMcpServer, sendJson } from './manual-test-shared.js';

async function main() {
  const opts = envServerOptions(3111, 'mcplab-mcp-public-test');
  const runtime = await startManualMcpServer({
    ...opts,
    onRoot: (_req, res) => {
      sendJson(res, 200, {
        name: opts.name,
        kind: 'public',
        mcp_endpoint: opts.mcpPath,
        notes: 'No auth required. Use this for basic MCP connectivity tests.'
      });
    }
  });
  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('[manual-test-public] fatal:', error);
  process.exit(1);
});
