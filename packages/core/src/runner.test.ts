import { describe, expect, it } from 'vitest';
import {
  buildFallbackScenarioRequestId,
  buildMcpServerAuthHeaders,
  buildScenarioRequestId,
  createRunId
} from './runner.js';

describe('buildScenarioRequestId', () => {
  it('builds deterministic IDs with run fallback suffix', () => {
    const requestId = buildScenarioRequestId({
      runId: '20260303-120509',
      scenarioId: 'batch-quality',
      agentName: 'Claude-Sonnet-46',
      runIndex: 0
    });

    expect(requestId).toBe('mcplab-run:20260303-120509:batch-quality:claude-sonnet-46:run1');
  });

  it('uses scenario_exec_id when provided', () => {
    const requestId = buildScenarioRequestId({
      runId: '20260303-120509',
      scenarioId: 'batch-quality',
      agentName: 'azure-gpt-52-chat',
      scenarioExecId: 'batch-quality-azure-gpt-52-chat',
      runIndex: 1
    });

    expect(requestId).toBe(
      'mcplab-run:20260303-120509:batch-quality:azure-gpt-52-chat:batch-quality-azure-gpt-52-chat-run2'
    );
  });

  it('sanitizes agent names and falls back for missing scenario id', () => {
    const requestId = buildScenarioRequestId({
      runId: 'run-123',
      scenarioId: undefined,
      agentName: 'Azure GPT 5.2 / Chat',
      runIndex: 2
    });

    expect(requestId).toBe('mcplab-run:run-123:unknown:azure_gpt_5_2_chat:run3');
  });

  it('clamps IDs to 180 characters', () => {
    const requestId = buildScenarioRequestId({
      runId: 'run-123',
      scenarioId: 's'.repeat(200),
      agentName: 'agent',
      scenarioExecId: 'exec',
      runIndex: 0
    });

    expect(requestId.length).toBe(180);
    expect(requestId.startsWith('mcplab-run:run-123:')).toBe(true);
    expect(requestId.endsWith('-run1')).toBe(true);
  });

  it('keeps IDs distinct across runs when scenario_exec_id is set and clamped', () => {
    const run1 = buildScenarioRequestId({
      runId: 'run-123',
      scenarioId: 's'.repeat(300),
      agentName: 'agent',
      scenarioExecId: 'exec'.repeat(80),
      runIndex: 0
    });
    const run2 = buildScenarioRequestId({
      runId: 'run-123',
      scenarioId: 's'.repeat(300),
      agentName: 'agent',
      scenarioExecId: 'exec'.repeat(80),
      runIndex: 1
    });

    expect(run1).not.toBe(run2);
    expect(run1.length).toBeLessThanOrEqual(180);
    expect(run2.length).toBeLessThanOrEqual(180);
    expect(run1.endsWith('-run1')).toBe(true);
    expect(run2.endsWith('-run2')).toBe(true);
  });
});

describe('buildMcpServerAuthHeaders', () => {
  it('returns empty object when no options provided', () => {
    expect(buildMcpServerAuthHeaders({})).toEqual({});
  });

  it('converts oauthTokens entries to Bearer authorization headers', () => {
    const result = buildMcpServerAuthHeaders({
      oauthTokens: { 'my-server': 'tok-abc' }
    });
    expect(result['my-server']).toEqual({ authorization: 'Bearer tok-abc' });
  });

  it('merges oauthTokens on top of existing mcpServerAuthHeaders', () => {
    const result = buildMcpServerAuthHeaders({
      mcpServerAuthHeaders: { 'my-server': { 'x-custom': 'val' } },
      oauthTokens: { 'my-server': 'tok-abc' }
    });
    expect(result['my-server']).toEqual({ 'x-custom': 'val', authorization: 'Bearer tok-abc' });
  });

  it('preserves mcpServerAuthHeaders servers not in oauthTokens', () => {
    const result = buildMcpServerAuthHeaders({
      mcpServerAuthHeaders: { 'other-server': { authorization: 'Bearer existing' } },
      oauthTokens: { 'my-server': 'tok-abc' }
    });
    expect(result['other-server']).toEqual({ authorization: 'Bearer existing' });
    expect(result['my-server']).toEqual({ authorization: 'Bearer tok-abc' });
  });
});

describe('buildFallbackScenarioRequestId', () => {
  it('clamps fallback IDs to 180 characters', () => {
    const requestId = buildFallbackScenarioRequestId({
      runId: 'run-123',
      runIndex: 0,
      scenarioAgent: `agent-${'x'.repeat(400)}`
    });

    expect(requestId.length).toBeLessThanOrEqual(180);
    expect(requestId.startsWith('mcplab-run:run-123:unknown:')).toBe(true);
    expect(requestId.endsWith(':run1')).toBe(true);
  });
});

describe('createRunId', () => {
  it('keeps the timestamp-readable prefix while including milliseconds', () => {
    const runId = createRunId(new Date(2026, 5, 3, 12, 34, 56, 789));
    expect(runId).toBe('20260603-123456-789');
  });

  it('keeps ids distinct across rapid successive calls', () => {
    const first = createRunId(new Date(2026, 5, 3, 12, 34, 56, 789));
    const second = createRunId(new Date(2026, 5, 3, 12, 34, 56, 790));
    expect(first).not.toBe(second);
  });
});
