import type { ServerResponse } from 'node:http';
import type { Scenario } from '@inspectr/mcplab-core';
import type { SseEvent } from './jobs.js';

export type RunParams = {
  evaluationGroupId?: string;
  configPath: string;
  runsPerScenario: number;
  scenarioId?: string;
  scenarioIds?: string[];
  requestedAgents?: string[];
  runNote?: string;
  oauthServerNames?: string[];
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
  executionType?: 'mcplab' | 'rover';
  roverAgent?: { name: string; provider: 'claude' | 'trendminer'; url: string };
  roverScenarios?: Scenario[];
  roverNewConversationBetweenScenarios?: boolean;
};

export type RunJobStatus =
  | 'queued'
  | 'waiting_for_rover'
  | 'paused_rover'
  | 'blocked_auth'
  | 'running'
  | 'stopped'
  | 'completed'
  | 'error';

export type RunJob = {
  id: string;
  status: RunJobStatus;
  events: SseEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
  runParams: RunParams;
  blockedAuthServers?: string[];
  resultRunId?: string;
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
