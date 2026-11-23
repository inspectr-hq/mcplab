import type { EvalConfig, EvalResult } from '@/types/eval';
import type { WorkspaceRunSummary, EvalDataSource } from '@/lib/data-sources/types';

const date = '2026-06-15T10:30:00.000Z';

export const demoConfig: EvalConfig = {
  id: 'config-demo',
  name: 'Support Assistant Evaluation',
  relativePath: 'support/evaluation.yaml',
  sourcePath: '/workspace/evals/support/evaluation.yaml',
  agents: [
    {
      id: 'agent-demo',
      name: 'Support Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 2048
    }
  ],
  scenarios: [
    {
      id: 'scenario-demo',
      name: 'Find a support article',
      serverIds: ['server-demo'],
      prompt: 'Find the support article for resetting a password.',
      evalRules: [{ type: 'response_contains', value: 'password' }],
      extractRules: []
    }
  ],
  createdAt: date,
  updatedAt: date
};

export const demoResult: EvalResult = {
  id: 'run-demo',
  configId: demoConfig.id,
  configHash: 'fixture-hash',
  configName: demoConfig.name,
  timestamp: date,
  mcpServerVersions: { support: '1.2.0' },
  scenarios: [
    {
      scenarioId: 'scenario-demo',
      scenarioName: 'Find a support article',
      agentId: 'agent-demo',
      agentName: 'Support Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [],
          finalAnswer: 'I found the relevant support article.',
          conversation: [],
          duration: 820,
          extractedValues: {},
          failureReasons: []
        }
      ],
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 820
    }
  ],
  overallPassRate: 1,
  totalScenarios: 1,
  totalRuns: 1,
  avgToolCalls: 1,
  avgLatency: 820,
  totalDurationMs: 820,
  checkCounts: { passed: 3, failed: 0, not_evaluated: 0, total: 3 }
};

export const demoSummary: WorkspaceRunSummary = {
  runId: demoResult.id,
  path: '/workspace/runs/run-demo.json',
  timestamp: date,
  configHash: demoResult.configHash,
  configPath: demoConfig.sourcePath,
  configName: demoConfig.name,
  scenarioIds: ['scenario-demo'],
  scenarioNames: ['Find a support article'],
  totalScenarios: 1,
  totalRuns: 1,
  passRate: 1,
  avgToolCalls: 1,
  avgLatencyMs: 820,
  totalDurationMs: 820
};

export const sourceFor = (populated: boolean): EvalDataSource =>
  new Proxy({} as EvalDataSource, {
    get: (_target, property) => {
      if (property === 'subscribeRunQueue' || String(property).startsWith('subscribe'))
        return () => () => {};
      if (property === 'getRunQueue')
        return async () => ({
          active: null,
          active_jobs: [],
          admitting_jobs: [],
          queued: [],
          evaluations: []
        });
      if (property === 'listResults') return async () => (populated ? [demoResult] : []);
      if (property === 'listRunSummaries') return async () => (populated ? [demoSummary] : []);
      if (property === 'listRunSummariesPage')
        return async () => ({
          object: 'list',
          url: '',
          data: populated ? [demoSummary] : [],
          has_more: false,
          total_count: populated ? 1 : 0,
          next_offset: null,
          prev_offset: null
        });
      if (property === 'getResult') return async () => (populated ? demoResult : undefined);
      if (property === 'getLatestPassRatesByConfigIds')
        return async () => (populated ? { [demoConfig.id]: 1 } : {});
      if (property === 'health') return async () => ({ ok: true, version: 'storybook', mcp: {} });
      if (String(property).startsWith('list')) return async () => [];
      if (String(property).startsWith('get')) return async () => undefined;
      if (String(property).startsWith('start')) return async () => ({ jobId: 'storybook-job' });
      return async () => undefined;
    }
  });
