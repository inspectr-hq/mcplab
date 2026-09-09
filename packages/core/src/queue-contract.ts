import type { RoverAgentRef } from './types.js';

interface QueueRunParamsBase {
  evaluationRunId?: string;
  evaluationName?: string;
  configPath: string;
  runsPerScenario: number;
  scenarioIds: string[] | null;
  agents: string[] | null;
  runNote: string | null;
  serverOverrideAll: string[] | null;
  scenarioServerOverrides: Record<string, string[]> | null;
}

export interface McplabQueueRunParams extends QueueRunParamsBase {
  executionType: 'mcplab';
  roverAgent?: never;
  roverNewConversationBetweenScenarios?: never;
}

export interface RoverQueueRunParams extends QueueRunParamsBase {
  executionType: 'rover';
  roverAgent: RoverAgentRef;
  roverNewConversationBetweenScenarios?: boolean;
}

export type QueueRunParams = McplabQueueRunParams | RoverQueueRunParams;

interface QueueEntryBase {
  jobId: string;
  evaluationRunId?: string;
  roverProgress?: {
    completed: number;
    total: number;
    currentScenarioId?: string;
    lastDurationMs?: number;
    error?: string;
  };
  evaluationName?: string;
  status:
    | 'queued'
    | 'waiting_for_rover'
    | 'paused_rover'
    | 'blocked_auth'
    | 'running'
    | 'completed'
    | 'error'
    | 'stopped';
  blockedReason?: 'oauth_required' | 'rover_required' | 'rover_interrupted';
  requiredServers?: string[];
}

export type QueueEntry =
  | (QueueEntryBase & {
      executionType: 'mcplab';
      roverAgent?: never;
      runParams: McplabQueueRunParams;
    })
  | (QueueEntryBase & {
      executionType: 'rover';
      roverAgent: RoverQueueRunParams['roverAgent'];
      runParams: RoverQueueRunParams;
    });

export interface QueueResponse {
  active: QueueEntry | null;
  active_jobs: QueueEntry[];
  admitting_jobs: QueueEntry[];
  queued: QueueEntry[];
  evaluations?: EvaluationQueueItem[];
}

export interface EvaluationQueueItem {
  evaluationRunId: string;
  evaluationName?: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'partial' | 'failed';
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pausedJobs: number;
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
