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

  it('loads scenario ref from test-cases folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const testCasesDir = join(dir, 'test-cases');
      mkdirSync(testCasesDir, { recursive: true });
      writeFileSync(
        join(testCasesDir, 'check-weather.yaml'),
        ['id: check-weather', 'name: Check Weather', 'servers: []', 'prompt: "lookup"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'refs.yaml');
      writeFileSync(
        configPath,
        ['servers: []', 'agents: []', 'scenarios:', '  - ref: check-weather'].join('\n'),
        'utf8'
      );

      const { config, warnings } = loadConfig(configPath);
      expect(config.scenarios).toHaveLength(1);
      expect(config.scenarios[0]?.id).toBe('check-weather');
      expect(warnings).not.toContain(
        "Using legacy library folder 'scenarios'; migrate to 'test-cases'."
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults referenced scenario servers to empty array when omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const testCasesDir = join(dir, 'test-cases');
      mkdirSync(testCasesDir, { recursive: true });
      writeFileSync(
        join(testCasesDir, 'llm-only.yaml'),
        ['id: llm-only', 'name: LLM Only', 'prompt: "Which version are you?"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'refs.yaml');
      writeFileSync(
        configPath,
        ['servers: []', 'agents: []', 'scenarios:', '  - ref: llm-only'].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(config.scenarios).toHaveLength(1);
      expect(config.scenarios[0]?.id).toBe('llm-only');
      expect(config.scenarios[0]?.servers).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to scenarios folder when test-cases is absent and warns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const scenariosDir = join(dir, 'scenarios');
      mkdirSync(scenariosDir, { recursive: true });
      writeFileSync(
        join(scenariosDir, 'check-weather.yaml'),
        ['id: check-weather', 'name: Check Weather', 'servers: []', 'prompt: "lookup"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'refs.yaml');
      writeFileSync(
        configPath,
        ['servers: []', 'agents: []', 'scenarios:', '  - ref: check-weather'].join('\n'),
        'utf8'
      );

      const { config, warnings } = loadConfig(configPath);
      expect(config.scenarios).toHaveLength(1);
      expect(config.scenarios[0]?.id).toBe('check-weather');
      expect(warnings).toContain(
        "Using legacy library folder 'scenarios'; migrate to 'test-cases'."
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers test-cases over scenarios when both folders exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const testCasesDir = join(dir, 'test-cases');
      const legacyScenariosDir = join(dir, 'scenarios');
      mkdirSync(testCasesDir, { recursive: true });
      mkdirSync(legacyScenariosDir, { recursive: true });
      writeFileSync(
        join(testCasesDir, 'check-weather.yaml'),
        ['id: check-weather', 'name: Canonical', 'servers: []', 'prompt: "canonical"'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(legacyScenariosDir, 'check-weather.yaml'),
        ['id: check-weather', 'name: Legacy', 'servers: []', 'prompt: "legacy"'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'refs.yaml');
      writeFileSync(
        configPath,
        ['servers: []', 'agents: []', 'scenarios:', '  - ref: check-weather'].join('\n'),
        'utf8'
      );

      const { config, warnings } = loadConfig(configPath);
      expect(config.scenarios).toHaveLength(1);
      expect(config.scenarios[0]?.prompt).toBe('canonical');
      expect(warnings).not.toContain(
        "Using legacy library folder 'scenarios'; migrate to 'test-cases'."
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects bundle root from evals directory and resolves refs from parent library files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      const evalsDir = join(dir, 'evals');
      const testCasesDir = join(dir, 'test-cases');
      mkdirSync(evalsDir, { recursive: true });
      mkdirSync(testCasesDir, { recursive: true });

      writeFileSync(
        join(dir, 'agents.yaml'),
        ['claude-sonnet-46:', '  provider: anthropic', '  model: claude-sonnet-4-6'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(dir, 'servers.yaml'),
        ['weather-mcp:', '  transport: http', '  url: http://localhost:3300/mcp'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(testCasesDir, 'search-tags.yaml'),
        [
          'id: search-tags',
          'name: Search tags',
          'mcp_servers:',
          '  - ref: weather-mcp',
          'prompt: Search tags'
        ].join('\n'),
        'utf8'
      );
      const configPath = join(evalsDir, 'llm-evaluation.yaml');
      writeFileSync(
        configPath,
        [
          'agents:',
          '  - ref: claude-sonnet-46',
          'scenarios:',
          '  - ref: search-tags',
          'run_defaults:',
          '  selected_agents:',
          '    - claude-sonnet-46'
        ].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(config.agents['claude-sonnet-46']).toBeTruthy();
      expect(config.scenarios[0]?.id).toBe('search-tags');
      expect(config.servers['weather-mcp']).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves scenario mcp_servers ref from library servers.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'servers.yaml'),
        ['weather-mcp:', '  transport: http', '  url: http://localhost:3300/mcp'].join('\n'),
        'utf8'
      );
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'agents:',
          '  - ref: agent-a',
          'scenarios:',
          '  - id: scn-1',
          '    mcp_servers:',
          '      - ref: weather-mcp',
          '    prompt: test',
          'run_defaults:',
          '  selected_agents:',
          '    - agent-a'
        ].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(config.servers['weather-mcp']).toMatchObject({
        transport: 'http',
        url: 'http://localhost:3300/mcp'
      });
      expect(config.scenarios[0]?.servers).toContain('weather-mcp');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves scenario mcp_servers inline entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'agents:',
          '  - ref: agent-a',
          'scenarios:',
          '  - id: scn-1',
          '    mcp_servers:',
          '      - id: local-server',
          '        transport: http',
          '        url: http://localhost:9999/mcp',
          '    prompt: test',
          'run_defaults:',
          '  selected_agents:',
          '    - agent-a'
        ].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(config.servers['local-server']).toMatchObject({
        transport: 'http',
        url: 'http://localhost:9999/mcp'
      });
      expect(config.scenarios[0]?.servers).toContain('local-server');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves scenario with no mcp_servers to empty servers array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'agents:',
          '  - ref: agent-a',
          'scenarios:',
          '  - id: scn-1',
          '    prompt: pure LLM test',
          'run_defaults:',
          '  selected_agents:',
          '    - agent-a'
        ].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(config.scenarios[0]?.servers).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on conflicting mcp_servers definitions across scenarios', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'agents:',
          '  - ref: agent-a',
          'scenarios:',
          '  - id: scn-1',
          '    mcp_servers:',
          '      - id: my-server',
          '        transport: http',
          '        url: http://localhost:3001/mcp',
          '    prompt: test 1',
          '  - id: scn-2',
          '    mcp_servers:',
          '      - id: my-server',
          '        transport: http',
          '        url: http://localhost:3002/mcp',
          '    prompt: test 2',
          'run_defaults:',
          '  selected_agents:',
          '    - agent-a'
        ].join('\n'),
        'utf8'
      );

      expect(() => loadConfig(configPath)).toThrow(
        'Conflicting mcp_servers definition for id: my-server'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows identical mcp_servers definitions across scenarios (deduped silently)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'agents:',
          '  - ref: agent-a',
          'scenarios:',
          '  - id: scn-1',
          '    mcp_servers:',
          '      - id: shared',
          '        transport: http',
          '        url: http://localhost:3001/mcp',
          '    prompt: test 1',
          '  - id: scn-2',
          '    mcp_servers:',
          '      - id: shared',
          '        transport: http',
          '        url: http://localhost:3001/mcp',
          '    prompt: test 2',
          'run_defaults:',
          '  selected_agents:',
          '    - agent-a'
        ].join('\n'),
        'utf8'
      );

      const { config } = loadConfig(configPath);
      expect(Object.keys(config.servers)).toHaveLength(1);
      expect(config.servers['shared']).toMatchObject({ url: 'http://localhost:3001/mcp' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads legacy format (top-level servers + scenario servers string[]) with deprecation warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-config-'));
    try {
      writeFileSync(
        join(dir, 'agents.yaml'),
        ['agent-a:', '  provider: openai', '  model: gpt-4o-mini'].join('\n'),
        'utf8'
      );
      const configPath = join(dir, 'config.yaml');
      writeFileSync(
        configPath,
        [
          'servers:',
          '  - id: legacy-server',
          '    transport: http',
          '    url: http://localhost:3001/mcp',
          'agents:',
          '  - ref: agent-a',
          'scenarios:',
          '  - id: scn-1',
          '    servers:',
          '      - legacy-server',
          '    prompt: test',
          'run_defaults:',
          '  selected_agents:',
          '    - agent-a'
        ].join('\n'),
        'utf8'
      );

      const { config, warnings } = loadConfig(configPath);
      expect(config.servers['legacy-server']).toBeTruthy();
      expect(config.scenarios[0]?.servers).toContain('legacy-server');
      expect(warnings.some((w) => w.includes('top-level servers is deprecated'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
