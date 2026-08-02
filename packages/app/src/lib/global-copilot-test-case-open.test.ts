import { describe, expect, it, vi } from 'vitest';
import { resolveGlobalCopilotTestCaseOpen } from './global-copilot-test-case-open';
import type { EvalDataSource } from './data-sources/types';

describe('resolveGlobalCopilotTestCaseOpen', () => {
  it('does not produce a detail route for a Test Case that is not persisted', async () => {
    const getLibraries = vi.fn().mockResolvedValue({ scenarios: [] });

    await expect(
      resolveGlobalCopilotTestCaseOpen(
        { getLibraries } as Pick<EvalDataSource, 'getLibraries'>,
        'deepseek-list-library'
      )
    ).resolves.toEqual({
      found: false,
      message: "Test Case 'deepseek-list-library' was not found in the library. It was not opened."
    });
  });

  it('returns the canonical Test Case detail route only after verifying persistence', async () => {
    const getLibraries = vi.fn().mockResolvedValue({
      scenarios: [{ id: 'deepseek-list-library' }]
    });

    await expect(
      resolveGlobalCopilotTestCaseOpen(
        { getLibraries } as Pick<EvalDataSource, 'getLibraries'>,
        'deepseek-list-library'
      )
    ).resolves.toEqual({
      found: true,
      destination: '/libraries/test-cases/deepseek-list-library'
    });
  });
});
