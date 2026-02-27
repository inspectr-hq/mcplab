#!/usr/bin/env node
import {
  envServerOptions,
  requireBearer,
  sendJson,
  startManualMcpServer
} from './manual-test-shared.js';

async function main() {
  const opts = envServerOptions(3112, 'mcplab-mcp-bearer-test');
  const bearerToken = process.env.MCP_TEST_BEARER_TOKEN || 'demo-bearer-token';
  const runtime = await startManualMcpServer({
    ...opts,
    onRoot: (_req, res) => {
      sendJson(res, 200, {
        name: opts.name,
        kind: 'bearer',
        mcp_endpoint: opts.mcpPath,
        token_hint: bearerToken,
        notes: 'Requires Authorization: Bearer <token> for /mcp and /probe'
      });
    },
    beforeMcp: (req, res, pathname) => {
      if (pathname === '/probe') {
        if (!requireBearer(req, res, bearerToken)) return true;
        sendJson(res, 200, { ok: true, protected: true, server: opts.name });
        return true;
      }
      if (pathname === opts.mcpPath) {
        return !requireBearer(req, res, bearerToken);
      }
      return false;
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
  console.error('[manual-test-bearer] fatal:', error);
  process.exit(1);
});
