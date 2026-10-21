import { describe, expect, it } from 'vitest';
import { buildScenarioEntry } from './scenario-builder.js';

describe('buildScenarioEntry tool expressions', () => {
  it.each(['search | ', 'search | search'])('rejects malformed alternatives %j', (expression) => {
    expect(() =>
      buildScenarioEntry({
        id: 'draft',
        servers: [],
        prompt: 'Search.',
        required_tools: [expression]
      })
    ).toThrow('required_tools[0]');
  });
});
