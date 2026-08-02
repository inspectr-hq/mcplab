import { describe, expect, it, vi } from 'vitest';
import {
  prepareWorkspaceEvaluationRun,
  submitWorkspaceEvaluationRun
} from './workspace-evaluation-run';
import type { AgentConfig, EvalConfig, Scenario, ServerConfig } from '@/types/eval';
import type { EvalDataSource } from './data-sources/types';

const agent: AgentConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  provider: 'azure',
  model: 'deepseek-v4',
  temperature: 0,
  maxTokens: 4096
};

const scenario: Scenario = {
  id: 'tag-profile',
  name: 'Tag Profile',
  prompt: 'Look up the tag profile.',
  serverIds: ['oauth-server'],
  evalRules: [],
  extractRules: []
};

const oauthServer: ServerConfig = {
  id: 'oauth-server',
  name: 'OAuth Server',
  transport: 'stdio',
  command: 'server',
  authType: 'oauth2'
};

const config: EvalConfig = {
  id: 'tag-profile-config',
  name: 'Tag Profile',
  sourcePath: '/workspace/evals/tag-profile.yaml',
  agents: [agent],
  scenarios: [scenario],
  servers: [oauthServer],
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z'
};

describe('workspace evaluation run', () => {
  it('submits approved agent and server overrides through the OAuth-aware queue path', async () => {
    const prepared = prepareWorkspaceEvaluationRun({
      config,
      availableAgents: [agent],
      availableScenarios: [scenario],
      libraryServers: [oauthServer],
      selectedAgentIds: ['deepseek'],
      selectedScenarioIds: ['tag-profile'],
      runsPerScenario: 2,
      globalServerOverrideEnabled: true,
      globalServerOverrideIds: ['oauth-server'],
      scenarioServerOverrides: {},
      runNote: 'Copilot requested run'
    });
    const ensureOAuth = vi.fn().mockResolvedValue(undefined);
    const startRun = vi.fn().mockResolvedValue({ jobId: 'queue-job-1' });

    const result = await submitWorkspaceEvaluationRun({
      prepared,
      source: { startRun } as unknown as EvalDataSource,
      ensureOAuth
    });

    expect(ensureOAuth).toHaveBeenCalledWith(['oauth-server']);
    expect(startRun).toHaveBeenCalledWith({
      configPath: '/workspace/evals/tag-profile.yaml',
      runsPerScenario: 2,
      agents: ['deepseek'],
      scenarioIds: ['tag-profile'],
      serverOverrideAll: ['oauth-server'],
      runNote: 'Copilot requested run'
    });
    expect(result).toEqual({ jobId: 'queue-job-1' });
  });
});
