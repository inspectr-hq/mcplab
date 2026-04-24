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

export type HealthMcpConnectionInfo =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      transport: 'streamable-http';
      host: string;
      port: number;
      path: string;
      proxyUrl: string;
      directUrl: string;
      serverPackageVersion: string;
      environment: {
        MCP_HOST: string;
        MCP_PORT: string;
        MCP_PATH: string;
      };
    };

// Mirror: packages/app/src/lib/data-sources/types.ts WorkspaceHealthResponse (app-side superset with extra mcp fields)
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
