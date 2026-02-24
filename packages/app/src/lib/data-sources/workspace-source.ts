import type { EvalConfig } from '@/types/eval';
import {
  fromCoreConfigYaml,
  fromCoreLibraries,
  fromCoreResultsJson,
  toCoreConfigYaml,
  toCoreLibraries
} from './adapters';
import { workspaceApiClient } from './workspace-api-client';
import type { EvalDataSource } from './types';

function configFileName(config: EvalConfig): string {
  if (config.sourcePath) {
    const parts = config.sourcePath.split('/');
    return parts[parts.length - 1].replace(/\.(yaml|yml)$/i, '');
  }
  return config.name || `config-${Date.now()}`;
}

function configFileNameFromName(name: string): string {
  return name || `config-${Date.now()}`;
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
    const record = await workspaceApiClient.updateConfig(
      config.id,
      toCoreConfigYaml(config),
      configFileNameFromName(config.name)
    );
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
      return fromCoreResultsJson(results, trace.records);
    });
    return Promise.all(resultPromises);
  },
  async getResult(id) {
    try {
      const [{ results }, trace] = await Promise.all([
        workspaceApiClient.getRun(id),
        workspaceApiClient.getRunTrace(id)
      ]);
      return fromCoreResultsJson(results, trace.records);
    } catch {
      return undefined;
    }
  },
  async deleteResult(id) {
    await workspaceApiClient.deleteRun(id);
  },
  async listMarkdownReports() {
    return workspaceApiClient.listMarkdownReports();
  },
  async getMarkdownReport(relativePath) {
    return workspaceApiClient.getMarkdownReport(relativePath);
  },
  async startRun(params) {
    return workspaceApiClient.startRun(params);
  },
  async stopRun(jobId) {
    await workspaceApiClient.stopRun(jobId);
  },
  subscribeRunJob(jobId, onEvent) {
    return workspaceApiClient.subscribeRunJob(jobId, onEvent);
  },
  async listSnapshots() {
    return workspaceApiClient.listSnapshots();
  },
  async createSnapshotFromRun(runId, name) {
    return workspaceApiClient.createSnapshotFromRun(runId, name);
  },
  async getSnapshot(id) {
    try {
      return await workspaceApiClient.getSnapshot(id);
    } catch {
      return undefined;
    }
  },
  async compareSnapshot(snapshotId, runId) {
    return workspaceApiClient.compareSnapshot(snapshotId, runId);
  },
  async askResultAssistant(runId, messages) {
    return workspaceApiClient.askResultAssistant(runId, messages);
  },
  async applyResultAssistantReport(params) {
    return workspaceApiClient.applyResultAssistantReport(params);
  },
  async createResultAssistantSession(runId) {
    return workspaceApiClient.createResultAssistantSession(runId);
  },
  async getResultAssistantSession(sessionId) {
    return workspaceApiClient.getResultAssistantSession(sessionId);
  },
  async sendResultAssistantMessage(sessionId, message) {
    return workspaceApiClient.sendResultAssistantMessage(sessionId, message);
  },
  async approveResultAssistantToolCall(sessionId, callId, argumentsOverride) {
    return workspaceApiClient.approveResultAssistantToolCall(sessionId, callId, argumentsOverride);
  },
  async denyResultAssistantToolCall(sessionId, callId) {
    return workspaceApiClient.denyResultAssistantToolCall(sessionId, callId);
  },
  async closeResultAssistantSession(sessionId) {
    await workspaceApiClient.closeResultAssistantSession(sessionId);
  },
  async generateSnapshotEvalBaseline(runId, configId, name) {
    const response = await workspaceApiClient.generateSnapshotEvalBaseline(runId, configId, name);
    return {
      snapshot: response.snapshot,
      config: fromCoreConfigYaml(response.config)
    };
  },
  async updateSnapshotPolicy(configId, policy) {
    const record = await workspaceApiClient.updateSnapshotPolicy(configId, policy);
    return fromCoreConfigYaml(record);
  },
  async getLibraries() {
    const libraries = await workspaceApiClient.getLibraries();
    return fromCoreLibraries(libraries);
  },
  async saveLibraries(libraries) {
    await workspaceApiClient.saveLibraries(toCoreLibraries(libraries));
  },
  async listProviderModels(provider) {
    return workspaceApiClient.listProviderModels(provider);
  },
  async getWorkspaceSettings() {
    return workspaceApiClient.getSettings();
  },
  async updateWorkspaceSettings(patch) {
    return workspaceApiClient.updateSettings(patch);
  },
  async createScenarioAssistantSession(params) {
    return workspaceApiClient.createScenarioAssistantSession(params);
  },
  async getScenarioAssistantSession(sessionId) {
    return workspaceApiClient.getScenarioAssistantSession(sessionId);
  },
  async sendScenarioAssistantMessage(sessionId, message) {
    return workspaceApiClient.sendScenarioAssistantMessage(sessionId, message);
  },
  async approveScenarioAssistantToolCall(sessionId, callId) {
    return workspaceApiClient.approveScenarioAssistantToolCall(sessionId, callId);
  },
  async denyScenarioAssistantToolCall(sessionId, callId) {
    return workspaceApiClient.denyScenarioAssistantToolCall(sessionId, callId);
  },
  async closeScenarioAssistantSession(sessionId) {
    await workspaceApiClient.closeScenarioAssistantSession(sessionId);
  },
  async discoverToolsForAnalysis(params) {
    return workspaceApiClient.discoverToolsForAnalysis(params);
  },
  async startToolAnalysis(params) {
    return workspaceApiClient.startToolAnalysis(params);
  },
  subscribeToolAnalysisJob(jobId, onEvent) {
    return workspaceApiClient.subscribeToolAnalysisJob(jobId, onEvent);
  },
  async getToolAnalysisResult(jobId) {
    return workspaceApiClient.getToolAnalysisResult(jobId);
  },
  async stopToolAnalysis(jobId) {
    return workspaceApiClient.stopToolAnalysis(jobId);
  },
  async listToolAnalysisResults() {
    return workspaceApiClient.listToolAnalysisResults();
  },
  async getToolAnalysisSavedResult(id) {
    return workspaceApiClient.getToolAnalysisSavedResult(id);
  },
  async deleteToolAnalysisSavedResult(id) {
    await workspaceApiClient.deleteToolAnalysisSavedResult(id);
  },
  async createOAuthDebuggerSession(config) {
    return workspaceApiClient.createOAuthDebuggerSession(config);
  },
  async getOAuthDebuggerSession(sessionId) {
    return workspaceApiClient.getOAuthDebuggerSession(sessionId);
  },
  async startOAuthDebuggerSession(sessionId) {
    return workspaceApiClient.startOAuthDebuggerSession(sessionId);
  },
  subscribeOAuthDebuggerSession(sessionId, onEvent) {
    return workspaceApiClient.subscribeOAuthDebuggerSession(sessionId, onEvent);
  },
  async submitOAuthDebuggerManualCallback(sessionId, payload) {
    return workspaceApiClient.submitOAuthDebuggerManualCallback(sessionId, payload);
  },
  async stopOAuthDebuggerSession(sessionId) {
    return workspaceApiClient.stopOAuthDebuggerSession(sessionId);
  },
  async exportOAuthDebuggerSession(sessionId, format) {
    return workspaceApiClient.exportOAuthDebuggerSession(sessionId, format);
  }
};
