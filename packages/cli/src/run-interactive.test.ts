import { describe, expect, it } from 'vitest';
import {
  getAgentModeOptions,
  loadInteractiveConfig,
  parseNumberSelection,
  resolveRunOptions
} from './run-interactive.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRunAgentSelection } from '@inspectr/mcplab-core';

describe('loadInteractiveConfig', () => {
  it.each(['browser', 'deleted'])(
    'allows replacing a persisted %s workspace default',
    (defaultName) => {
      const root = mkdtempSync(join(tmpdir(), 'mcplab-interactive-default-'));
      try {
        writeFileSync(
          join(root, 'agents.yaml'),
          'main:\n  provider: openai\n  model: test\nbrowser:\n  type: browser\n  provider: chatgpt\n  url: https://chatgpt.com\n'
        );
        writeFileSync(
          join(root, '.mcplab-app-settings.yaml'),
          `default_evaluation_agent_name: ${defaultName}\n`
        );
        const configPath = join(root, 'eval.yaml');
        writeFileSync(configPath, 'scenarios: []\n');
        const loaded = loadInteractiveConfig(configPath);
        expect(loaded.config.run_defaults).toBeUndefined();
        expect(loaded.declaredAgentNames).toEqual([]);
        expect(loaded.agentSelection).toEqual({
          agentNames: [defaultName],
          source: 'workspace_default'
        });
        const options = resolveRunOptions({
          interactive: true,
          interactiveSelection: { configPath, agentMode: 'specific', agents: ['main'] }
        });
        expect(
          resolveRunAgentSelection({
            declaredAgentNames: loaded.declaredAgentNames,
            requestedAgentNames: options.agents?.split(','),
            defaultEvaluationAgentName: defaultName
          })
        ).toEqual({ agentNames: ['main'], source: 'requested' });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

describe('getAgentModeOptions', () => {
  it('labels workspace defaults and distinguishes the full library', () => {
    expect(
      getAgentModeOptions(['main', 'other'], { agentNames: ['main'], source: 'workspace_default' })
    ).toEqual([
      { mode: 'all', label: 'All available agents' },
      { mode: 'defaults', label: 'Workspace default agent (main)' },
      { mode: 'specific', label: 'Choose specific agents' }
    ]);
  });
  it('does not duplicate all-agents when no explicit defaults exist', () => {
    expect(
      getAgentModeOptions(['main'], { agentNames: ['main'], source: 'evaluation_agents' }).map(
        (choice) => choice.mode
      )
    ).toEqual(['all', 'specific']);
    expect(
      getAgentModeOptions(['main', 'other'], {
        agentNames: ['main'],
        source: 'evaluation_agents'
      })[1].label
    ).toBe('Evaluation agents (main)');
  });
});

describe('parseNumberSelection', () => {
  it('parses a single selection', () => {
    expect(parseNumberSelection('2', 3)).toEqual([1]);
  });

  it('parses multiple selections and keeps input order', () => {
    expect(parseNumberSelection('3,1,2', 3)).toEqual([2, 0, 1]);
  });

  it('deduplicates repeated selections', () => {
    expect(parseNumberSelection('1,1,2,2', 3)).toEqual([0, 1]);
  });

  it('rejects empty selection', () => {
    expect(() => parseNumberSelection('   ', 3)).toThrow('Please provide at least one number.');
  });

  it('rejects out-of-range values', () => {
    expect(() => parseNumberSelection('4', 3)).toThrow('Selection "4" is out of range (1-3).');
  });
});

describe('resolveRunOptions', () => {
  it('requires config in non-interactive mode', () => {
    expect(() => resolveRunOptions({ interactive: false })).toThrow('config is required');
  });

  it('throws on conflicting --agents and --agents-all', () => {
    expect(() =>
      resolveRunOptions({
        interactive: false,
        config: 'mcplab/evals/check-weather.yaml',
        agents: 'claude-sonnet-46',
        agentsAll: true
      })
    ).toThrow('Use either --agents or --agents-all, not both.');
  });

  it('supports interactive with provided config and all agents selection', () => {
    const resolved = resolveRunOptions({
      interactive: true,
      config: 'mcplab/evals/check-weather.yaml',
      interactiveSelection: {
        configPath: '/tmp/ignored.yaml',
        agentMode: 'all'
      }
    });
    expect(resolved).toEqual({
      config: 'mcplab/evals/check-weather.yaml',
      agentsAll: true
    });
  });

  it('supports interactive defaults mode without explicit agent override', () => {
    const resolved = resolveRunOptions({
      interactive: true,
      interactiveSelection: {
        configPath: 'mcplab/evals/check-weather.yaml',
        agentMode: 'defaults'
      }
    });
    expect(resolved).toEqual({
      config: 'mcplab/evals/check-weather.yaml',
      agentsAll: false
    });
  });

  it('supports interactive mode without prompt selection when config and agent override are provided', () => {
    const resolved = resolveRunOptions({
      interactive: true,
      config: 'mcplab/evals/check-weather.yaml',
      agentsAll: true
    });
    expect(resolved).toEqual({
      config: 'mcplab/evals/check-weather.yaml',
      agentsAll: true
    });
  });

  it('supports interactive specific mode with selected agents', () => {
    const resolved = resolveRunOptions({
      interactive: true,
      interactiveSelection: {
        configPath: 'mcplab/evals/check-weather.yaml',
        agentMode: 'specific',
        agents: ['claude-sonnet-46', 'azure-gpt-5-mini']
      }
    });
    expect(resolved).toEqual({
      config: 'mcplab/evals/check-weather.yaml',
      agents: 'claude-sonnet-46,azure-gpt-5-mini',
      agentsAll: false
    });
  });
});
