import { describe, expect, it } from 'vitest';
import type { EvalConfig } from '@inspectr/mcplab-core';
import { resolveRunSelectedAgents } from './run-agent-selection.js';

const config: EvalConfig = {
  servers: {},
  agents: { library: { provider: 'openai', model: 'test' } },
  scenarios: []
};

describe('resolveRunSelectedAgents', () => {
  it('uses required declaration provenance even after libraries are merged', () => {
    expect(
      resolveRunSelectedAgents(config, undefined, {
        declaredAgentNames: [],
        defaultEvaluationAgentName: 'library'
      })
    ).toEqual({ agentNames: ['library'], source: 'workspace_default' });
    expect(resolveRunSelectedAgents(config, undefined, { declaredAgentNames: [] })).toEqual({
      agentNames: [],
      source: 'none'
    });
    expect(
      resolveRunSelectedAgents(config, undefined, {
        declaredAgentNames: ['declared'],
        defaultEvaluationAgentName: 'library'
      })
    ).toEqual({ agentNames: ['declared'], source: 'evaluation_agents' });
  });
  it('prefers explicitly requested library agents', () => {
    expect(
      resolveRunSelectedAgents(config, ['library'], { declaredAgentNames: ['declared'] })
    ).toEqual({ agentNames: ['library'], source: 'requested' });
  });
  it('retains evaluation defaults and rejects undeclared defaults', () => {
    const withDefaults = { ...config, run_defaults: { selected_agents: ['declared'] } };
    expect(
      resolveRunSelectedAgents(withDefaults, undefined, {
        declaredAgentNames: ['declared', 'other']
      })
    ).toEqual({ agentNames: ['declared'], source: 'evaluation_default' });
    expect(() =>
      resolveRunSelectedAgents(withDefaults, undefined, { declaredAgentNames: [] })
    ).toThrow('must be declared');
  });
});
