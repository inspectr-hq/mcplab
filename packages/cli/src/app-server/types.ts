export interface AppServerOptions {
  host: string;
  port: number;
  evalsDir: string;
  runsDir: string;
  snapshotsDir: string;
  toolAnalysisResultsDir: string;
  librariesDir: string;
  dev: boolean;
  open: boolean;
}

export interface AppSettings {
  workspaceRoot: string;
  evalsDir: string;
  runsDir: string;
  snapshotsDir: string;
  toolAnalysisResultsDir: string;
  librariesDir: string;
  scenarioAssistantAgentName?: string;
}

export interface DevMcpServerRuntime {
  host: string;
  port: number;
  path: string;
  targetBaseUrl: string;
  stop: () => void;
}
