import type { SourceEvalConfig } from '@inspectr/mcplab-core';

/** Pure transformation: migrates a single source config to the canonical format.
 *  Moves top-level inline server definitions into scenario-owned mcp_servers entries
 *  so that refs point to library servers and inline entries remain inline.
 *  Does not read or write files. */
export function migrateSourceConfig(sourceConfig: SourceEvalConfig): SourceEvalConfig {
  // Build lookup from top-level servers so inline definitions survive the move
  // to scenario-owned mcp_servers entries instead of becoming broken refs.
  const serverEntryById = new Map<string, Record<string, unknown>>();
  for (const entry of (sourceConfig.servers ?? []) as any[]) {
    if ('ref' in entry && entry.ref) {
      serverEntryById.set(String(entry.ref), { ref: entry.ref });
    } else if (entry.id) {
      serverEntryById.set(String(entry.id), entry);
    }
  }

  return {
    ...sourceConfig,
    servers: [],
    scenarios: sourceConfig.scenarios.map((s) => {
      if ('ref' in s) return s;
      const scenario = s as any;
      if (
        Array.isArray(scenario.servers) &&
        scenario.servers.length > 0 &&
        typeof scenario.servers[0] === 'string' &&
        !scenario.mcp_servers
      ) {
        const { servers: _legacyServers, ...rest } = scenario;
        return {
          ...rest,
          mcp_servers: _legacyServers.map((id: string) =>
            // Use the original entry (inline or ref) — fall back to ref only if unknown
            serverEntryById.get(id) ?? { ref: id }
          )
        };
      }
      return s;
    })
  };
}
