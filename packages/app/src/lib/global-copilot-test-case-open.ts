import type { EvalDataSource } from './data-sources/types';

export type GlobalCopilotTestCaseOpenResolution =
  | { found: true; destination: string }
  | { found: false; message: string };

/**
 * Guards navigation against drafts that were generated in chat but never
 * persisted through the Test Cases Library API.
 */
export async function resolveGlobalCopilotTestCaseOpen(
  source: Pick<EvalDataSource, 'getLibraries'>,
  testCaseId: string
): Promise<GlobalCopilotTestCaseOpenResolution> {
  const libraries = await source.getLibraries();
  if (!libraries.scenarios.some((scenario) => scenario.id === testCaseId)) {
    return {
      found: false,
      message: `Test Case '${testCaseId}' was not found in the library. It was not opened.`
    };
  }
  return {
    found: true,
    destination: `/libraries/test-cases/${encodeURIComponent(testCaseId)}`
  };
}
