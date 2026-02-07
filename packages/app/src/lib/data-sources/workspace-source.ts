import type { EvalConfig } from '@/types/eval';
import { fromCoreConfigYaml, fromCoreResultsJson, toCoreConfigYaml } from './adapters';
import { workspaceApiClient } from './workspace-api-client';
import type { EvalDataSource } from './types';

function configFileName(config: EvalConfig): string {
  if (config.sourcePath) {
    const parts = config.sourcePath.split('/');
    return parts[parts.length - 1].replace(/\.(yaml|yml)$/i, '');
  }
  return config.name || `config-${Date.now()}`;
}

export const workspaceSource: EvalDataSource = {
  async listConfigs() {
    const records = await workspaceApiClient.listConfigs();
    return records.map(fromCoreConfigYaml);
  },
  async createConfig(config) {
    const record = await workspaceApiClient.createConfig(
      configFileName(config),
      toCoreConfigYaml(config)
    );
    return fromCoreConfigYaml(record);
  },
  async updateConfig(config) {
    const record = await workspaceApiClient.updateConfig(config.id, toCoreConfigYaml(config));
    return fromCoreConfigYaml(record);
  },
  async deleteConfig(id) {
    await workspaceApiClient.deleteConfig(id);
  },
  async listResults() {
    const summaries = await workspaceApiClient.listRuns();
    const resultPromises = summaries.map(async (summary) => {
      const [{ results }, trace] = await Promise.all([
        workspaceApiClient.getRun(summary.runId),
        workspaceApiClient.getRunTrace(summary.runId)
      ]);
      return fromCoreResultsJson(results, trace.events);
    });
    return Promise.all(resultPromises);
  },
  async getResult(id) {
    try {
      const [{ results }, trace] = await Promise.all([
        workspaceApiClient.getRun(id),
        workspaceApiClient.getRunTrace(id)
      ]);
      return fromCoreResultsJson(results, trace.events);
    } catch {
      return undefined;
    }
  },
  async startRun(params) {
    return workspaceApiClient.startRun(params);
  },
  async stopRun(jobId) {
    await workspaceApiClient.stopRun(jobId);
  },
  subscribeRunJob(jobId, onEvent) {
    return workspaceApiClient.subscribeRunJob(jobId, onEvent);
  }
};
