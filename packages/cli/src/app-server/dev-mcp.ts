import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { DevMcpServerRuntime } from './types.js';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function maybeStartDevMcpServer(
  workspaceRoot: string,
  devMode: boolean
): Promise<DevMcpServerRuntime | null> {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = parsePositiveInt(process.env.MCP_PORT, 3011);
  const path = process.env.MCP_PATH || '/mcp';

  if (devMode) {
    if (String(process.env.MCPLAB_APP_DEV_START_MCP ?? '1') === '0') return null;

    const sourceEntry = resolve(workspaceRoot, 'packages', 'mcp-server', 'src', 'index.ts');
    const distEntry = resolve(workspaceRoot, 'packages', 'mcp-server', 'dist', 'index.js');
    const useTsx = existsSync(sourceEntry);
    const command = useTsx ? 'tsx' : process.execPath;
    const args = useTsx ? [sourceEntry] : [distEntry];

    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        MCP_HOST: host,
        MCP_PORT: String(port),
        MCP_PATH: path
      },
      stdio: 'inherit'
    });

    child.on('error', (error) => {
      console.error(`[mcplab app] failed to start MCP server child: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      console.log(
        `[mcplab app] MCP server child exited (${
          signal ? `signal ${signal}` : `code ${code ?? 0}`
        })`
      );
    });

    return {
      host,
      port,
      path,
      targetBaseUrl: `http://${host}:${port}`,
      stop: () => {
        if (child.killed || child.exitCode !== null) return;
        child.kill('SIGTERM');
      }
    };
  }

  if (String(process.env.MCPLAB_APP_START_MCP ?? '1') === '0') return null;
  const { startMcplabMcpServer } = await importMcpRuntime();
  const runtime = await startMcplabMcpServer({ host, port, path });
  return {
    host,
    port,
    path,
    targetBaseUrl: `http://${host}:${port}`,
    stop: () => {
      void runtime.close();
    }
  };
}

async function importMcpRuntime() {
  try {
    const packageRuntimeModule = '@inspectr/mcplab-mcp-server/runtime';
    return await import(packageRuntimeModule);
  } catch {
    return await import('../../../mcp-server/src/runtime.js');
  }
}
