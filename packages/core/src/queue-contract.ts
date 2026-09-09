export interface QueueRunParams {
  evaluationRunId?: string;
  evaluationId?: string;
  evaluationName?: string;
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
  evaluationRunId?: string;
  resultRunId?: string;
  roverProgress?: { completed: number; total: number; currentScenarioId?: string; lastDurationMs?: number; error?: string };
  evaluationId?: string;
  evaluationName?: string;
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
  evaluations?: EvaluationQueueItem[];
}

export interface EvaluationQueueItem {
  evaluationId: string;
  evaluationName?: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'partial' | 'failed';
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pausedJobs: number;
  resultRunId?: string;
  jobs: QueueEntry[];
}

export interface RunQueueEvent {
  type: 'queue_event' | (string & {});
  ts: string;
  payload: {
    event?: QueueResponse;
    [key: string]: unknown;
  };
}
