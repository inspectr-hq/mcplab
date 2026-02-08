import { mockConfigs, mockResults } from '@/data/mock-data';
import type { EvalConfig, EvalResult } from '@/types/eval';
import type { EvalDataSource, RunJobEvent } from './types';

const STORAGE_KEY = 'mcp-eval-configs';

function readConfigs(): EvalConfig[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? (JSON.parse(stored) as EvalConfig[]) : mockConfigs;
}

function writeConfigs(configs: EvalConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
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
  }
};
