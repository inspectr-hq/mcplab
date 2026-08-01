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

  it('resolves the Results 24-hour preset to MCP-neutral ISO bounds', () => {
    expect(
      globalCopilotRouteContext(
        '/results',
        '?time_filter=last&time_preset=24h',
        new Date('2026-08-01T12:00:00Z')
      ).resultsFilter
    ).toEqual({
      since: '2026-07-31T12:00:00.000Z',
      until: '2026-08-01T12:00:00.000Z'
    });
  });
});
