import { describe, expect, it } from 'vitest';
import { resolveConfigRunAgentSelection } from './config-run-agents';
import type { EvalConfig } from '@/types/eval';

describe('resolveConfigRunAgentSelection', () => {
  it('rejects an undeclared default even when it could exist in the library', () => {
    expect(() =>
      resolveConfigRunAgentSelection({
        agents: [],
        agentEntries: [{ kind: 'referenced', ref: 'declared' }],
        runDefaults: { selectedAgentNames: ['library-only'] }
      })
    ).toThrow('must be declared');
  });
  it('inherits a workspace default only when the evaluation has no agents', () => {
    expect(
      resolveConfigRunAgentSelection({ agents: [], agentEntries: [] }, 'workspace').agentNames
    ).toEqual(['workspace']);
    expect(resolveConfigRunAgentSelection({ agents: [], agentEntries: [] }).agentNames).toEqual([]);
    expect(
      resolveConfigRunAgentSelection(
        { agents: [], agentEntries: [{ kind: 'referenced', ref: 'local' }] },
        'workspace'
      ).agentNames
    ).toEqual(['local']);
  });
  it('returns trimmed configured agent ids when no run default subset is present', () => {
    const config: Pick<EvalConfig, 'agents' | 'agentEntries' | 'runDefaults'> = {
      agents: [
        {
          id: 'inline-agent',
          name: 'Inline Agent',
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0,
          maxTokens: 4096
        }
      ],
      agentEntries: [
        { kind: 'referenced', ref: ' referenced-agent ' },
        {
          kind: 'inline',
          agent: {
            id: ' inline-agent ',
            name: 'Inline Agent',
            provider: 'openai',
            model: 'gpt-4o',
            temperature: 0,
            maxTokens: 4096
          }
        }
      ]
    };

    expect(resolveConfigRunAgentSelection(config).agentNames).toEqual([
      'referenced-agent',
      'inline-agent'
    ]);
  });

  it('prefers run default agents when they are a subset of configured ids', () => {
    const config: Pick<EvalConfig, 'agents' | 'agentEntries' | 'runDefaults'> = {
      agents: [
        {
          id: 'agent-a',
          name: 'Agent A',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          temperature: 0,
          maxTokens: 4096
        },
        {
          id: 'agent-b',
          name: 'Agent B',
          provider: 'azure',
          model: 'gpt-5-mini',
          temperature: 0,
          maxTokens: 4096
        }
      ],
      agentEntries: [
        { kind: 'referenced', ref: 'agent-a' },
        { kind: 'referenced', ref: 'agent-b' }
      ],
      runDefaults: {
        selectedAgentNames: ['agent-b']
      }
    };

    expect(resolveConfigRunAgentSelection(config).agentNames).toEqual(['agent-b']);
  });
});
