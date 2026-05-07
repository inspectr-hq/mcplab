import type { EvalConfig } from '@/types/eval';
import {
  fromCoreConfigYaml,
  fromCoreLibraries,
  fromCoreResultsJson,
  fromCoreScenarioRunPreview,
  toCoreConfigYaml,
  toCoreLibraries
} from './adapters';
import { workspaceApiClient } from './workspace-api-client';
import type { EvalDataSource, LibraryBundle } from './types';

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
  async health() {
    return workspaceApiClient.health();
  },
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
  async updateRunNote(runId, runNote) {
    await workspaceApiClient.updateRunNote(runId, runNote);
  },
  async listMarkdownReports() {
    return workspaceApiClient.listMarkdownReports();
  },
  async getMarkdownReport(relativePath) {
    return workspaceApiClient.getMarkdownReport(relativePath);
  },
  async deleteMarkdownReport(relativePath) {
    await workspaceApiClient.deleteMarkdownReport(relativePath);
  },
  async startRun(params) {
    return workspaceApiClient.startRun(params);
  },
  async runScenarioPreview(params) {
    const response = await workspaceApiClient.runScenarioPreview(params);
    const run = response.scenario.run;
    if (!run) {
      throw new Error('Preview run did not return a run result');
    }
    return {
      runId: response.runId,
      scenarioId: response.scenario.scenarioId,
      agentName: response.scenario.agent,
      run: fromCoreScenarioRunPreview(run, response.scenario.traceRecord)
    };
  },
  async stopRun(jobId) {
    await workspaceApiClient.stopRun(jobId);
  },
  async getRunQueue() {
    return workspaceApiClient.getRunQueue();
  },
  async removeQueuedRun(jobId) {
    await workspaceApiClient.removeQueuedRun(jobId);
  },
  async resumeQueue() {
    return workspaceApiClient.resumeQueue();
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
  async applyResultAssistantReport(params) {
    return workspaceApiClient.applyResultAssistantReport(params);
  },
  async createResultAssistantSession(params, signal) {
    return workspaceApiClient.createResultAssistantSession(params, signal);
  },
  async getResultAssistantSession(sessionId) {
    return workspaceApiClient.getResultAssistantSession(sessionId);
  },
  async sendResultAssistantMessage(sessionId, message, signal) {
    return workspaceApiClient.sendResultAssistantMessage(sessionId, message, signal);
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
  subscribeResultAssistantSessionEvents(sessionId, onEvent) {
    return workspaceApiClient.subscribeResultAssistantSessionEvents(sessionId, onEvent);
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
  async getLibraries(): Promise<LibraryBundle> {
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
  async createScenarioAssistantSession(params, signal) {
    return workspaceApiClient.createScenarioAssistantSession(params, signal);
  },
  async getScenarioAssistantSession(sessionId) {
    return workspaceApiClient.getScenarioAssistantSession(sessionId);
  },
  async sendScenarioAssistantMessage(sessionId, message, signal) {
    return workspaceApiClient.sendScenarioAssistantMessage(sessionId, message, signal);
  },
  async approveScenarioAssistantToolCall(sessionId, callId) {
    return workspaceApiClient.approveScenarioAssistantToolCall(sessionId, callId);
  },
  async denyScenarioAssistantToolCall(sessionId, callId) {
    return workspaceApiClient.denyScenarioAssistantToolCall(sessionId, callId);
  },
  async approveAllScenarioAssistantToolCalls(sessionId) {
    return workspaceApiClient.approveAllScenarioAssistantToolCalls(sessionId);
  },
  async closeScenarioAssistantSession(sessionId) {
    await workspaceApiClient.closeScenarioAssistantSession(sessionId);
  },
  subscribeScenarioAssistantSessionEvents(sessionId, onEvent) {
    return workspaceApiClient.subscribeScenarioAssistantSessionEvents(sessionId, onEvent);
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
  },
  async createOAuthRuntimeSession(params) {
    return workspaceApiClient.createOAuthRuntimeSession(params);
  },
  async getOAuthRuntimeSession(sessionId) {
    return workspaceApiClient.getOAuthRuntimeSession(sessionId);
  },
  async getOAuthRuntimeSessionToken(sessionId) {
    return workspaceApiClient.getOAuthRuntimeSessionToken(sessionId);
  },
  async submitOAuthRuntimeCallback(sessionId, payload) {
    return workspaceApiClient.submitOAuthRuntimeCallback(sessionId, payload);
  },
  async cancelOAuthRuntimeSession(sessionId) {
    return workspaceApiClient.cancelOAuthRuntimeSession(sessionId);
  },
  async ensureOAuthServers(params) {
    return workspaceApiClient.ensureOAuthServers(params);
  }
};
