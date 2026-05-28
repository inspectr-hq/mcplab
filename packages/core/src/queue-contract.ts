export interface QueueRunParams {
  configPath: string;
  runsPerScenario: number;
  scenarioIds: string[] | null;
  agents: string[] | null;
  runNote: string | null;
  serverOverrideAll: string[] | null;
  scenarioServerOverrides: Record<string, string[]> | null;
}

export interface QueueEntry {
  jobId: string;
  status: 'queued' | 'blocked_auth' | 'running' | 'completed' | 'error' | 'stopped';
  blockedReason?: 'oauth_required';
  requiredServers?: string[];
  runParams: QueueRunParams;
}

export interface QueueResponse {
  active: QueueEntry | null;
  queued: QueueEntry[];
}

export interface RunQueueEvent {
  type: 'queue_event' | (string & {});
  ts: string;
  payload: {
    event?: QueueResponse;
    [key: string]: unknown;
  };
}
