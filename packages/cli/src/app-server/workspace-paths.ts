import { resolve } from 'node:path';

export function defaultNewRunsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/evaluation-runs');
}

export function defaultNewToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/results/tool-analysis');
}

export function defaultLegacyToolAnalysisResultsDir(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'mcplab/tool-analysis-results');
}
