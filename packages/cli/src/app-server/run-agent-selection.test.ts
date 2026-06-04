import { describe, expect, it } from 'vitest';
import { resolveRunSelectedAgents } from './run-agent-selection.js';

describe('resolveRunSelectedAgents', () => {
  it('prefers explicitly requested agents', () => {
    const resolved = resolveRunSelectedAgents(
      {
        agents: {
          'claude-sonnet-46': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          'azure-gpt-5-mini': { provider: 'azure_openai', model: 'gpt-5-mini' }
        },
        scenarios: []
      } as any,
      ['azure-gpt-5-mini']
    );

    expect(resolved).toEqual(['azure-gpt-5-mini']);
  });

  it('falls back to run default agents when no request agents are provided', () => {
    const resolved = resolveRunSelectedAgents({
      agents: {
        'claude-sonnet-46': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        'azure-gpt-5-mini': { provider: 'azure_openai', model: 'gpt-5-mini' }
      },
      scenarios: [],
      run_defaults: {
        selected_agents: ['claude-sonnet-46']
      }
    } as any);

    expect(resolved).toEqual(['claude-sonnet-46']);
  });

  it('falls back to config-declared agents when neither request nor defaults are provided', () => {
    const resolved = resolveRunSelectedAgents({
      agents: {
        'claude-sonnet-46': { provider: 'anthropic', model: 'claude-sonnet-4-6' }
      },
      scenarios: []
    } as any);

    expect(resolved).toEqual(['claude-sonnet-46']);
  });

  it('returns an empty list when the config declares no agents and no defaults', () => {
    const resolved = resolveRunSelectedAgents({
      agents: {},
      scenarios: []
    } as any);

    expect(resolved).toEqual([]);
  });
});
