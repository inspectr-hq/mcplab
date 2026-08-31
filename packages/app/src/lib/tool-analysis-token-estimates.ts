import type { ToolAnalysisDiscoverResponse } from './data-sources/types';

export function formatToolAnalysisTokenCount(value: number, locale?: string): string {
  const browserLocale =
    locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
  return value.toLocaleString(browserLocale);
}

export function selectedToolContextTokens(
  servers: ToolAnalysisDiscoverResponse['servers'],
  selectedToolsByServer: Record<string, string[]>
): number | undefined {
  let total = 0;
  let hasEstimate = false;
  for (const server of servers) {
    const estimate = server.tokenEstimate;
    if (!estimate) continue;
    hasEstimate = true;
    const selected = new Set(selectedToolsByServer[server.serverName] ?? []);
    total += estimate.tools
      .filter((tool) => selected.has(tool.name))
      .reduce((sum, tool) => sum + tool.total, 0);
  }
  return hasEstimate ? total : undefined;
}
