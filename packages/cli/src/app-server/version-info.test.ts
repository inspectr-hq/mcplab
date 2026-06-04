import { describe, expect, it } from 'vitest';
import { getAppServerVersionInfo } from './version-info.js';

describe('getAppServerVersionInfo', () => {
  it('reads the cli package version and the MCP server package version', () => {
    const result = getAppServerVersionInfo({
      readText: (url) => {
        const href = String(url);
        if (href.includes('/packages/cli/package.json')) {
          return JSON.stringify({ version: '1.20.0' });
        }
        if (href.includes('/mock-mcp-server/package.json')) {
          return JSON.stringify({ version: '1.5.0' });
        }
        throw new Error(`unexpected read: ${href}`);
      },
      resolveImportMeta: (specifier) => {
        expect(specifier).toBe('@inspectr/mcplab-mcp-server');
        return 'file:///mock-mcp-server/dist/index.js';
      },
      moduleUrl: 'file:///workspace/packages/cli/src/app-server/version-info.js'
    });

    expect(result).toEqual({
      cliVersion: '1.20.0',
      mcpServerPackageVersion: '1.5.0'
    });
  });

  it('falls back to 1.0.0 when MCP package resolution fails', () => {
    const result = getAppServerVersionInfo({
      readText: (url) => {
        const href = String(url);
        if (href.includes('/packages/cli/package.json')) {
          return JSON.stringify({ version: '1.20.0' });
        }
        throw new Error(`unexpected read: ${href}`);
      },
      resolveImportMeta: () => {
        throw new Error('resolution failed');
      },
      moduleUrl: 'file:///workspace/packages/cli/src/app-server/version-info.js'
    });

    expect(result).toEqual({
      cliVersion: '1.20.0',
      mcpServerPackageVersion: '1.0.0'
    });
  });
});
