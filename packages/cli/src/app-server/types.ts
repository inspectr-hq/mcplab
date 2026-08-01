import type { HealthMcpConnectionInfo } from '@inspectr/mcplab-core';

export type { HealthMcpConnectionInfo };

export interface AppServerOptions {
  host: string;
  port: number;
  evalsDir: string;
  runsDir: string;
  toolAnalysisResultsDir: string;
  librariesDir: string;
  dev: boolean;
  open: boolean;
}

export interface AppSettings {
  workspaceRoot: string;
  evalsDir: string;
  runsDir: string;
  toolAnalysisResultsDir: string;
  librariesDir: string;
  defaultQueueWorkers: number;
  scenarioAssistantAgentName?: string;
  globalCopilotAgentName?: string;
  evaluationJudgeAgentName?: string;
}

// Source of truth: packages/core/src/types.ts HealthMcpConnectionInfo
export interface HealthResponse {
  ok: boolean;
  version: string;
  mcp: HealthMcpConnectionInfo;
}

export interface DevMcpServerRuntime {
  host: string;
  port: number;
  path: string;
  targetBaseUrl: string;
  stop: () => void;
}
