import { describe, expect, it } from 'vitest';
import { buildScenarioRequestId } from './runner.js';

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
      'mcplab-run:20260303-120509:batch-quality:azure-gpt-52-chat:batch-quality-azure-gpt-52-chat'
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
  });
});
