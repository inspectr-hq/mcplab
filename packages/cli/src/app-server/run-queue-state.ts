import type { ServerResponse } from 'node:http';
import type { QueueChildProgress, RoverAgentRef, Scenario } from '@inspectr/mcplab-core';
import type { SseEvent } from './jobs.js';

type RunParamsBase = {
  evaluationRunId?: string;
  evaluationName?: string;
  configPath: string;
  runsPerScenario: number;
  scenarioId?: string;
  scenarioIds?: string[];
  requestedAgents?: string[];
  runNote?: string;
  oauthServerNames?: string[];
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
};

export type McplabRunParams = RunParamsBase & {
  executionType?: 'mcplab';
  roverAgent?: never;
  roverScenarios?: never;
  roverNewConversationBetweenScenarios?: never;
};

export type RoverRunParams = RunParamsBase & {
  executionType: 'rover';
  roverAgent: RoverAgentRef;
  roverScenarios?: Scenario[];
  roverNewConversationBetweenScenarios?: boolean;
};

export type RunParams = McplabRunParams | RoverRunParams;

export type RunJobStatus =
  | 'queued'
  | 'waiting_for_rover'
  | 'paused_rover'
  | 'blocked_auth'
  | 'running'
  | 'stopped'
  | 'completed'
  | 'error';

export type RoverLeaseState = 'offered' | 'accepted' | 'running';

export interface RoverLease {
  leaseId: string;
  connectionId: string;
  state: RoverLeaseState;
  expiresAt: string;
  offeredAt: string;
  acceptedAt?: string;
  tabId?: number;
}

export type RunJob = {
  id: string;
  status: RunJobStatus;
  events: SseEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
  runParams: RunParams;
  blockedAuthServers?: string[];
  roverProgress?: {
    completed: number;
    total: number;
    currentScenarioId?: string;
    lastDurationMs?: number;
    error?: string;
  };
  childProgress?: QueueChildProgress[];
  childAbortControllers?: Map<string, AbortController>;
  roverLease?: RoverLease;
};

export interface RunQueueState {
  activeJobIds: Set<string>;
  admittingJobIds: Set<string>;
  blockedJobIds: Set<string>;
  queueWorkerCount: number;
  queue: string[];
  isAdvancingQueue: boolean;
  needsAdvanceQueue: boolean;
  clients: Set<ServerResponse>;
}

export type QueueAdvanceOptions = {
  emitWhenIdle?: boolean;
  hostHeader?: string;
  retryBlockedAuth?: boolean;
};

export type ExecutionOutcome =
  | { status: 'completed'; runId?: string }
  | { status: 'error' | 'stopped' }
  | { status: 'blocked_auth'; blockedServers: string[] };

export function createRunQueueState(queueWorkerCount = 1): RunQueueState {
  return {
    queue: [],
    activeJobIds: new Set<string>(),
    admittingJobIds: new Set<string>(),
    blockedJobIds: new Set<string>(),
    queueWorkerCount,
    isAdvancingQueue: false,
    needsAdvanceQueue: false,
    clients: new Set()
  };
}

export function currentWorkerUsage(runQueueState: RunQueueState): number {
  return (
    runQueueState.activeJobIds.size +
    runQueueState.admittingJobIds.size +
    runQueueState.blockedJobIds.size
  );
}
