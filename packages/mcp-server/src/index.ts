#!/usr/bin/env node
import { defaultMcplabMcpServerOptionsFromEnv, startMcplabMcpServer } from './runtime.js';

async function main(): Promise<void> {
  const runtime = await startMcplabMcpServer(defaultMcplabMcpServerOptionsFromEnv());

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error('[mcplab-mcp-server] fatal error:', error);
  process.exit(1);
});
