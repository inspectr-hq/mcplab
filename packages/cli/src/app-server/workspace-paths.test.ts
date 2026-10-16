import { describe, expect, it } from 'vitest';
import {
  defaultLegacyToolAnalysisResultsDir,
  defaultNewRunsDir,
  defaultNewToolAnalysisResultsDir,
  resultConfigPath
} from './workspace-paths.js';

describe('workspace path helpers', () => {
  it.each([
    ['/tmp/evals/basic/eval.yaml', '/tmp/evals', 'basic/eval.yaml'],
    ['./basic/eval.yaml', '/tmp/evals', 'basic/eval.yaml'],
    ['basic/eval.yaml', '/tmp/evals', 'basic/eval.yaml'],
    ['/tmp/other/eval.yaml', '/tmp/evals', '../other/eval.yaml'],
    ['/tmp/evals/basic/eval.yaml', undefined, '/tmp/evals/basic/eval.yaml']
  ])('formats result config path %s relative to %s', (path, evalsDir, expected) => {
    expect(resultConfigPath(path!, evalsDir)).toBe(expected);
  });

  it('resolves the default runs directory', () => {
    expect(defaultNewRunsDir('/tmp/workspace')).toBe(
      '/tmp/workspace/mcplab/results/evaluation-runs'
    );
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
