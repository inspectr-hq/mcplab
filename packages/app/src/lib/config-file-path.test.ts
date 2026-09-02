import { describe, expect, it } from 'vitest';
import { getConfigDisplayPath } from './config-file-path';

describe('getConfigDisplayPath', () => {
  it('prefers the workspace-relative path', () => {
    expect(
      getConfigDisplayPath({
        relativePath: 'evals/example.yaml',
        sourcePath: '/workspace/example.yaml'
      })
    ).toBe('evals/example.yaml');
  });

  it('falls back to the source path when relativePath is unavailable', () => {
    expect(getConfigDisplayPath({ sourcePath: '/workspace/example.yaml' })).toBe(
      '/workspace/example.yaml'
    );
  });

  it('ignores blank path values', () => {
    expect(
      getConfigDisplayPath({ relativePath: '  ', sourcePath: ' /workspace/example.yaml ' })
    ).toBe('/workspace/example.yaml');
    expect(getConfigDisplayPath({})).toBeUndefined();
  });
});
