import { describe, expect, it } from 'vitest';
import { resolveRunAgentNames } from './run-agent-selection.js';
import { expandConfigForAgents } from './config.js';
import type { EvalConfig } from './types.js';

describe('resolveRunAgentNames', () => {
  const base = {
    configuredAgentNames: ['eval-a', 'eval-b'],
    selectedAgentNames: ['eval-b'],
    defaultEvaluationAgentName: 'workspace'
  };

  it('prefers explicit run selection over every default', () => {
    expect(resolveRunAgentNames({ ...base, requestedAgentNames: ['override'] })).toEqual([
      'override'
    ]);
  });
  it('prefers evaluation defaults over declared agents and workspace defaults', () => {
    expect(resolveRunAgentNames(base)).toEqual(['eval-b']);
  });
  it('keeps all evaluation agents when no evaluation defaults are marked', () => {
    expect(resolveRunAgentNames({ ...base, selectedAgentNames: [] })).toEqual(['eval-a', 'eval-b']);
  });
  it('inherits the workspace default only for an evaluation without agents', () => {
    expect(
      resolveRunAgentNames({ configuredAgentNames: [], defaultEvaluationAgentName: 'workspace' })
    ).toEqual(['workspace']);
  });
  it('returns no agents when nothing is configured, without selecting the whole library', () => {
    expect(resolveRunAgentNames({ configuredAgentNames: [] })).toEqual([]);
  });
  it('keeps invalid explicit defaults visible for validation instead of silently substituting', () => {
    expect(resolveRunAgentNames({ ...base, selectedAgentNames: ['deleted'] })).toEqual(['deleted']);
  });
  it('rejects an empty resolved selection instead of expanding to all library agents', () => {
    const config = {
      agents: { library: { provider: 'openai', model: 'test' } },
      scenarios: []
    } as unknown as EvalConfig;
    expect(() => expandConfigForAgents(config, [])).toThrow('No evaluation agents selected');
  });
});
