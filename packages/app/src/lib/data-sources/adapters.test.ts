import { describe, expect, it } from 'vitest';
import { fromCoreResultsJson } from './adapters';
import type { CoreResultsJson, ScenarioRunTraceRecord } from './types';

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

function makeRecord(
  runIndex: number,
  messages: ScenarioRunTraceRecord['messages']
): ScenarioRunTraceRecord {
  return {
    type: 'scenario_run',
    trace_version: 3,
    run_index: runIndex,
    scenario_id: 'scn-1',
    agent: 'gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    ts_start: '2026-02-08T10:00:00.000Z',
    ts_end: '2026-02-08T10:00:05.000Z',
    pass: runIndex === 0,
    messages
  };
}

describe('fromCoreResultsJson conversation mapping', () => {
  it('maps trace records and partitions conversations by run', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'user',
        ts: '2026-02-08T10:00:00.000Z',
        content: [{ type: 'text', text: 'first question' }]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        content: [
          { type: 'text', text: 'Let me search' },
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: { q: 'TM5-BP2' },
            server: 'my-server'
          }
        ]
      },
      {
        role: 'tool',
        ts: '2026-02-08T10:00:03.120Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"count":9}' }],
            is_error: false,
            duration_ms: 120,
            ts_end: '2026-02-08T10:00:03.120Z'
          }
        ]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:04.000Z',
        content: [{ type: 'text', text: 'Final answer one' }]
      }
    ]);

    const run1Record = makeRecord(1, [
      {
        role: 'user',
        ts: '2026-02-08T10:01:00.000Z',
        content: [{ type: 'text', text: 'second question' }]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:01:01.000Z',
        content: [
          { type: 'text', text: 'Let me search again' },
          {
            type: 'tool_use',
            id: 'tu-2',
            name: 'search_tags',
            input: { q: 'TM5-BP3' },
            server: 'my-server'
          }
        ]
      },
      {
        role: 'tool',
        ts: '2026-02-08T10:01:03.080Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-2',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"error":"timeout"}' }],
            is_error: false,
            duration_ms: 80,
            ts_end: '2026-02-08T10:01:03.080Z'
          }
        ]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:01:04.000Z',
        content: [{ type: 'text', text: 'Final answer two' }]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record, run1Record]);
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

  it('handles missing record for a run without crashing', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'user',
        ts: '2026-02-08T10:00:00.000Z',
        content: [{ type: 'text', text: 'only prompt' }]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: {},
            server: 'my-server'
          }
        ]
      },
      {
        role: 'tool',
        ts: '2026-02-08T10:00:02.010Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{}' }],
            is_error: false,
            duration_ms: 10,
            ts_end: '2026-02-08T10:00:02.010Z'
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const firstRun = mapped.scenarios[0].runs[0];

    expect(firstRun.conversation.map((item) => item.kind)).toEqual([
      'user_prompt',
      'tool_call',
      'tool_result'
    ]);
    expect(mapped.scenarios[0].runs[1].conversation).toEqual([]);
  });

  it('last assistant text item becomes assistant_final', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'user',
        ts: '2026-02-08T10:00:00.000Z',
        content: [{ type: 'text', text: 'investigate' }]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:02.000Z',
        content: [
          {
            type: 'text',
            text: 'It seems there are no ALPHA or BETA product batches in the given time range. The data availability looks good, but the value_based_search did not find any matching events.'
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const kinds = mapped.scenarios[0].runs[0].conversation.map((item) => item.kind);

    expect(kinds).toEqual(['user_prompt', 'assistant_final']);
  });

  it('handles multiple tool calls in one assistant message and preserves pairing order', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'user',
        ts: '2026-02-08T10:00:00.000Z',
        content: [{ type: 'text', text: 'compare two lookups' }]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        content: [
          { type: 'text', text: 'Running two searches' },
          {
            type: 'tool_use',
            id: 'tu-a',
            name: 'search_tags',
            input: { q: 'ALPHA' },
            server: 'my-server'
          },
          {
            type: 'tool_use',
            id: 'tu-b',
            name: 'search_tags',
            input: { q: 'BETA' },
            server: 'my-server'
          }
        ]
      },
      {
        role: 'tool',
        ts: '2026-02-08T10:00:02.000Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-b',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"hits":2}' }],
            is_error: false,
            duration_ms: 20,
            ts_end: '2026-02-08T10:00:02.020Z'
          },
          {
            type: 'tool_result',
            tool_use_id: 'tu-a',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"hits":1}' }],
            is_error: false,
            duration_ms: 10,
            ts_end: '2026-02-08T10:00:02.010Z'
          }
        ]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:03.000Z',
        content: [{ type: 'text', text: 'Done' }]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const run = mapped.scenarios[0].runs[0];

    expect(run.toolCalls.map((c) => c.arguments)).toEqual([{ q: 'ALPHA' }, { q: 'BETA' }]);
    expect(run.conversation.map((item) => item.kind)).toEqual([
      'user_prompt',
      'assistant_thought',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'assistant_final'
    ]);
    expect(run.conversation.filter((item) => item.kind === 'tool_result').map((item) => item.text)).toEqual([
      '{"hits":1}',
      '{"hits":2}'
    ]);
  });

  it('does not crash on malformed tool_result content and emits an empty tool_result text', () => {
    const malformedToolMessage = {
      role: 'tool',
      ts: '2026-02-08T10:00:02.010Z',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu-1',
          name: 'search_tags',
          content: [{ type: 'image', url: 'https://example.com/not-expected.png' }],
          is_error: false,
          duration_ms: 10,
          ts_end: '2026-02-08T10:00:02.010Z'
        }
      ]
    } as unknown as ScenarioRunTraceRecord['messages'][number];

    const run0Record = makeRecord(0, [
      {
        role: 'user',
        ts: '2026-02-08T10:00:00.000Z',
        content: [{ type: 'text', text: 'only prompt' }]
      },
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: {},
            server: 'my-server'
          }
        ]
      },
      malformedToolMessage
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const toolResults = mapped.scenarios[0].runs[0].conversation.filter((item) => item.kind === 'tool_result');

    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].text).toBe('');
  });

  it('falls back timestamps when trace messages omit timestamps', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: { q: 'fallback' },
            server: 'my-server'
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{}' }],
            is_error: false
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const run = mapped.scenarios[0].runs[0];

    expect(run.toolCalls[0].duration).toBe(120); // falls back to core results duration
    expect(typeof run.toolCalls[0].timestamp).toBe('string'); // falls back to generated timestamp
    expect(run.conversation.find((item) => item.kind === 'tool_call')?.timestamp).toBeUndefined();
    expect(run.conversation.find((item) => item.kind === 'tool_result')?.timestamp).toBeUndefined();
  });
});
