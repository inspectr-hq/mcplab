import { describe, expect, it } from 'vitest';
import { globalCopilotRouteContext } from './global-copilot-context';

describe('globalCopilotRouteContext', () => {
  it('keeps route context compact while identifying the selected entity', () => {
    expect(globalCopilotRouteContext('/results/run%2F42', '?agent=alpha')).toEqual({
      pathname: '/results/run%2F42',
      search: '?agent=alpha',
      selectedEntity: { type: 'result', id: 'run/42' }
    });
  });

  it('identifies the active test case without exposing unrelated libraries', () => {
    expect(globalCopilotRouteContext('/libraries/test-cases/weather-case', '')).toMatchObject({
      activeTestCaseId: 'weather-case'
    });
  });
});
