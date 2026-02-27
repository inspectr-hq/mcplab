import { describe, it, expect } from 'vitest';
import { expandConfigForAgents } from './config.js';
import type { EvalConfig } from './types.js';

const BASE_CONFIG: EvalConfig = {
  servers: {},
  agents: {
    'gpt-4': { provider: 'openai', model: 'gpt-4' },
    claude: { provider: 'anthropic', model: 'claude-opus-4-6' }
  },
  scenarios: [
    { id: 'scenario-1', servers: [], prompt: 'test prompt 1' },
    { id: 'scenario-2', servers: [], prompt: 'test prompt 2' }
  ]
};

describe('expandConfigForAgents', () => {
  it('expands each scenario for every agent when no agents requested', () => {
    const result = expandConfigForAgents(BASE_CONFIG);
    expect(result.scenarios).toHaveLength(4); // 2 scenarios × 2 agents
  });

  it('assigns agent and scenario_exec_id to each expanded scenario', () => {
    const result = expandConfigForAgents(BASE_CONFIG, ['gpt-4']);
    expect(result.scenarios[0].agent).toBe('gpt-4');
    expect(result.scenarios[0].scenario_exec_id).toBe('scenario-1-gpt-4');
    expect(result.scenarios[1].agent).toBe('gpt-4');
    expect(result.scenarios[1].scenario_exec_id).toBe('scenario-2-gpt-4');
  });

  it('expands only for the requested agents when provided', () => {
    const result = expandConfigForAgents(BASE_CONFIG, ['claude']);
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios.every((s) => s.agent === 'claude')).toBe(true);
  });

  it('preserves all other config fields', () => {
    const result = expandConfigForAgents(BASE_CONFIG, ['gpt-4']);
    expect(result.agents).toEqual(BASE_CONFIG.agents);
    expect(result.servers).toEqual(BASE_CONFIG.servers);
  });

  it('throws for an unknown agent name', () => {
    expect(() => expandConfigForAgents(BASE_CONFIG, ['unknown-agent'])).toThrow(
      'Unknown agents: unknown-agent'
    );
  });

  it('throws listing all available agents when agent is unknown', () => {
    expect(() => expandConfigForAgents(BASE_CONFIG, ['bad'])).toThrow('Available: gpt-4, claude');
  });
});
