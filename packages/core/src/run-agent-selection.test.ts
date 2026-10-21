import { describe, expect, it } from 'vitest';
import { resolveRunAgentNames, resolveRunAgentSelection } from './run-agent-selection.js';
import { expandConfigForAgents } from './config.js';
import type { EvalConfig } from './types.js';

describe('resolveRunAgentNames', () => {
  const base = {
    declaredAgentNames: ['eval-a', 'eval-b'],
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
      resolveRunAgentNames({ declaredAgentNames: [], defaultEvaluationAgentName: 'workspace' })
    ).toEqual(['workspace']);
  });
  it('returns no agents when nothing is configured, without selecting the whole library', () => {
    expect(resolveRunAgentNames({ declaredAgentNames: [] })).toEqual([]);
  });
  it('rejects evaluation defaults outside declared agents instead of silently substituting', () => {
    expect(() => resolveRunAgentNames({ ...base, selectedAgentNames: ['deleted'] })).toThrow(
      'Evaluation default agents must be declared in the evaluation: deleted'
    );
  });
  it('retains the origin of each selection tier', () => {
    expect(resolveRunAgentSelection({ ...base, requestedAgentNames: ['override'] })).toEqual({
      agentNames: ['override'],
      source: 'requested'
    });
    expect(resolveRunAgentSelection(base).source).toBe('evaluation_default');
    expect(resolveRunAgentSelection({ ...base, selectedAgentNames: [] }).source).toBe(
      'evaluation_agents'
    );
    expect(
      resolveRunAgentSelection({ declaredAgentNames: [], defaultEvaluationAgentName: 'workspace' })
        .source
    ).toBe('workspace_default');
    expect(resolveRunAgentSelection({ declaredAgentNames: [] }).source).toBe('none');
  });
  it('rejects an empty resolved selection instead of expanding to all library agents', () => {
    const config = {
      agents: { library: { provider: 'openai', model: 'test' } },
      scenarios: []
    } as unknown as EvalConfig;
    expect(() => expandConfigForAgents(config, [])).toThrow('No evaluation agents selected');
  });
});
