import { describe, expect, it } from 'vitest';
import { fromCoreResultsJson } from './adapters';
import type { CoreResultsJson, TraceUiEvent } from './types';

function baseResults(): CoreResultsJson {
  return {
    metadata: {
      run_id: 'run-1',
      timestamp: '2026-02-08T10:00:00.000Z',
      config_hash: 'abc123'
    },
    summary: {
      total_scenarios: 1,
      total_runs: 2,
      pass_rate: 0.5,
      avg_tool_calls_per_run: 1,
      avg_tool_latency_ms: 100
    },
    scenarios: [
      {
        scenario_id: 'scn-1',
        agent: 'gpt-4o',
        pass_rate: 0.5,
        runs: [
          {
            run_index: 0,
            pass: true,
            failures: [],
            tool_calls: ['search_tags'],
            tool_call_count: 1,
            tool_sequence: ['search_tags'],
            tool_usage: { search_tags: 1 },
            tool_durations_ms: [120],
            final_text: 'Final answer one',
            extracted: {}
          },
          {
            run_index: 1,
            pass: false,
            failures: ['assertion failed'],
            tool_calls: ['search_tags'],
            tool_call_count: 1,
            tool_sequence: ['search_tags'],
            tool_usage: { search_tags: 1 },
            tool_durations_ms: [80],
            final_text: 'Final answer two',
            extracted: {}
          }
        ]
      }
    ]
  };
}

describe('fromCoreResultsJson conversation mapping', () => {
  it('maps mixed trace events and partitions conversations by run', () => {
    const traceEvents: TraceUiEvent[] = [
      { type: 'scenario_started', scenario_id: 'scn-1', ts: '2026-02-08T10:00:00.000Z' },
      { type: 'llm_request', messages_summary: 'user: first question', ts: '2026-02-08T10:00:01.000Z' },
      { type: 'llm_response', raw_or_summary: 'tool_calls:search_tags', ts: '2026-02-08T10:00:02.000Z' },
      { type: 'tool_call', scenario_id: 'scn-1', tool: 'search_tags', args: { q: 'TM5-BP2' }, ts_start: '2026-02-08T10:00:03.000Z' },
      { type: 'tool_result', scenario_id: 'scn-1', tool: 'search_tags', ok: true, result_summary: '{"count":9}', duration_ms: 120, ts_end: '2026-02-08T10:00:03.120Z' },
      { type: 'final_answer', scenario_id: 'scn-1', text: 'Final answer one', ts: '2026-02-08T10:00:04.000Z' },
      { type: 'scenario_finished', scenario_id: 'scn-1', pass: true, ts: '2026-02-08T10:00:05.000Z' },
      { type: 'scenario_started', scenario_id: 'scn-1', ts: '2026-02-08T10:01:00.000Z' },
      { type: 'llm_request', messages_summary: 'user: second question', ts: '2026-02-08T10:01:01.000Z' },
      { type: 'llm_response', raw_or_summary: 'tool_calls:search_tags', ts: '2026-02-08T10:01:02.000Z' },
      { type: 'tool_call', scenario_id: 'scn-1', tool: 'search_tags', args: { q: 'TM5-BP3' }, ts_start: '2026-02-08T10:01:03.000Z' },
      { type: 'tool_result', scenario_id: 'scn-1', tool: 'search_tags', ok: false, result_summary: '{"error":"timeout"}', duration_ms: 80, ts_end: '2026-02-08T10:01:03.080Z' },
      { type: 'final_answer', scenario_id: 'scn-1', text: 'Final answer two', ts: '2026-02-08T10:01:04.000Z' },
      { type: 'scenario_finished', scenario_id: 'scn-1', pass: false, ts: '2026-02-08T10:01:05.000Z' }
    ];

    const mapped = fromCoreResultsJson(baseResults(), traceEvents);
    const runs = mapped.scenarios[0].runs;

    expect(runs[0].toolCalls[0].arguments).toEqual({ q: 'TM5-BP2' });
    expect(runs[1].toolCalls[0].arguments).toEqual({ q: 'TM5-BP3' });
    expect(runs[0].conversation.map((item) => item.kind)).toEqual([
      'user_prompt',
      'assistant_thought',
      'tool_call',
      'tool_result',
      'assistant_final'
    ]);
    expect(runs[1].conversation[0].text).toContain('second question');
  });

  it('handles missing llm_response/final_answer without crashing', () => {
    const traceEvents: TraceUiEvent[] = [
      { type: 'scenario_started', scenario_id: 'scn-1', ts: '2026-02-08T10:00:00.000Z' },
      { type: 'llm_request', messages_summary: 'user: only prompt', ts: '2026-02-08T10:00:01.000Z' },
      { type: 'tool_call', scenario_id: 'scn-1', tool: 'search_tags', args: {}, ts_start: '2026-02-08T10:00:02.000Z' },
      { type: 'tool_result', scenario_id: 'scn-1', tool: 'search_tags', ok: true, result_summary: '{}', duration_ms: 10, ts_end: '2026-02-08T10:00:02.010Z' },
      { type: 'scenario_finished', scenario_id: 'scn-1', pass: true, ts: '2026-02-08T10:00:03.000Z' }
    ];

    const mapped = fromCoreResultsJson(baseResults(), traceEvents);
    const firstRun = mapped.scenarios[0].runs[0];

    expect(firstRun.conversation.map((item) => item.kind)).toEqual(['user_prompt', 'tool_call', 'tool_result']);
    expect(mapped.scenarios[0].runs[1].conversation).toEqual([]);
  });

  it('drops assistant response when it is a prefix of final answer', () => {
    const traceEvents: TraceUiEvent[] = [
      { type: 'scenario_started', scenario_id: 'scn-1', ts: '2026-02-08T10:00:00.000Z' },
      { type: 'llm_request', messages_summary: 'user: investigate', ts: '2026-02-08T10:00:01.000Z' },
      { type: 'llm_response', raw_or_summary: "It seems there are no ALPHA or BETA product batches in the given time range...", ts: '2026-02-08T10:00:02.000Z' },
      { type: 'final_answer', scenario_id: 'scn-1', text: "It seems there are no ALPHA or BETA product batches in the given time range. The data availability looks good, but the value_based_search did not find any matching events.", ts: '2026-02-08T10:00:03.000Z' },
      { type: 'scenario_finished', scenario_id: 'scn-1', pass: true, ts: '2026-02-08T10:00:04.000Z' }
    ];

    const mapped = fromCoreResultsJson(baseResults(), traceEvents);
    const kinds = mapped.scenarios[0].runs[0].conversation.map((item) => item.kind);

    expect(kinds).toEqual(['user_prompt', 'assistant_final']);
  });
});
