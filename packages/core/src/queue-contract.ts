import type { RoverAgentRef } from './types.js';

export const ROVER_PROTOCOL_VERSION = 2 as const;
export const ROVER_CAPABILITIES = ['scenario_control', 'assignment_lease'] as const;

export const ROVER_LEASE_RELEASE_REASONS = [
  'completed',
  'error',
  'stopped',
  'connection_lost',
  'provider_unavailable',
  'provider_mismatch',
  'stale_provider',
  'bound_tab_unavailable',
  'terminal_error'
] as const;

export type RoverLeaseReleaseReason = (typeof ROVER_LEASE_RELEASE_REASONS)[number];

export const ROVER_LEASE_REQUEUE_REASONS = [
  'connection_lost',
  'provider_unavailable',
  'provider_mismatch',
  'stale_provider'
] as const satisfies readonly RoverLeaseReleaseReason[];

export const ROVER_LEASE_TERMINAL_REASONS = [
  'bound_tab_unavailable',
  'terminal_error'
] as const satisfies readonly RoverLeaseReleaseReason[];

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

export interface QueueChildProgress {
  scenarioId: string;
  agentName: string;
  completed: number;
  total: number;
  status: 'queued' | 'running' | 'completed' | 'error' | 'stopped';
  currentRunIndex?: number;
  lastDurationMs?: number;
  error?: string;
}

export function upsertQueueChildProgress(
  entries: QueueChildProgress[],
  child: QueueChildProgress
): QueueChildProgress[] {
  const index = entries.findIndex(
    (entry) => entry.scenarioId === child.scenarioId && entry.agentName === child.agentName
  );
  if (index < 0) return [...entries, child];
  const next = [...entries];
  next[index] = child;
  return next;
}

export interface McplabQueueRunParams extends QueueRunParamsBase {
  executionType: 'mcplab';
  roverAgent?: never;
  roverNewConversationBetweenScenarios?: never;
  roverNewConversationBeforeStart?: never;
}

export interface RoverQueueRunParams extends QueueRunParamsBase {
  executionType: 'rover';
  roverAgent: RoverAgentRef;
  roverNewConversationBetweenScenarios?: boolean;
  roverNewConversationBeforeStart?: boolean;
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
  childProgress?: QueueChildProgress[];
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
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'completed' | 'partial' | 'failed';
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  stoppedJobs: number;
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
