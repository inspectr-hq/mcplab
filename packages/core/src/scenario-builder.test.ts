import { describe, expect, it } from 'vitest';
import { buildScenarioEntry } from './scenario-builder.js';

describe('buildScenarioEntry tool expressions', () => {
  it('trims and deduplicates shorthand rules while preserving repeated steps', () => {
    const scenario = buildScenarioEntry({
      id: 'draft',
      servers: ['server'],
      prompt: 'Search twice.',
      required_tools: [' search | lookup ', 'search | lookup'],
      forbidden_tools: [' remove ', 'remove'],
      tool_sequence: ['search | lookup', 'search | lookup']
    });
    expect(scenario.eval?.tool_constraints?.required_tools).toEqual(['search | lookup']);
    expect(scenario.eval?.tool_constraints?.forbidden_tools).toEqual(['remove']);
    expect(scenario.eval?.tool_sequence).toEqual(['search | lookup', 'search | lookup']);
  });

  it('preserves canonical eval expression spelling', () => {
    const scenario = buildScenarioEntry({
      id: 'draft',
      servers: ['server'],
      prompt: 'Search.',
      eval: { tool_constraints: { required_tools: [' search | lookup '] } }
    });
    expect(scenario.eval?.tool_constraints?.required_tools).toEqual([' search | lookup ']);
  });

  it('rejects empty and duplicate alternatives', () => {
    expect(() =>
      buildScenarioEntry({
        id: 'draft',
        servers: ['server'],
        prompt: 'Search.',
        required_tools: ['search | ']
      })
    ).toThrow();
    expect(() =>
      buildScenarioEntry({
        id: 'draft',
        servers: ['server'],
        prompt: 'Search.',
        required_tools: ['search | search']
      })
    ).toThrow();
  });

  it.each([
    [{ required_tools: [''] }, 'required_tools'],
    [{ forbidden_tools: [' '] }, 'forbidden_tools'],
    [{ tool_sequence: ['lookup', ''] }, 'tool_sequence']
  ])('rejects blank expressions before draft cleanup (%j)', (fields) => {
    expect(() =>
      buildScenarioEntry({
        id: 'draft',
        servers: ['server'],
        prompt: 'Search.',
        ...fields
      })
    ).toThrow();
  });
});
