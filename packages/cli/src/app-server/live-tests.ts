import { join } from 'node:path';
import {
  aggregateResults,
  createRunId,
  evaluateScenarioObservation,
  hashConfig,
  judgeAgentAssertions,
  tallyCheckCounts,
  type AgentConfig,
  type EvalConfig,
  type RunOutcome,
  type Scenario,
  type ScenarioRunTraceRecord
} from '@inspectr/mcplab-core';
import type { PersistEvaluationArtifactsParams } from '@inspectr/mcplab-core';
import { appendExecutionEvent } from './execution-journal.js';
import { recordEvaluationExecution } from './evaluation-journal-writer.js';

export interface LiveTestCatalogItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  assertionCount: number;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface LiveTestCompletion {
  runId: string;
  outcome: RunOutcome;
  checkCounts: ReturnType<typeof tallyCheckCounts>;
  resultUrl: string;
}

export interface LiveTestSession {
  id: string;
  testCase: Scenario;
  client: string;
  status: 'ready' | 'completed' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  evaluationRunId?: string;
  configPath?: string;
  configName?: string;
  agentName?: string;
  completionInput?: CompleteLiveTestInput;
  completion?: LiveTestCompletion;
}

export interface CompleteLiveTestInput {
  finalText: string;
  startedAt: string;
  completedAt: string;
}

export class LiveTestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function countAssertions(scenario: Scenario): number {
  const rules = scenario.eval;
  if (!rules) return 0;
  return (
    (rules.tool_constraints?.required_tools?.length ?? 0) +
    (rules.tool_constraints?.forbidden_tools?.length ?? 0) +
    (rules.tool_sequence?.length ? 1 : 0) +
    (rules.tool_input_assertions?.length ?? 0) +
    (rules.response_assertions?.length ?? 0) +
    (rules.agent_assertions?.length ?? 0)
  );
}

export function listLiveTestCases(scenarios: Scenario[]): LiveTestCatalogItem[] {
  return scenarios.map((scenario) => {
    const source = scenario as Scenario & { description?: unknown; tags?: unknown };
    const hasAttachments = (scenario.attachments?.length ?? 0) > 0;
    return {
      id: scenario.id,
      name: scenario.name?.trim() || scenario.id,
      ...(typeof source.description === 'string' && source.description.trim()
        ? { description: source.description.trim() }
        : {}),
      ...(Array.isArray(source.tags)
        ? {
            tags: source.tags
              .map(String)
              .map((tag) => tag.trim())
              .filter(Boolean)
          }
        : {}),
      assertionCount: countAssertions(scenario),
      eligible: !hasAttachments,
      ...(hasAttachments ? { ineligibleReason: 'Attachments are not supported by Rover yet.' } : {})
    };
  });
}

export interface LiveTestServiceOptions {
  runsDir: string;
  cliVersion: string;
  readScenarios: () => Scenario[];
  persist: (params: PersistEvaluationArtifactsParams) => void;
  getEvaluationJudge?: () => { name: string; agent: AgentConfig } | undefined;
  ttlMs?: number;
  now?: () => Date;
  appendJournalEvent?: typeof appendExecutionEvent;
}

export class LiveTestService {
  private readonly sessions = new Map<string, LiveTestSession>();
  private readonly completionsInFlight = new Map<
    string,
    { inputKey: string; promise: Promise<LiveTestCompletion> }
  >();

  constructor(private readonly options: LiveTestServiceOptions) {}

  list(): LiveTestCatalogItem[] {
    this.cleanup();
    return listLiveTestCases(this.options.readScenarios());
  }

  start(input: {
    testCaseId: string;
    client: string;
    evaluationRunId?: string;
    configPath?: string;
    configName?: string;
    agentName?: string;
  }): LiveTestSession {
    this.cleanup();
    const scenario = this.options
      .readScenarios()
      .find((candidate) => candidate.id === input.testCaseId);
    if (!scenario) throw new LiveTestError(`Test case not found: ${input.testCaseId}`, 404);
    if (scenario.attachments?.length) {
      throw new LiveTestError('Attachments are not supported by Rover yet.', 400);
    }
    const now = this.now();
    const session: LiveTestSession = {
      id: crypto.randomUUID(),
      testCase: structuredClone(scenario),
      client: input.client.trim() || 'unknown',
      status: 'ready',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (this.options.ttlMs ?? 30 * 60_000)).toISOString(),
      evaluationRunId: input.evaluationRunId,
      ...(input.configPath?.trim() ? { configPath: input.configPath.trim() } : {}),
      ...(input.configName?.trim() ? { configName: input.configName.trim() } : {}),
      ...(input.agentName?.trim() ? { agentName: input.agentName.trim() } : {})
    };
    this.sessions.set(session.id, session);
    return structuredClone(session);
  }

  get(id: string): LiveTestSession {
    this.cleanup();
    const session = this.sessions.get(id);
    if (!session) throw new LiveTestError('Live Test session not found or expired.', 404);
    return structuredClone(session);
  }

  cancel(id: string): LiveTestSession {
    const session = this.requireSession(id);
    if (session.status === 'completed')
      throw new LiveTestError('Completed Live Tests cannot be cancelled.', 409);
    session.status = 'cancelled';
    return structuredClone(session);
  }

  complete(id: string, input: CompleteLiveTestInput): Promise<LiveTestCompletion> {
    const inputKey = JSON.stringify({
      finalText: String(input.finalText ?? '').trim(),
      startedAt: input.startedAt,
      completedAt: input.completedAt
    });
    const existing = this.completionsInFlight.get(id);
    if (existing) {
      if (existing.inputKey === inputKey) return existing.promise;
      return Promise.reject(
        new LiveTestError('Live Test session is completing with different data.', 409)
      );
    }
    const promise = this.completeInternal(id, input).finally(() => {
      if (this.completionsInFlight.get(id)?.promise === promise)
        this.completionsInFlight.delete(id);
    });
    this.completionsInFlight.set(id, { inputKey, promise });
    return promise;
  }

  private async completeInternal(
    id: string,
    input: CompleteLiveTestInput
  ): Promise<LiveTestCompletion> {
    const session = this.requireSession(id);
    const normalized: CompleteLiveTestInput = {
      finalText: input.finalText.trim(),
      startedAt: input.startedAt,
      completedAt: input.completedAt
    };
    if (!normalized.finalText) throw new LiveTestError('finalText is required.', 400);
    const startedAtMs = Date.parse(normalized.startedAt);
    const completedAtMs = Date.parse(normalized.completedAt);
    if (
      !Number.isFinite(startedAtMs) ||
      !Number.isFinite(completedAtMs) ||
      completedAtMs < startedAtMs
    ) {
      throw new LiveTestError('Valid startedAt and completedAt timestamps are required.', 400);
    }
    if (session.status === 'cancelled') {
      throw new LiveTestError('Live Test session was cancelled.', 409);
    }
    if (session.completion) {
      if (JSON.stringify(session.completionInput) === JSON.stringify(normalized))
        return session.completion;
      throw new LiveTestError('Live Test session was already completed with different data.', 409);
    }

    const judge = this.options.getEvaluationJudge?.();
    if (session.testCase.eval?.agent_assertions?.length && !judge) {
      throw new LiveTestError('Agent checks require a configured evaluation judge.', 400);
    }
    const requestId = `rover:${session.id}`;
    const run = await evaluateScenarioObservation({
      scenario: session.testCase,
      observation: {
        finalText: normalized.finalText,
        startedAt: normalized.startedAt,
        completedAt: normalized.completedAt,
        requestId,
        executionSource: 'rover',
        client: session.client
      },
      judgeAgentAssertions: judge
        ? async (judgeInput) =>
            judgeAgentAssertions({
              assertions: judgeInput.assertions,
              context: judgeInput.context,
              finalText: normalized.finalText,
              judge
            })
        : undefined
    });
    const now = this.now();
    const runId = `${createRunId(now)}-rover-${session.id.slice(0, 8)}`;
    const config: EvalConfig = {
      name: `Rover Live Test: ${session.testCase.name ?? session.testCase.id}`,
      servers: {},
      agents: {},
      scenarios: [session.testCase]
    };
    const results = aggregateResults({
      runId,
      timestamp: now.toISOString(),
      configHash: hashConfig(config),
      cliVersion: this.options.cliVersion,
      executionSource: 'rover',
      executionClient: session.client,
      scenarioRuns: [
        {
          scenario_id: session.testCase.id,
          scenario_name: session.testCase.name,
          agent: session.agentName ?? 'rover',
          provider: session.client,
          model: 'external',
          eval: session.testCase.eval,
          runs: [run]
        }
      ]
    });
    results.metadata.evaluation_run_id = session.evaluationRunId;
    if (session.configPath) results.metadata.config_path = session.configPath;
    if (session.configName) results.metadata.config_name = session.configName;
    if (session.agentName) results.metadata.rerun_agents = [session.agentName];
    results.metadata.rerun_scenario_ids = [session.testCase.id];
    const traceRecord: ScenarioRunTraceRecord = {
      type: 'scenario_run',
      trace_version: 3,
      run_index: 0,
      request_id: requestId,
      scenario_id: session.testCase.id,
      agent: session.agentName ?? 'rover',
      provider: session.client,
      model: 'external',
      ts_start: normalized.startedAt,
      ts_end: normalized.completedAt,
      pass: run.pass,
      outcome: run.outcome,
      messages: [
        { role: 'user', content: [{ type: 'text', text: session.testCase.prompt }] },
        { role: 'assistant', content: [{ type: 'text', text: normalized.finalText }] }
      ],
      metrics: { tool_call_count: 0, total_tool_duration_ms: 0 }
    };
    if (!session.evaluationRunId) {
      this.options.persist({
        runDir: join(this.options.runsDir, runId),
        results,
        resolvedConfig: config,
        traceRecords: [
          { type: 'trace_meta', trace_version: 3, run_id: runId, ts: now.toISOString() },
          traceRecord
        ]
      });
    }
    if (session.evaluationRunId) {
      recordEvaluationExecution({
        runsDir: this.options.runsDir,
        evaluationRunId: session.evaluationRunId,
        evaluationName:
          session.configName ?? `Rover Live Test: ${session.testCase.name ?? session.testCase.id}`,
        executionId: runId,
        executionSource: 'rover',
        results,
        traceRecords: [traceRecord],
        eventId: `rover-result-${runId}`,
        appendEvent: this.options.appendJournalEvent
      });
    }
    const completion: LiveTestCompletion = {
      runId,
      outcome: run.outcome ?? 'failed',
      checkCounts: tallyCheckCounts(run.check_results ?? []),
      resultUrl: `/results/${encodeURIComponent(session.evaluationRunId ?? runId)}`
    };
    session.status = 'completed';
    session.completionInput = normalized;
    session.completion = completion;
    return completion;
  }

  private requireSession(id: string): LiveTestSession {
    this.cleanup();
    const session = this.sessions.get(id);
    if (!session) throw new LiveTestError('Live Test session not found or expired.', 404);
    return session;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private cleanup(): void {
    const now = this.now().getTime();
    for (const [id, session] of this.sessions) {
      if (Date.parse(session.expiresAt) <= now && session.status === 'ready')
        this.sessions.delete(id);
    }
  }
}
