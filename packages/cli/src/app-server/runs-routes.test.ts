import { describe, expect, it } from 'vitest';
import { mergeLibraryAgentsIntoConfig, applyLibraryAgents } from './runs-routes.js';
import { hashConfig } from '@inspectr/mcplab-core';
import type { EvalConfig } from '@inspectr/mcplab-core';

const baseAgent = (id: string): EvalConfig['agents'][string] => ({
  provider: 'openai' as const,
  model: 'gpt-4o',
  temperature: 0,
  max_tokens: 4096
});

describe('mergeLibraryAgentsIntoConfig', () => {
  it('adds library-only agents to the config agent map', () => {
    const config = {
      agents: { 'config-agent': baseAgent('config-agent') }
    } as unknown as EvalConfig;

    const libraryAgents = {
      'library-agent': baseAgent('library-agent')
    };

    const result = mergeLibraryAgentsIntoConfig(config, libraryAgents);

    expect(result.agents['config-agent']).toBeDefined();
    expect(result.agents['library-agent']).toBeDefined();
  });

  it('config agents take precedence over library agents with the same id', () => {
    const configAgentDef = { ...baseAgent('x'), model: 'config-model' };
    const libraryAgentDef = { ...baseAgent('x'), model: 'library-model' };

    const config = {
      agents: { 'shared-id': configAgentDef }
    } as unknown as EvalConfig;

    const libraryAgents = { 'shared-id': libraryAgentDef };

    const result = mergeLibraryAgentsIntoConfig(config, libraryAgents);

    expect(result.agents['shared-id'].model).toBe('config-model');
  });

  it('does not mutate the original config', () => {
    const originalAgents = { 'config-agent': baseAgent('config-agent') };
    const config = { agents: originalAgents } as unknown as EvalConfig;
    const libraryAgents = { 'library-agent': baseAgent('library-agent') };

    mergeLibraryAgentsIntoConfig(config, libraryAgents);

    expect(Object.keys(config.agents)).toEqual(['config-agent']);
  });
});

describe('applyLibraryAgents', () => {
  it('merges library agents into config and updates hash atomically', () => {
    const config = {
      agents: { 'config-agent': baseAgent('config-agent') }
    } as unknown as EvalConfig;
    const loaded = { config, hash: hashConfig(config) };
    const originalHash = loaded.hash;

    const libraryAgents = { 'library-agent': baseAgent('library-agent') };
    applyLibraryAgents(loaded, libraryAgents);

    expect(loaded.config.agents['library-agent']).toBeDefined();
    expect(loaded.hash).not.toBe(originalHash);
  });

  it('hash reflects the merged config, not the pre-merge config', () => {
    const config = {
      agents: { 'config-agent': baseAgent('config-agent') }
    } as unknown as EvalConfig;
    const loaded = { config, hash: 'stale-hash' };

    const libraryAgents = { 'library-agent': baseAgent('library-agent') };
    applyLibraryAgents(loaded, libraryAgents);

    expect(loaded.hash).toBe(hashConfig(loaded.config));
  });
});
