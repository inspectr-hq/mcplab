import { describe, expect, it } from 'vitest';
import { resolveLoadedRunAgents, resolveRunAgentSelection } from './run-agent-selection.js';
import { expandConfigForAgents } from './config.js';
import type { EvalConfig } from './types.js';

describe('resolveRunAgentSelection', () => {
  const base = {
    declaredAgentNames: ['eval-a', 'eval-b'],
    selectedAgentNames: ['eval-b'],
    defaultEvaluationAgentName: 'workspace'
  };

  it('prefers explicit run selection over every default', () => {
    expect(
      resolveRunAgentSelection({ ...base, requestedAgentNames: ['override'] }).agentNames
    ).toEqual(['override']);
  });
  it('prefers evaluation defaults over declared agents and workspace defaults', () => {
    expect(resolveRunAgentSelection(base).agentNames).toEqual(['eval-b']);
  });
  it('keeps all evaluation agents when no evaluation defaults are marked', () => {
    expect(resolveRunAgentSelection({ ...base, selectedAgentNames: [] }).agentNames).toEqual([
      'eval-a',
      'eval-b'
    ]);
  });
  it('inherits the workspace default only for an evaluation without agents', () => {
    expect(
      resolveRunAgentSelection({ declaredAgentNames: [], defaultEvaluationAgentName: 'workspace' })
        .agentNames
    ).toEqual(['workspace']);
  });
  it('returns no agents when nothing is configured, without selecting the whole library', () => {
    expect(resolveRunAgentSelection({ declaredAgentNames: [] }).agentNames).toEqual([]);
  });
  it('respects an explicitly empty agent request instead of falling back to workspace defaults', () => {
    expect(
      resolveRunAgentSelection({
        declaredAgentNames: [],
        requestedAgentNames: [],
        defaultEvaluationAgentName: 'workspace'
      })
    ).toEqual({ agentNames: [], source: 'requested' });
  });
  it('rejects evaluation defaults outside declared agents instead of silently substituting', () => {
    expect(() => resolveRunAgentSelection({ ...base, selectedAgentNames: ['deleted'] })).toThrow(
      'Evaluation default agents must be declared in the evaluation: deleted'
    );
  });
  it('validates inherited defaults against available agent definitions', () => {
    const params = {
      declaredAgentNames: [],
      defaultEvaluationAgentName: 'workspace',
      availableAgents: { workspace: { provider: 'openai' as const, model: 'test' } }
    };
    expect(resolveRunAgentSelection(params)).toEqual({
      agentNames: ['workspace'],
      source: 'workspace_default'
    });
    expect(() =>
      resolveRunAgentSelection({
        ...params,
        availableAgents: {
          workspace: { type: 'browser', provider: 'chatgpt', url: 'https://chatgpt.com' }
        }
      })
    ).toThrow('must be an LLM agent');
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

describe('resolveLoadedRunAgents', () => {
  const config = {
    agents: { library: { provider: 'openai' as const, model: 'test' } },
    scenarios: []
  } as EvalConfig;

  it('uses declared-agent provenance after library agents are merged', () => {
    expect(
      resolveLoadedRunAgents({
        loaded: { declaredAgentNames: [] },
        config,
        defaultEvaluationAgentName: 'library'
      })
    ).toEqual({ agentNames: ['library'], source: 'workspace_default' });
    expect(resolveLoadedRunAgents({ loaded: { declaredAgentNames: [] }, config })).toEqual({
      agentNames: [],
      source: 'none'
    });
    expect(
      resolveLoadedRunAgents({ loaded: { declaredAgentNames: ['declared'] }, config })
    ).toEqual({ agentNames: ['declared'], source: 'evaluation_agents' });
  });

  it('accepts explicit requests and evaluation defaults through named parameters', () => {
    expect(
      resolveLoadedRunAgents({
        loaded: { declaredAgentNames: ['declared'] },
        config: { ...config, run_defaults: { selected_agents: ['declared'] } },
        requestedAgentNames: ['library']
      })
    ).toEqual({ agentNames: ['library'], source: 'requested' });
    expect(() =>
      resolveLoadedRunAgents({
        loaded: { declaredAgentNames: [] },
        config: { ...config, run_defaults: { selected_agents: ['declared'] } }
      })
    ).toThrow('must be declared');
  });

  it('can defer validation until a prompt selection is made', () => {
    expect(
      resolveLoadedRunAgents({
        loaded: { declaredAgentNames: [] },
        config,
        defaultEvaluationAgentName: 'not-loaded-yet',
        validateAvailableAgents: false
      })
    ).toEqual({ agentNames: ['not-loaded-yet'], source: 'workspace_default' });
  });
});
