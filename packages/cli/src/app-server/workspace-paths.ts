import { isAbsolute, relative, resolve } from 'node:path';

export function resultConfigPath(configPath: string, evalsDir?: string): string {
  const path = evalsDir && isAbsolute(configPath) ? relative(evalsDir, configPath) : configPath;
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '') || configPath;
}

export function defaultNewRunsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/evaluation-runs');
}

export function defaultNewToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/tool-analysis');
}

export function defaultLegacyToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/tool-analysis-results');
}
