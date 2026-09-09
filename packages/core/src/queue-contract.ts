export interface QueueRunParams {
  configPath: string;
  runsPerScenario: number;
  scenarioIds: string[] | null;
  agents: string[] | null;
  runNote: string | null;
  serverOverrideAll: string[] | null;
  scenarioServerOverrides: Record<string, string[]> | null;
  executionType?: 'mcplab' | 'rover';
  roverAgent?: { name: string; provider: 'claude' | 'trendminer'; url: string };
  roverNewConversationBetweenScenarios?: boolean;
}

export interface QueueEntry {
  jobId: string;
  status: 'queued' | 'waiting_for_rover' | 'paused_rover' | 'blocked_auth' | 'running' | 'completed' | 'error' | 'stopped';
  blockedReason?: 'oauth_required' | 'rover_required' | 'rover_interrupted';
  executionType?: 'mcplab' | 'rover';
  roverAgent?: { name: string; provider: 'claude' | 'trendminer'; url: string };
  requiredServers?: string[];
  runParams: QueueRunParams;
}

export interface QueueResponse {
  active: QueueEntry | null;
  active_jobs: QueueEntry[];
  admitting_jobs: QueueEntry[];
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
