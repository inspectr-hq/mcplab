import { describe, expect, it } from 'vitest';
import {
  buildFallbackScenarioRequestId,
  buildJudgeBatchPayload,
  buildMcpServerAuthHeaders,
  filterScenariosForRun,
  mapJudgeBatchResults,
  buildScenarioRequestId,
  createRunId,
  extractJudgeJson
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

describe('extractJudgeJson', () => {
  it('extracts JSON from fenced blocks with preamble text', () => {
    const raw = 'Sure! Here is my evaluation:\n```json\n{"pass":true,"reason":"ok"}\n```';
    expect(extractJudgeJson(raw)).toBe('{"pass":true,"reason":"ok"}');
  });

  it('falls back to the first object-shaped payload in plain text', () => {
    const raw = 'Result follows: {"pass":false,"reason":"bad"} Thanks.';
    expect(extractJudgeJson(raw)).toBe('{"pass":false,"reason":"bad"}');
  });

  it('extracts only first complete object when multiple JSON objects exist', () => {
    const raw = '{"pass":true,"reason":"ok"} Evaluation complete. {"summary":"done"}';
    expect(extractJudgeJson(raw)).toBe('{"pass":true,"reason":"ok"}');
  });
});

describe('filterScenariosForRun', () => {
  it('limits run to selected scenario id', () => {
    expect(
      filterScenariosForRun(
        [
          { id: 'with-checks', eval: { agent_assertions: [{ label: 'x', prompt: 'y' }] } } as any,
          { id: 'without-checks' } as any
        ],
        'without-checks'
      ).map((scenario) => scenario.id)
    ).toEqual(['without-checks']);
  });
});

describe('buildJudgeBatchPayload', () => {
  it('builds stable ordered check ids for a batched judge request', () => {
    expect(
      buildJudgeBatchPayload('Final answer text', [
        { label: 'Logical range', prompt: 'Confirm there is a logical range.' },
        { label: 'Logical range', prompt: 'Confirm the range is chronological.' }
      ])
    ).toEqual({
      final_answer: 'Final answer text',
      checks: [
        {
          id: 'agent-check-1',
          label: 'Logical range',
          prompt: 'Confirm there is a logical range.'
        },
        {
          id: 'agent-check-2',
          label: 'Logical range',
          prompt: 'Confirm the range is chronological.'
        }
      ]
    });
  });

  it('omits context field when no context provided', () => {
    const payload = buildJudgeBatchPayload('answer', [
      { label: 'Check', prompt: 'Verify something.' }
    ]);
    expect(payload).not.toHaveProperty('context');
  });

  it('includes context.scenario_prompt when provided', () => {
    const payload = buildJudgeBatchPayload(
      'answer',
      [{ label: 'Check', prompt: 'Verify something.' }],
      { scenario_prompt: 'What is the tag profile?' }
    );
    expect(payload.context).toEqual({ scenario_prompt: 'What is the tag profile?' });
  });

  it('includes context.tool_sequence when provided', () => {
    const payload = buildJudgeBatchPayload(
      'answer',
      [{ label: 'Check', prompt: 'Verify something.' }],
      { tool_sequence: ['get_tag_profile', 'search_tags'] }
    );
    expect(payload.context).toEqual({ tool_sequence: ['get_tag_profile', 'search_tags'] });
  });

  it('includes all context fields when provided', () => {
    const payload = buildJudgeBatchPayload(
      'answer',
      [{ label: 'Check', prompt: 'Verify something.' }],
      {
        scenario_prompt: 'What is the tag profile?',
        tool_sequence: ['get_tag_profile'],
        tool_inputs: [{ tool: 'get_tag_profile', arguments: { tag: 'TM5-BP2' } }]
      }
    );
    expect(payload.context).toEqual({
      scenario_prompt: 'What is the tag profile?',
      tool_sequence: ['get_tag_profile'],
      tool_inputs: [{ tool: 'get_tag_profile', arguments: { tag: 'TM5-BP2' } }]
    });
  });

  it('omits context field when empty context object provided', () => {
    const payload = buildJudgeBatchPayload(
      'answer',
      [{ label: 'Check', prompt: 'Verify something.' }],
      {}
    );
    expect(payload).not.toHaveProperty('context');
  });
});

describe('mapJudgeBatchResults', () => {
  it('maps results by id and preserves per-check metadata', () => {
    const payload = buildJudgeBatchPayload('Final answer text', [
      { label: 'Logical range', prompt: 'Confirm there is a logical range.' },
      { label: 'Mentions source', prompt: 'Confirm the answer mentions its source.' }
    ]);

    expect(
      mapJudgeBatchResults({
        judgeName: 'critic',
        judgeAgent: { provider: 'openai', model: 'gpt-4o-mini' } as any,
        batch: payload,
        raw: JSON.stringify({
          results: [
            {
              id: 'agent-check-2',
              label: 'Mentions source',
              pass: false,
              reason: 'The answer does not mention the source.'
            },
            {
              id: 'agent-check-1',
              label: 'Unexpected duplicate label',
              pass: true,
              reason: 'Range present and logical.'
            },
            {
              id: 'unknown-check',
              label: 'Ignore me',
              pass: true,
              reason: 'unused'
            }
          ]
        })
      })
    ).toEqual([
      {
        label: 'Logical range',
        pass: true,
        reason: 'Range present and logical.',
        metadata: {
          check_id: 'agent-check-1',
          judge_agent: 'critic',
          judge_model: 'gpt-4o-mini',
          judge_provider: 'openai'
        }
      },
      {
        label: 'Mentions source',
        pass: false,
        reason: 'The answer does not mention the source.',
        metadata: {
          check_id: 'agent-check-2',
          judge_agent: 'critic',
          judge_model: 'gpt-4o-mini',
          judge_provider: 'openai'
        }
      }
    ]);
  });

  it('fails only missing known ids', () => {
    const payload = buildJudgeBatchPayload('Final answer text', [
      { label: 'Logical range', prompt: 'Confirm there is a logical range.' },
      { label: 'Mentions source', prompt: 'Confirm the answer mentions its source.' }
    ]);

    expect(
      mapJudgeBatchResults({
        judgeName: 'critic',
        judgeAgent: { provider: 'openai', model: 'gpt-4o-mini' } as any,
        batch: payload,
        raw: JSON.stringify({
          results: [{ id: 'agent-check-1', label: 'Logical range', pass: true, reason: 'ok' }]
        })
      })
    ).toEqual([
      {
        label: 'Logical range',
        pass: true,
        reason: 'ok',
        metadata: {
          check_id: 'agent-check-1',
          judge_agent: 'critic',
          judge_model: 'gpt-4o-mini',
          judge_provider: 'openai'
        }
      },
      {
        label: 'Mentions source',
        pass: false,
        reason: 'Judge did not return a result for "Mentions source"',
        metadata: {
          check_id: 'agent-check-2',
          judge_agent: 'critic',
          judge_model: 'gpt-4o-mini',
          judge_provider: 'openai'
        }
      }
    ]);
  });

  it('throws for invalid batch JSON', () => {
    const payload = buildJudgeBatchPayload('Final answer text', [
      { label: 'Logical range', prompt: 'Confirm there is a logical range.' }
    ]);

    expect(() =>
      mapJudgeBatchResults({
        judgeName: 'critic',
        judgeAgent: { provider: 'openai', model: 'gpt-4o-mini' } as any,
        batch: payload,
        raw: 'not-json'
      })
    ).toThrow('judge "critic" returned invalid JSON for batched agent checks');
  });
});
