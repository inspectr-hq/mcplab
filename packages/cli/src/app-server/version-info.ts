import { readFileSync } from 'node:fs';

interface VersionInfoDeps {
  moduleUrl?: string;
  readText?: (url: URL | string) => string;
  resolveImportMeta?: (specifier: string) => string;
}

export function getAppServerVersionInfo(
  deps: VersionInfoDeps = {}
): { cliVersion: string; mcpServerPackageVersion: string } {
  const moduleUrl = deps.moduleUrl ?? import.meta.url;
  const readText =
    deps.readText ??
    ((url: URL | string) => readFileSync(url instanceof URL ? url : new URL(url), 'utf8'));
  const resolveImportMeta = deps.resolveImportMeta ?? ((specifier: string) => import.meta.resolve(specifier));

  const cliVersion = (JSON.parse(readText(new URL('../../package.json', moduleUrl)))?.version ??
    '0.0.0') as string;

  let mcpServerPackageVersion = '1.0.0';
  try {
    const entryUrl = resolveImportMeta('@inspectr/mcplab-mcp-server');
    mcpServerPackageVersion =
      (JSON.parse(readText(new URL('../package.json', entryUrl)))?.version as string) ?? '1.0.0';
  } catch {
    mcpServerPackageVersion = '1.0.0';
  }

  return { cliVersion, mcpServerPackageVersion };
}
