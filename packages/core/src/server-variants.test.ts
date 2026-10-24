import { describe, expect, it } from 'vitest';
import {
  planServerVariants,
  parseServerVariant,
  scenarioExecutionKey,
  normalizeRuntimeServerSelection,
  toServerSets
} from './server-variants.js';
import type { EvalConfig } from './types.js';

const config: EvalConfig = {
  servers: {
    dev: { transport: 'http', url: 'http://dev/mcp' },
    prod: { transport: 'http', url: 'http://prod/mcp' }
  },
  agents: {},
  scenarios: [
    { id: 'one', prompt: 'test', servers: ['dev'] },
    { id: 'two', prompt: 'test', servers: ['prod'] }
  ]
};

describe('server variant plans', () => {
  it('resolves baseline bindings per scenario without mutating defaults', () => {
    const plan = planServerVariants(config, [
      { id: 'baseline' },
      { id: 'candidate', serverIds: ['prod'] }
    ]);
    expect(plan[0].scenarioServerOverrides).toEqual({ one: ['dev'], two: ['prod'] });
    expect(plan[1].scenarioServerOverrides).toEqual({ one: ['prod'], two: ['prod'] });
    expect(config.scenarios[0].servers).toEqual(['dev']);
  });

  it.each([
    [[{ id: 'a' }, { id: 'a' }], 'unique'],
    [[{ id: '' }], 'id'],
    [[{ id: 'a', serverIds: [] }], 'at least one'],
    [[{ id: 'a', serverIds: ['missing'] }], 'Unknown'],
    [[{ id: 'a', scenarioServerOverrides: { missing: ['dev'] } }], 'Unknown scenario']
  ])('rejects invalid plans before execution', (variants, message) => {
    expect(() => planServerVariants(config, variants as any)).toThrow(message);
  });

  it('restores frozen baseline bindings for reruns', () => {
    const plan = planServerVariants(config, [
      { id: 'baseline', scenarioServerOverrides: { one: ['prod'], two: ['dev'] } }
    ]);
    expect(plan[0].scenarioServerOverrides).toEqual({ one: ['prod'], two: ['dev'] });
  });

  it('parses CLI sets and keeps identity independent of editable labels', () => {
    expect(parseServerVariant('A=default')).toEqual({ id: 'A' });
    expect(parseServerVariant('B=dev,prod')).toEqual({ id: 'B', serverIds: ['dev', 'prod'] });
    expect(() => parseServerVariant('B=')).toThrow();
    expect(scenarioExecutionKey('s::a', 'b', 'A')).not.toBe(scenarioExecutionKey('s', 'a::b', 'A'));
    expect(scenarioExecutionKey('s', 'a', 'A')).not.toBe(scenarioExecutionKey('s', 'a', 'B'));
  });
});

describe('runtime server selection names', () => {
  it('normalizes server_sets and nested servers without losing frozen rerun bindings', () => {
    const sets = [
      { id: 'baseline', scenarioServerOverrides: { one: ['prod'], two: ['dev'] } },
      { id: 'candidate', servers: ['dev', 'prod'] }
    ];
    const selection = normalizeRuntimeServerSelection({ server_sets: sets });
    const plan = planServerVariants(config, selection.serverVariants);
    expect(plan[0].scenarioServerOverrides).toEqual(sets[0].scenarioServerOverrides);
    expect(plan[1].serverIds).toEqual(['dev', 'prod']);
    expect(toServerSets(plan)[1]).toEqual({
      id: 'candidate',
      label: 'dev + prod',
      servers: ['dev', 'prod'],
      scenarioServerOverrides: { one: ['dev', 'prod'], two: ['dev', 'prod'] }
    });
  });

  it('normalizes canonical runtime inputs', () => {
    expect(normalizeRuntimeServerSelection({ servers: [' prod '] }).serverOverrideAll).toEqual([
      'prod'
    ]);
    const sets = [{ id: 'candidate', servers: ['prod'] }];
    expect(normalizeRuntimeServerSelection({ server_sets: sets }).serverVariants).toEqual([
      { id: 'candidate', serverIds: ['prod'] }
    ]);
  });

  it.each([
    { server_sets: [{ id: 'a' }], servers: ['dev'] },
    { server_sets: [{ id: 'a', servers: ['dev'], serverIds: ['prod'] }] },
    { server_sets: [{ id: 'a', serverIds: ['prod'] }] },
    { server_sets: [] },
    { server_sets: null },
    { servers: [] },
    { servers: 'dev' },
    { servers: [null] },
    { serverVariants: [{ id: 'legacy' }] },
    { server_variants: [{ id: 'legacy' }] },
    { serverOverrideAll: ['dev'] },
    { server_override_all: ['dev'] }
  ])('rejects conflicting or malformed input: %j', (input) => {
    expect(() => normalizeRuntimeServerSelection(input)).toThrow();
  });
});
