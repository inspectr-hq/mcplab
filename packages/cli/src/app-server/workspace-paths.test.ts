import { describe, expect, it } from 'vitest';
import {
  defaultLegacyToolAnalysisResultsDir,
  defaultNewRunsDir,
  defaultNewToolAnalysisResultsDir
} from './workspace-paths.js';

describe('workspace path helpers', () => {
  it('resolves the default runs directory', () => {
    expect(defaultNewRunsDir('/tmp/workspace')).toBe('/tmp/workspace/mcplab/results/evaluation-runs');
  });

  it('resolves the default new tool analysis directory', () => {
    expect(defaultNewToolAnalysisResultsDir('/tmp/workspace')).toBe(
      '/tmp/workspace/mcplab/results/tool-analysis'
    );
  });

  it('resolves the default legacy tool analysis directory', () => {
    expect(defaultLegacyToolAnalysisResultsDir('/tmp/workspace')).toBe(
      '/tmp/workspace/mcplab/tool-analysis-results'
    );
  });
});
