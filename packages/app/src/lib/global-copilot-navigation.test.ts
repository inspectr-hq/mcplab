import { describe, expect, it } from 'vitest';
import { resolveGlobalCopilotNavigationTarget } from './global-copilot-navigation';

describe('resolveGlobalCopilotNavigationTarget', () => {
  it('keeps canonical MCPLab routes unchanged', () => {
    expect(resolveGlobalCopilotNavigationTarget('/libraries/test-cases')).toBe(
      '/libraries/test-cases'
    );
  });

  it('canonicalizes human-friendly library route aliases', () => {
    expect(resolveGlobalCopilotNavigationTarget('/test-cases')).toBe('/libraries/test-cases');
    expect(resolveGlobalCopilotNavigationTarget('/servers')).toBe('/libraries/servers');
    expect(resolveGlobalCopilotNavigationTarget('/agents')).toBe('/libraries/agents');
  });

  it('rejects routes outside the supported navigation surface', () => {
    expect(resolveGlobalCopilotNavigationTarget('/admin')).toBeUndefined();
    expect(resolveGlobalCopilotNavigationTarget('https://example.com')).toBeUndefined();
  });
});
