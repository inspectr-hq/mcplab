export interface AppServerOptions {
  host: string;
  port: number;
  configsDir: string;
  runsDir: string;
  snapshotsDir: string;
  librariesDir: string;
  dev: boolean;
  open: boolean;
}

export interface AppSettings {
  workspaceRoot: string;
  configsDir: string;
  runsDir: string;
  snapshotsDir: string;
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
