export const GLOBAL_COPILOT_NAVIGATION_INPUTS = [
  '/',
  '/mcp-evaluations',
  '/run',
  '/results',
  '/compare',
  '/tool-analysis',
  '/tool-analysis-results',
  '/oauth-debugger',
  '/libraries/servers',
  '/libraries/agents',
  '/libraries/test-cases',
  '/settings',
  '/test-cases',
  '/servers',
  '/agents'
] as const;

const canonicalTargets = new Set<string>(GLOBAL_COPILOT_NAVIGATION_INPUTS.slice(0, 12));
const aliases: Record<string, string> = {
  '/test-cases': '/libraries/test-cases',
  '/servers': '/libraries/servers',
  '/agents': '/libraries/agents'
};

export function resolveGlobalCopilotNavigationTarget(path: string): string | undefined {
  return aliases[path] ?? (canonicalTargets.has(path) ? path : undefined);
}
