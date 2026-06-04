import { describe, expect, it } from 'vitest';
import { hashConfig } from '@inspectr/mcplab-core';
import type { EvalConfig } from '@inspectr/mcplab-core';
import { applyLibraryAgents, mergeLibraryAgentsIntoConfig } from './runs-routes.js';

const baseAgent = (): EvalConfig['agents'][string] => ({
  provider: 'openai' as const,
  model: 'gpt-4o',
  temperature: 0,
  max_tokens: 4096
});

describe('mergeLibraryAgentsIntoConfig', () => {
  it('adds library-only agents to the config agent map', () => {
    const config = {
      agents: { 'config-agent': baseAgent() }
    } as unknown as EvalConfig;

    const result = mergeLibraryAgentsIntoConfig(config, {
      'library-agent': baseAgent()
    });

    expect(result.agents['config-agent']).toBeDefined();
    expect(result.agents['library-agent']).toBeDefined();
  });

  it('config agents take precedence over library agents with the same id', () => {
    const config = {
      agents: { shared: { ...baseAgent(), model: 'config-model' } }
    } as unknown as EvalConfig;

    const result = mergeLibraryAgentsIntoConfig(config, {
      shared: { ...baseAgent(), model: 'library-model' }
    });

    expect(result.agents.shared.model).toBe('config-model');
  });

  it('does not mutate the original config', () => {
    const config = {
      agents: { 'config-agent': baseAgent() }
    } as unknown as EvalConfig;

    mergeLibraryAgentsIntoConfig(config, { 'library-agent': baseAgent() });

    expect(Object.keys(config.agents)).toEqual(['config-agent']);
  });
});

describe('applyLibraryAgents', () => {
  it('merges library agents into config and updates hash atomically', () => {
    const config = {
      agents: { 'config-agent': baseAgent() }
    } as unknown as EvalConfig;
    const loaded = { config, hash: hashConfig(config) };
    const originalHash = loaded.hash;

    applyLibraryAgents(loaded, { 'library-agent': baseAgent() });

    expect(loaded.config.agents['library-agent']).toBeDefined();
    expect(loaded.hash).not.toBe(originalHash);
  });

  it('hash reflects the merged config, not the pre-merge config', () => {
    const config = {
      agents: { 'config-agent': baseAgent() }
    } as unknown as EvalConfig;
    const loaded = { config, hash: 'stale-hash' };

    applyLibraryAgents(loaded, { 'library-agent': baseAgent() });

    expect(loaded.hash).toBe(hashConfig(loaded.config));
  });
});
