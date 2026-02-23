import { mockConfigs, mockResults } from '@/data/mock-data';
import type { EvalConfig, EvalResult } from '@/types/eval';
import type { EvalDataSource, RunJobEvent } from './types';

const STORAGE_KEY = 'mcp-eval-configs';
const LIBRARY_STORAGE_KEY = 'mcplab:libraries:v1';

function readConfigs(): EvalConfig[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? (JSON.parse(stored) as EvalConfig[]) : mockConfigs;
}

function writeConfigs(configs: EvalConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

function readLibraries(): {
  servers: EvalConfig['servers'];
  agents: EvalConfig['agents'];
  scenarios: EvalConfig['scenarios'];
} {
  const stored = localStorage.getItem(LIBRARY_STORAGE_KEY);
  if (!stored) {
    return { servers: [], agents: [], scenarios: [] };
  }
  try {
    const parsed = JSON.parse(stored) as {
      servers?: EvalConfig['servers'];
      agents?: EvalConfig['agents'];
      scenarios?: EvalConfig['scenarios'];
    };
    return {
      servers: parsed.servers ?? [],
      agents: parsed.agents ?? [],
      scenarios: parsed.scenarios ?? []
    };
  } catch {
    return { servers: [], agents: [], scenarios: [] };
  }
}

function writeLibraries(libraries: {
  servers: EvalConfig['servers'];
  agents: EvalConfig['agents'];
  scenarios: EvalConfig['scenarios'];
}) {
  localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(libraries));
}

export const demoSource: EvalDataSource = {
  async listConfigs() {
    return readConfigs();
  },
  async createConfig(config) {
    const next = [...readConfigs(), config];
    writeConfigs(next);
    return config;
  },
  async updateConfig(config) {
    const next = readConfigs().map((item) => (item.id === config.id ? config : item));
    writeConfigs(next);
    return config;
  },
  async deleteConfig(id) {
    const next = readConfigs().filter((item) => item.id !== id);
    writeConfigs(next);
  },
  async listResults() {
    return mockResults;
  },
  async getResult(id) {
    return mockResults.find((item) => item.id === id);
  },
  async deleteResult() {
    // demo source is static; no-op
  },
  async startRun() {
    return { jobId: `demo-${Date.now()}` };
  },
  async stopRun() {
    // no-op
  },
  subscribeRunJob(_jobId: string, onEvent: (event: RunJobEvent) => void) {
    const timeout = window.setTimeout(() => {
      onEvent({
        type: 'completed',
        ts: new Date().toISOString(),
        payload: { runId: mockResults[0]?.id ?? 'run-a1b2c3' }
      });
    }, 1200);
    return () => window.clearTimeout(timeout);
  },
  async listSnapshots() {
    return [];
  },
  async createSnapshotFromRun() {
    throw new Error('Snapshots are only available in workspace mode.');
  },
  async getSnapshot() {
    return undefined;
  },
  async compareSnapshot() {
    throw new Error('Snapshots are only available in workspace mode.');
  },
  async generateSnapshotEvalBaseline() {
    throw new Error('Snapshot eval is only available in workspace mode.');
  },
  async updateSnapshotPolicy() {
    throw new Error('Snapshot eval is only available in workspace mode.');
  },
  async getLibraries() {
    return readLibraries();
  },
  async saveLibraries(libraries) {
    writeLibraries(libraries);
  },
  async listProviderModels(provider) {
    const items =
      provider === 'anthropic'
        ? ['claude-3-haiku-20240307', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest']
        : provider === 'openai'
          ? ['gpt-4o-mini', 'gpt-4o', 'o1-mini']
          : ['my-azure-gpt4o-deployment'];
    return {
      provider,
      items,
      kind: provider === 'azure' ? ('deployments' as const) : ('models' as const),
      source: 'demo defaults'
    };
  },
  async getWorkspaceSettings() {
    return null;
  },
  async updateWorkspaceSettings() {
    return null;
  },
  async createScenarioAssistantSession() {
    throw new Error('Scenario Assistant is only available in workspace mode.');
  },
  async getScenarioAssistantSession() {
    throw new Error('Scenario Assistant is only available in workspace mode.');
  },
  async sendScenarioAssistantMessage() {
    throw new Error('Scenario Assistant is only available in workspace mode.');
  },
  async approveScenarioAssistantToolCall() {
    throw new Error('Scenario Assistant is only available in workspace mode.');
  },
  async denyScenarioAssistantToolCall() {
    throw new Error('Scenario Assistant is only available in workspace mode.');
  },
  async closeScenarioAssistantSession() {
    // no-op
  },
  async discoverToolsForAnalysis() {
    throw new Error('Analyze MCP Tools is only available in workspace mode.');
  },
  async startToolAnalysis() {
    throw new Error('Analyze MCP Tools is only available in workspace mode.');
  },
  subscribeToolAnalysisJob(_jobId: string, onEvent: (event: RunJobEvent) => void) {
    const timeout = window.setTimeout(() => {
      onEvent({
        type: 'error',
        ts: new Date().toISOString(),
        payload: { message: 'Analyze MCP Tools is only available in workspace mode.' }
      });
    }, 100);
    return () => window.clearTimeout(timeout);
  },
  async getToolAnalysisResult() {
    throw new Error('Analyze MCP Tools is only available in workspace mode.');
  },
  async stopToolAnalysis() {
    return { ok: true, status: 'stopped' as const };
  }
};
