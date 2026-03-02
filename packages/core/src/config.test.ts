import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { expandConfigForAgents, loadConfig } from './config.js';
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

describe('loadConfig normalization', () => {
  it('preserves optional top-level config name from source config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        ['name: Weather checks baseline', 'servers: []', 'agents: []', 'scenarios: []'].join('\n'),
        'utf8'
      );

      const { sourceConfig } = loadConfig(configPath);
      expect(sourceConfig.name).toBe('Weather checks baseline');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves scenario name from source config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'servers: {}',
          'agents: {}',
          'scenarios:',
          '  - id: scn-1',
          '    name: Check Weather',
          '    servers: []',
          '    prompt: test'
        ].join('\n'),
        'utf8'
      );

      const { sourceConfig } = loadConfig(configPath);
      expect(sourceConfig.scenarios[0]?.name).toBe('Check Weather');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports mixed scenarios entries with ref + inline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const scenariosDir = join(dir, 'scenarios');
      mkdirSync(scenariosDir, { recursive: true });
      writeFileSync(
        join(dir, 'servers.yaml'),
        ['tm:', '  transport: http', '  url: http://localhost:3001/mcp'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(scenariosDir, 'check-weather.yaml'),
        ['id: scn-weather', 'name: Check Weather', 'servers: []', 'prompt: "lookup"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'mixed.yaml');
      writeFileSync(
        configPath,
        [
          'servers: {}',
          'agents: {}',
          'scenarios:',
          '  - ref: scn-weather',
          '  - id: scn-inline',
          '    name: Inline Scenario',
          '    servers: []',
          '    prompt: do-inline'
        ].join('\n'),
        'utf8'
      );

      const { config, sourceConfig } = loadConfig(configPath);
      expect(sourceConfig.scenarios).toHaveLength(2);
      expect(config.scenarios).toHaveLength(2);
      expect((config.scenarios[0] as any).id).toBe('scn-weather');
      expect((config.scenarios[1] as any).id).toBe('scn-inline');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects legacy scenario_refs field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const scenariosDir = join(dir, 'scenarios');
      mkdirSync(scenariosDir, { recursive: true });
      writeFileSync(
        join(scenariosDir, 'check-weather.yaml'),
        ['id: scn-weather', 'name: Check Weather', 'servers: []', 'prompt: "lookup"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'legacy.yaml');
      writeFileSync(
        configPath,
        ['servers: {}', 'agents: {}', 'scenarios: []', 'scenario_refs:', '  - scn-weather'].join(
          '\n'
        ),
        'utf8'
      );

      expect(() => loadConfig(configPath)).toThrow('scenario_refs is not supported');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when inline and referenced scenario ids collide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const scenariosDir = join(dir, 'scenarios');
      mkdirSync(scenariosDir, { recursive: true });
      writeFileSync(
        join(scenariosDir, 'check-weather.yaml'),
        ['id: scn-weather', 'name: Check Weather', 'servers: []', 'prompt: "lookup"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'duplicate.yaml');
      writeFileSync(
        configPath,
        [
          'servers: {}',
          'agents: {}',
          'scenarios:',
          '  - ref: scn-weather',
          '  - id: scn-weather',
          '    name: Inline duplicate',
          '    servers: []',
          '    prompt: test'
        ].join('\n'),
        'utf8'
      );

      expect(() => loadConfig(configPath)).toThrow('Duplicate scenario id detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects legacy agent_refs field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['claude-sonnet-46:', '  provider: anthropic', '  model: claude-sonnet-4-6'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'legacy-agents.yaml');
      writeFileSync(
        configPath,
        ['servers: {}', 'agents: {}', 'agent_refs:', '  - claude-sonnet-46', 'scenarios: []'].join(
          '\n'
        ),
        'utf8'
      );

      expect(() => loadConfig(configPath)).toThrow('agent_refs is not supported');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects legacy server_refs field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'servers.yaml'),
        ['Weather MCP:', '  transport: http', '  url: http://localhost:3011/mcp'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'legacy-servers.yaml');
      writeFileSync(
        configPath,
        ['servers: {}', 'server_refs:', '  - Weather MCP', 'agents: []', 'scenarios: []'].join(
          '\n'
        ),
        'utf8'
      );

      expect(() => loadConfig(configPath)).toThrow('server_refs is not supported');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves server/agent refs from list-based libraries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'servers.yaml'),
        ['- id: weather-mcp', '  transport: http', '  url: http://localhost:3300/mcp'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['- id: claude-sonnet-46', '  provider: anthropic', '  model: claude-sonnet-4-6'].join(
          '\n'
        ),
        'utf8'
      );
      const configPath = join(dir, 'refs.yaml');
      writeFileSync(
        configPath,
        [
          'servers:',
          '  - ref: weather-mcp',
          'agents:',
          '  - ref: claude-sonnet-46',
          'scenarios:',
          '  - id: scn-1',
          '    servers:',
          '      - weather-mcp',
          '    prompt: test',
          'run_defaults:',
          '  selected_agents:',
          '    - claude-sonnet-46'
        ].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(config.servers['weather-mcp']).toBeTruthy();
      expect(config.agents['claude-sonnet-46']).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
