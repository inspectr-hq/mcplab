import { describe, expect, it } from 'vitest';
import { applyRuntimeServerOverrides } from './runtime-overrides.js';
import type { EvalConfig } from './types.js';

function makeConfig(): EvalConfig {
  return {
    servers: {
      dev: { transport: 'http', url: 'http://dev.local/mcp' },
      stage: { transport: 'http', url: 'http://stage.local/mcp' },
      prod: { transport: 'http', url: 'http://prod.local/mcp' }
    },
    agents: {
      a1: { provider: 'openai', model: 'gpt-4o-mini' }
    },
    scenarios: [
      { id: 's1', servers: ['dev'], prompt: 'one' },
      { id: 's2', servers: ['stage'], prompt: 'two' }
    ]
  };
}

describe('applyRuntimeServerOverrides', () => {
  it('keeps config unchanged when no overrides provided', () => {
    const config = makeConfig();
    const updated = applyRuntimeServerOverrides(config);
    expect(updated).toEqual(config);
  });

  it('applies global override to all scenarios', () => {
    const updated = applyRuntimeServerOverrides(makeConfig(), { serverOverrideAll: ['prod'] });
    expect(updated.scenarios.map((s) => s.servers)).toEqual([['prod'], ['prod']]);
  });

  it('throws on empty global override array', () => {
    expect(() => applyRuntimeServerOverrides(makeConfig(), { serverOverrideAll: [] })).toThrow(
      'serverOverrideAll must include at least one server id'
    );
  });

  it('applies per-scenario override over global override', () => {
    const updated = applyRuntimeServerOverrides(makeConfig(), {
      serverOverrideAll: ['prod'],
      scenarioServerOverrides: { s2: ['dev', 'stage'] }
    });
    expect(updated.scenarios.find((s) => s.id === 's1')?.servers).toEqual(['prod']);
    expect(updated.scenarios.find((s) => s.id === 's2')?.servers).toEqual(['dev', 'stage']);
  });

  it('supports clearing scenario servers with empty override list', () => {
    const updated = applyRuntimeServerOverrides(makeConfig(), {
      scenarioServerOverrides: { s1: [] }
    });
    expect(updated.scenarios.find((s) => s.id === 's1')?.servers).toEqual([]);
    expect(updated.scenarios.find((s) => s.id === 's2')?.servers).toEqual(['stage']);
  });

  it('throws on unknown server ref in global override', () => {
    expect(() =>
      applyRuntimeServerOverrides(makeConfig(), { serverOverrideAll: ['missing'] })
    ).toThrow('Unknown server refs in serverOverrideAll: missing');
  });

  it('throws on unknown server ref in scenario override', () => {
    expect(() =>
      applyRuntimeServerOverrides(makeConfig(), { scenarioServerOverrides: { s1: ['missing'] } })
    ).toThrow('Unknown server refs in scenarioServerOverrides.s1: missing');
  });

  it('throws on unknown scenario id in scenario override map', () => {
    expect(() =>
      applyRuntimeServerOverrides(makeConfig(), { scenarioServerOverrides: { no_such: ['dev'] } })
    ).toThrow('Unknown scenarios in scenarioServerOverrides: no_such');
  });
});
