import { describe, expect, it } from 'vitest';
import {
  fromCoreConfigYaml,
  fromCoreResultsJson,
  toCoreConfigYaml,
  toCoreLibraries
} from './adapters';
import type { CoreResultsJson, ScenarioRunTraceRecord, WorkspaceConfigRecord } from './types';
import type { EvalConfig } from '@/types/eval';

// Local helper for asserting on raw YAML serialization output whose union types
// (ServerListEntry, ScenarioListEntry) would require verbose type guards in tests.
type AnyRecord = Record<string, unknown>;

function baseResults(): CoreResultsJson {
  return {
    metadata: {
      run_id: 'run-1',
      timestamp: '2026-02-08T10:00:00.000Z',
      config_hash: 'abc123',
      cli_version: '',
      mcp_server_versions: {}
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
        distinct_sequences: {},
        tool_usage_frequency: {},
        extracted_values: {},
        last_final_answer: '',
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
  it('preserves LangSmith trace URLs when loading a detailed run', () => {
    const results = baseResults();
    results.metadata.langsmith_trace_urls = {
      'request-1': 'https://smith.langchain.com/r/trace-1'
    };

    const mapped = fromCoreResultsJson(results, []);

    expect(mapped.langsmithTraceUrls).toEqual({
      'request-1': 'https://smith.langchain.com/r/trace-1'
    });
  });

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

  it('maps run note from core results metadata', () => {
    const results = baseResults();
    results.metadata.run_note = 'mcp-server v1.8.2 #staging';
    const mapped = fromCoreResultsJson(results, []);
    expect((mapped as { runNote?: string }).runNote).toBe('mcp-server v1.8.2 #staging');
  });

  it('preserves scenario execution errors on mapped runs', () => {
    const results = baseResults();
    results.scenarios[0].runs[1].error = '429 Too Many Requests';

    const mapped = fromCoreResultsJson(results, []);

    expect(mapped.scenarios[0].runs[1].error).toBe('429 Too Many Requests');
    expect(mapped.scenarios[0].runs[1].failureReasons).toEqual(['assertion failed']);
  });

  it('maps MCP server versions from core results metadata', () => {
    const results = baseResults();
    results.metadata.mcp_server_versions = {
      'weather-mcp': '1.8.2',
      'inventory-mcp': null
    };
    const mapped = fromCoreResultsJson(results, []);
    expect(mapped.mcpServerVersions).toEqual({
      'weather-mcp': '1.8.2',
      'inventory-mcp': null
    });
  });

  it('maps historical runs without MCP server versions to an empty object', () => {
    const results = baseResults();
    const mapped = fromCoreResultsJson(results, []);
    expect(mapped.mcpServerVersions).toEqual({});
  });

  it('aggregates assistant and tool-attributed token usage from trace usage', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 },
        content: [
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
        role: 'assistant',
        ts: '2026-02-08T10:00:04.000Z',
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        content: [{ type: 'text', text: 'Final answer one' }]
      }
    ]);
    const run1Record = makeRecord(1, [
      {
        role: 'assistant',
        ts: '2026-02-08T10:01:01.000Z',
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
        content: [
          {
            type: 'tool_use',
            id: 'tu-2',
            name: 'search_tags',
            input: { q: 'TM5-BP3' },
            server: 'my-server'
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record, run1Record]);
    expect(mapped.toolTokenUsage).toEqual({ inputTokens: 18, outputTokens: 10, totalTokens: 28 });
    expect(mapped.assistantTokenUsage).toEqual({
      inputTokens: 21,
      outputTokens: 12,
      totalTokens: 33
    });
    expect(mapped.scenarios[0].toolTokenUsage).toEqual({
      inputTokens: 18,
      outputTokens: 10,
      totalTokens: 28
    });
    expect(mapped.scenarios[0].runs[0].toolTokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 6,
      totalTokens: 16
    });
    expect(mapped.scenarios[0].runs[0].toolTokenUsageByTool).toEqual({
      search_tags: { inputTokens: 10, outputTokens: 6, totalTokens: 16 }
    });
  });

  it('splits tool-attributed token usage deterministically across tool calls in order', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 },
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: { q: 'alpha' },
            server: 'my-server'
          },
          {
            type: 'tool_use',
            id: 'tu-2',
            name: 'fetch_docs',
            input: { id: 'beta' },
            server: 'my-server'
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    expect(mapped.scenarios[0].runs[0].toolTokenUsage).toEqual({
      inputTokens: 11,
      outputTokens: 5,
      totalTokens: 16
    });
    expect(mapped.scenarios[0].runs[0].toolTokenUsageByTool).toEqual({
      fetch_docs: { inputTokens: 5, outputTokens: 2, totalTokens: 8 },
      search_tags: { inputTokens: 6, outputTokens: 3, totalTokens: 8 }
    });
    expect(mapped.scenarios[0].runs[1].toolTokenUsage).toBeNull();
    expect(mapped.scenarios[0].runs[1].toolTokenUsageByTool).toEqual({});
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
    expect(
      run.conversation.filter((item) => item.kind === 'tool_result').map((item) => item.text)
    ).toEqual(['{"hits":1}', '{"hits":2}']);
  });

  it('maps per-instance estimated_tokens onto tool call/result conversation items', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: { q: 'ALPHA' },
            server: 'my-server',
            estimated_tokens: {
              input: 12,
              output: 8,
              total: 20,
              method: 'js_tiktoken_estimate'
            }
          }
        ]
      },
      {
        role: 'tool',
        ts: '2026-02-08T10:00:02.000Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"hits":1}' }],
            is_error: false,
            estimated_tokens: {
              input: 12,
              output: 8,
              total: 20,
              method: 'js_tiktoken_estimate'
            }
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const toolCall = mapped.scenarios[0].runs[0].conversation.find(
      (item) => item.kind === 'tool_call'
    );
    const toolResult = mapped.scenarios[0].runs[0].conversation.find(
      (item) => item.kind === 'tool_result'
    );

    expect(toolCall?.estimatedTokens).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    });
    expect(toolCall?.estimatedTokenMethod).toBe('js_tiktoken_estimate');
    expect(toolResult?.estimatedTokens).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    });
    expect(toolResult?.estimatedTokenMethod).toBe('js_tiktoken_estimate');
  });

  it('prefers persisted estimated_tokens over turn usage split for tool token estimate', () => {
    const run0Record = makeRecord(0, [
      {
        role: 'assistant',
        ts: '2026-02-08T10:00:01.000Z',
        usage: { input_tokens: 2000, output_tokens: 500, total_tokens: 2500 },
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_tags',
            input: { q: 'ALPHA' },
            server: 'my-server',
            estimated_tokens: {
              input: 10,
              output: 90,
              total: 100,
              method: 'js_tiktoken_estimate'
            }
          }
        ]
      }
    ]);

    const mapped = fromCoreResultsJson(baseResults(), [run0Record]);
    const run = mapped.scenarios[0].runs[0];

    expect(run.toolTokenUsage).toEqual({ inputTokens: 10, outputTokens: 90, totalTokens: 100 });
    expect(run.toolTokenUsageByTool).toEqual({
      search_tags: { inputTokens: 10, outputTokens: 90, totalTokens: 100 }
    });
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
    const toolResults = mapped.scenarios[0].runs[0].conversation.filter(
      (item) => item.kind === 'tool_result'
    );

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

describe('config adapters round-trip', () => {
  it('preserves an omitted agent temperature when loading and saving config YAML', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-no-temperature',
      name: 'no-temperature',
      path: '/tmp/no-temperature.yaml',
      mtime: '2026-03-01T10:00:00.000Z',
      hash: 'hash-no-temperature',
      config: {
        servers: [],
        agents: [
          {
            id: 'agent-without-temperature',
            provider: 'openai',
            model: 'gpt-4o',
            max_tokens: 2048
          }
        ],
        scenarios: []
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const roundTripped = toCoreConfigYaml(uiConfig);

    expect(uiConfig.agents[0]).not.toHaveProperty('temperature');
    expect(roundTripped.agents?.[0]).not.toHaveProperty('temperature');
  });

  it('round-trips mixed inline/reference entries in stable order', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-1',
      name: 'batch-quality',
      path: '/tmp/batch-quality.yaml',
      mtime: '2026-03-01T10:00:00.000Z',
      hash: 'hash-1',
      config: {
        name: 'Batch Quality',
        servers: [
          { ref: 'weather-mcp' },
          {
            id: 'inline-mcp',
            name: 'Inline MCP',
            transport: 'http',
            url: 'http://localhost:3011/mcp'
          }
        ],
        agents: [
          { ref: 'claude-sonnet-46' },
          {
            id: 'azure-gpt-5-mini-custom',
            name: 'Azure GPT 5 Mini Custom',
            provider: 'azure_openai',
            model: 'gpt-5-mini',
            temperature: 0,
            max_tokens: 2048
          }
        ],
        scenarios: [
          {
            ref: 'scn-weather',
            mcp_servers: [{ ref: 'weather-mcp' }]
          },
          {
            id: 'scn-inline',
            name: 'Inline Scenario',
            servers: [],
            mcp_servers: [
              { ref: 'weather-mcp' },
              {
                id: 'inline-mcp',
                name: 'Inline MCP',
                transport: 'http',
                url: 'http://localhost:3011/mcp'
              }
            ],
            prompt: 'Check latest weather alerts',
            eval: {
              tool_constraints: {
                required_tools: ['get_alerts'],
                forbidden_tools: ['delete_alerts']
              },
              response_assertions: [{ type: 'regex', pattern: 'alerts' }]
            },
            extract: [{ name: 'alert_count', from: 'final_text', regex: '(\\d+)' }]
          }
        ],
        run_defaults: {
          selected_agents: ['claude-sonnet-46', 'azure-gpt-5-mini-custom']
        }
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    expect(uiConfig.serverEntries?.map((entry) => entry.kind)).toEqual(['referenced', 'inline']);
    expect(uiConfig.agentEntries?.map((entry) => entry.kind)).toEqual(['referenced', 'inline']);
    expect(uiConfig.scenarioEntries?.map((entry) => entry.kind)).toEqual(['referenced', 'inline']);

    const roundTripped = toCoreConfigYaml(uiConfig);
    expect(roundTripped.servers).toEqual(sourceRecord.config.servers);
    expect(roundTripped.agents).toEqual(sourceRecord.config.agents);
    expect(roundTripped.scenarios).toEqual([
      {
        ref: 'scn-weather',
        mcp_servers: [{ ref: 'weather-mcp' }]
      },
      {
        id: 'scn-inline',
        name: 'Inline Scenario',
        mcp_servers: [
          { ref: 'weather-mcp' },
          {
            id: 'inline-mcp',
            name: 'Inline MCP',
            transport: 'http',
            url: 'http://localhost:3011/mcp'
          }
        ],
        prompt: 'Check latest weather alerts',
        eval: {
          tool_constraints: {
            required_tools: ['get_alerts'],
            forbidden_tools: ['delete_alerts']
          },
          response_assertions: [{ type: 'regex', pattern: 'alerts' }]
        },
        extract: [{ name: 'alert_count', from: 'final_text', regex: '(\\d+)' }]
      }
    ]);
    expect(roundTripped.run_defaults).toEqual(sourceRecord.config.run_defaults);
    expect('server_refs' in (roundTripped as unknown as Record<string, unknown>)).toBe(false);
    expect('agent_refs' in (roundTripped as unknown as Record<string, unknown>)).toBe(false);
    expect('scenario_refs' in (roundTripped as unknown as Record<string, unknown>)).toBe(false);
  });

  it('normalizes malformed scenario names to a safe string during round-trip', () => {
    const malformedScenarioName = { 'Context - Two-Step Workflow': true };
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-malformed-scenario-name',
      name: 'malformed-scenario-name',
      path: '/tmp/malformed-scenario-name.yaml',
      mtime: '2026-03-01T10:00:00.000Z',
      hash: 'hash-malformed',
      config: {
        name: 'Malformed Scenario Name',
        servers: [],
        agents: [],
        scenarios: [
          {
            id: 'scn-malformed',
            name: malformedScenarioName as unknown as string,
            servers: [],
            prompt: 'Check malformed scenario names',
            eval: {
              tool_constraints: { required_tools: [], forbidden_tools: [] },
              response_assertions: []
            },
            extract: []
          }
        ]
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    expect(uiConfig.scenarios[0]?.name).toBe('scn-malformed');
    const roundTripped = toCoreConfigYaml(uiConfig);
    expect(roundTripped.scenarios[0]).toMatchObject({
      id: 'scn-malformed',
      name: 'scn-malformed',
      prompt: 'Check malformed scenario names'
    });
    expect((roundTripped.scenarios[0] as AnyRecord).name).toBe('scn-malformed');
  });

  it('preserves explicit empty mcp_servers overrides on referenced scenarios', () => {
    const uiConfig: EvalConfig = {
      id: 'cfg-empty-override',
      name: 'empty-override',
      configName: 'empty-override',
      description: '/tmp/empty-override.yaml',
      servers: [],
      serverEntries: [],
      agents: [],
      agentEntries: [],
      scenarios: [
        {
          id: 'scn-empty',
          name: 'Empty Override',
          serverIds: [],
          prompt: 'noop',
          evalRules: [],
          extractRules: []
        }
      ],
      scenarioEntries: [
        {
          kind: 'referenced',
          ref: 'scn-empty',
          mcpServers: []
        }
      ],
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z'
    };

    const roundTripped = toCoreConfigYaml(uiConfig);
    expect(roundTripped.scenarios).toEqual([
      {
        ref: 'scn-empty',
        mcp_servers: []
      }
    ]);
  });

  it('round-trips oauth_client_credentials auth on top-level and scenario-owned inline servers', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-2',
      name: 'oauth-cc-test',
      path: '/tmp/oauth-cc-test.yaml',
      mtime: '2026-03-01T10:00:00.000Z',
      hash: 'hash-2',
      config: {
        servers: [
          {
            id: 'my-api',
            name: 'My API',
            transport: 'http',
            url: 'http://localhost:3012/mcp',
            auth: {
              type: 'oauth_client_credentials',
              token_url: 'https://auth.example.com/token',
              client_id_env: 'MY_CLIENT_ID',
              client_secret_env: 'MY_CLIENT_SECRET',
              scope: 'read write',
              audience: 'https://api.example.com'
            }
          }
        ],
        agents: [],
        scenarios: [
          {
            id: 'scn-cc',
            name: 'OAuth CC Scenario',
            servers: [],
            mcp_servers: [
              {
                id: 'scoped-api',
                name: 'Scoped API',
                transport: 'http',
                url: 'http://localhost:3013/mcp',
                auth: {
                  type: 'oauth_client_credentials',
                  token_url: 'https://auth2.example.com/token',
                  client_id_env: 'SCOPED_CLIENT_ID',
                  client_secret_env: 'SCOPED_CLIENT_SECRET'
                }
              }
            ],
            prompt: 'test',
            eval: {
              tool_constraints: { required_tools: [], forbidden_tools: [] },
              response_assertions: []
            },
            extract: []
          }
        ]
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);

    // Both servers should round-trip with api-key authType
    const topLevel = uiConfig.servers.find((s) => s.id === 'my-api');
    expect(topLevel?.authType).toBe('api-key');
    expect(topLevel?.oauthTokenUrl).toBe('https://auth.example.com/token');
    expect(topLevel?.oauthClientIdEnv).toBe('MY_CLIENT_ID');
    expect(topLevel?.oauthClientSecretEnv).toBe('MY_CLIENT_SECRET');
    expect(topLevel?.oauthScope).toBe('read write');
    expect(topLevel?.oauthAudience).toBe('https://api.example.com');

    const scenarioOwned = uiConfig.servers.find((s) => s.id === 'scoped-api');
    expect(scenarioOwned?.authType).toBe('api-key');
    expect(scenarioOwned?.oauthTokenUrl).toBe('https://auth2.example.com/token');
    expect(scenarioOwned?.oauthClientIdEnv).toBe('SCOPED_CLIENT_ID');
    expect(scenarioOwned?.oauthClientSecretEnv).toBe('SCOPED_CLIENT_SECRET');

    const roundTripped = toCoreConfigYaml(uiConfig);

    // Top-level server preserves oauth_client_credentials
    const writtenTopLevel = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'my-api'
    );
    expect(writtenTopLevel?.auth).toEqual({
      type: 'oauth_client_credentials',
      token_url: 'https://auth.example.com/token',
      client_id_env: 'MY_CLIENT_ID',
      client_secret_env: 'MY_CLIENT_SECRET',
      scope: 'read write',
      audience: 'https://api.example.com'
    });

    // Scenario-owned inline server preserves oauth_client_credentials in mcp_servers
    const writtenScenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'scn-cc'
    );
    const writtenScopedApi = (writtenScenario?.['mcp_servers'] as AnyRecord[] | undefined)?.find(
      (s) => s['id'] === 'scoped-api'
    );
    expect(writtenScopedApi?.auth).toEqual({
      type: 'oauth_client_credentials',
      token_url: 'https://auth2.example.com/token',
      client_id_env: 'SCOPED_CLIENT_ID',
      client_secret_env: 'SCOPED_CLIENT_SECRET'
    });
  });

  it('round-trips bearer token with direct value', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-bearer-direct',
      name: 'bearer-direct-test',
      path: '/tmp/bearer-direct.yaml',
      mtime: '2026-03-10T10:00:00.000Z',
      hash: 'hash-bd',
      config: {
        servers: [
          {
            id: 'my-server',
            name: 'My Server',
            transport: 'http',
            url: 'http://localhost:3000/mcp',
            auth: { type: 'bearer', token: 'my-secret-token-123' }
          }
        ],
        agents: [],
        scenarios: []
      }
    };
    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const srv = uiConfig.servers.find((s) => s.id === 'my-server');
    expect(srv?.authType).toBe('bearer');
    expect(srv?.authValue).toBe('my-secret-token-123');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'my-server'
    );
    expect(written?.auth).toEqual({ type: 'bearer', token: 'my-secret-token-123' });
  });

  it('round-trips bearer token with ${VAR} env reference', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-bearer-env',
      name: 'bearer-env-test',
      path: '/tmp/bearer-env.yaml',
      mtime: '2026-03-10T10:00:00.000Z',
      hash: 'hash-be',
      config: {
        servers: [
          {
            id: 'env-server',
            name: 'Env Server',
            transport: 'http',
            url: 'http://localhost:3001/mcp',
            auth: { type: 'bearer', token: '${MY_TOKEN}' }
          }
        ],
        agents: [],
        scenarios: []
      }
    };
    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const srv = uiConfig.servers.find((s) => s.id === 'env-server');
    expect(srv?.authType).toBe('bearer');
    expect(srv?.authValue).toBe('${MY_TOKEN}');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'env-server'
    );
    expect(written?.auth).toEqual({ type: 'bearer', token: '${MY_TOKEN}' });
  });

  it('converts legacy bearer env field to ${VAR} syntax and writes back as token', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-bearer-legacy',
      name: 'bearer-legacy-test',
      path: '/tmp/bearer-legacy.yaml',
      mtime: '2026-03-10T10:00:00.000Z',
      hash: 'hash-bl',
      config: {
        servers: [
          {
            id: 'legacy-server',
            name: 'Legacy Server',
            transport: 'http',
            url: 'http://localhost:3002/mcp',
            auth: { type: 'bearer', env: 'LEGACY_TOKEN' }
          }
        ],
        agents: [],
        scenarios: []
      }
    };
    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const srv = uiConfig.servers.find((s) => s.id === 'legacy-server');
    expect(srv?.authType).toBe('bearer');
    expect(srv?.authValue).toBe('${LEGACY_TOKEN}');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'legacy-server'
    );
    expect(written?.auth).toEqual({ type: 'bearer', token: '${LEGACY_TOKEN}' });
  });

  it('round-trips api_key auth type', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-apikey',
      name: 'apikey-test',
      path: '/tmp/apikey.yaml',
      mtime: '2026-03-10T10:00:00.000Z',
      hash: 'hash-ak',
      config: {
        servers: [
          {
            id: 'apikey-server',
            name: 'API Key Server',
            transport: 'http',
            url: 'http://localhost:3003/mcp',
            auth: { type: 'api_key', header_name: 'X-Custom-Key', value: '${SECRET_KEY}' }
          }
        ],
        agents: [],
        scenarios: []
      }
    };
    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const srv = uiConfig.servers.find((s) => s.id === 'apikey-server');
    expect(srv?.authType).toBe('api-key');
    expect(srv?.authValue).toBe('${SECRET_KEY}');
    expect(srv?.apiKeyHeaderName).toBe('X-Custom-Key');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'apikey-server'
    );
    expect(written?.auth).toEqual({
      type: 'api_key',
      header_name: 'X-Custom-Key',
      value: '${SECRET_KEY}'
    });
  });

  it('trims bearer and api_key values during serialization', () => {
    const config: EvalConfig = {
      id: 'cfg-trim',
      name: 'cfg-trim',
      description: '',
      servers: [
        {
          id: 'bearer-server',
          name: 'Bearer',
          transport: 'streamable-http',
          url: 'http://localhost:3000/mcp',
          authType: 'bearer',
          authValue: '  ${TOKEN}  '
        },
        {
          id: 'api-server',
          name: 'API',
          transport: 'streamable-http',
          url: 'http://localhost:3001/mcp',
          authType: 'api-key',
          authValue: '  key-value  ',
          apiKeyHeaderName: '  X-Api-Key  '
        }
      ],
      agents: [],
      scenarios: [],
      createdAt: '2026-03-10T10:00:00.000Z',
      updatedAt: '2026-03-10T10:00:00.000Z'
    };

    const roundTripped = toCoreConfigYaml(config);
    const bearer = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'bearer-server'
    );
    const api = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'api-server'
    );

    expect(bearer?.auth).toEqual({ type: 'bearer', token: '${TOKEN}' });
    expect(api?.auth).toEqual({ type: 'api_key', header_name: 'X-Api-Key', value: 'key-value' });
  });

  it('throws when bearer/api_key values are empty after trim', () => {
    const config: EvalConfig = {
      id: 'cfg-empty',
      name: 'cfg-empty',
      description: '',
      servers: [
        {
          id: 'bearer-server',
          name: 'Bearer',
          transport: 'streamable-http',
          url: 'http://localhost:3000/mcp',
          authType: 'bearer',
          authValue: '   '
        }
      ],
      agents: [],
      scenarios: [],
      createdAt: '2026-03-10T10:00:00.000Z',
      updatedAt: '2026-03-10T10:00:00.000Z'
    };
    expect(() => toCoreConfigYaml(config)).toThrow(/missing bearer token value/i);

    config.servers = [
      {
        id: 'api-server',
        name: 'API',
        transport: 'streamable-http',
        url: 'http://localhost:3001/mcp',
        authType: 'api-key',
        authValue: '   '
      }
    ];
    expect(() => toCoreConfigYaml(config)).toThrow(/missing API key value/i);
  });

  it('round-trips oauth_authorization_code pre-registered with all fields', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-oac-prereg',
      name: 'oac-prereg-test',
      path: '/tmp/oac-prereg-test.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-oac-prereg',
      config: {
        servers: [
          {
            id: 'my-oauth-server',
            name: 'My OAuth Server',
            transport: 'http',
            url: 'http://localhost:3010/mcp',
            auth: {
              type: 'oauth_authorization_code',
              mode: 'pre_registered',
              client_id: 'my-client-id',
              client_secret: 'my-client-secret',
              scope: 'openid profile',
              authorization_url: 'https://auth.example.com/authorize',
              token_url: 'https://auth.example.com/token'
            }
          }
        ],
        agents: [],
        scenarios: []
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const server = uiConfig.servers.find((s) => s.id === 'my-oauth-server');
    expect(server?.authType).toBe('oauth2');
    expect(server?.oauthMode).toBe('pre_registered');
    expect(server?.oauthClientId).toBe('my-client-id');
    expect(server?.oauthClientSecret).toBe('my-client-secret');
    expect(server?.oauthScope).toBe('openid profile');
    expect(server?.oauthAuthorizationUrl).toBe('https://auth.example.com/authorize');
    expect(server?.oauthTokenEndpoint).toBe('https://auth.example.com/token');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'my-oauth-server'
    );
    // mode: 'pre_registered' is the default and intentionally omitted on serialization
    expect(written?.auth).toEqual({
      type: 'oauth_authorization_code',
      client_id: 'my-client-id',
      client_secret: 'my-client-secret',
      scope: 'openid profile',
      authorization_url: 'https://auth.example.com/authorize',
      token_url: 'https://auth.example.com/token'
    });
  });

  it('round-trips oauth_authorization_code DCR mode without client_id', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-oac-dcr',
      name: 'oac-dcr-test',
      path: '/tmp/oac-dcr-test.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-oac-dcr',
      config: {
        servers: [
          {
            id: 'dcr-server',
            name: 'DCR Server',
            transport: 'http',
            url: 'http://localhost:3011/mcp',
            auth: {
              type: 'oauth_authorization_code',
              mode: 'dcr',
              scope: 'read'
            }
          }
        ],
        agents: [],
        scenarios: []
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const server = uiConfig.servers.find((s) => s.id === 'dcr-server');
    expect(server?.authType).toBe('oauth2');
    expect(server?.oauthMode).toBe('dcr');
    expect(server?.oauthClientId).toBeUndefined();
    expect(server?.oauthClientSecret).toBeUndefined();
    expect(server?.oauthScope).toBe('read');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'dcr-server'
    );
    expect(written?.auth).toEqual({
      type: 'oauth_authorization_code',
      mode: 'dcr',
      scope: 'read'
    });
    expect((written?.['auth'] as AnyRecord | undefined)?.['client_id']).toBeUndefined();
    expect((written?.['auth'] as AnyRecord | undefined)?.['client_secret']).toBeUndefined();
  });

  it('round-trips oauth_authorization_code on scenario-owned inline server', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-oac-inline',
      name: 'oac-inline-test',
      path: '/tmp/oac-inline-test.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-oac-inline',
      config: {
        servers: [],
        agents: [],
        scenarios: [
          {
            id: 'scn-oauth',
            name: 'OAuth Scenario',
            servers: [],
            mcp_servers: [
              {
                id: 'inline-oauth',
                name: 'Inline OAuth',
                transport: 'http',
                url: 'http://localhost:3012/mcp',
                auth: {
                  type: 'oauth_authorization_code',
                  client_id: 'inline-client',
                  scope: 'email'
                }
              }
            ],
            prompt: 'test',
            eval: {
              tool_constraints: { required_tools: [], forbidden_tools: [] },
              response_assertions: []
            },
            extract: []
          }
        ]
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const server = uiConfig.servers.find((s) => s.id === 'inline-oauth');
    expect(server?.authType).toBe('oauth2');
    expect(server?.oauthClientId).toBe('inline-client');
    expect(server?.oauthScope).toBe('email');

    const roundTripped = toCoreConfigYaml(uiConfig);
    const writtenScenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'scn-oauth'
    );
    const writtenServer = (writtenScenario?.['mcp_servers'] as AnyRecord[] | undefined)?.find(
      (s) => s['id'] === 'inline-oauth'
    );
    expect(writtenServer?.auth).toEqual({
      type: 'oauth_authorization_code',
      client_id: 'inline-client',
      scope: 'email'
    });
  });

  it('omits empty optional fields when serializing oauth_authorization_code', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-oac-minimal',
      name: 'oac-minimal-test',
      path: '/tmp/oac-minimal-test.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-oac-minimal',
      config: {
        servers: [
          {
            id: 'minimal-oauth',
            name: 'Minimal OAuth',
            transport: 'http',
            url: 'http://localhost:3013/mcp',
            auth: {
              type: 'oauth_authorization_code',
              client_id: 'only-client-id'
            }
          }
        ],
        agents: [],
        scenarios: []
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    const roundTripped = toCoreConfigYaml(uiConfig);
    const written = (roundTripped.servers as unknown as AnyRecord[]).find(
      (s) => s['id'] === 'minimal-oauth'
    );
    const writtenAuth = written?.['auth'] as AnyRecord | undefined;
    expect(writtenAuth?.['client_id']).toBe('only-client-id');
    expect(writtenAuth?.['client_secret']).toBeUndefined();
    expect(writtenAuth?.['scope']).toBeUndefined();
    expect(writtenAuth?.['mode']).toBeUndefined();
    expect(writtenAuth?.['authorization_url']).toBeUndefined();
    expect(writtenAuth?.['token_url']).toBeUndefined();
  });

  it('round-trips all response_assertions types without lossy conversion', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-assertions',
      name: 'assertions-roundtrip',
      path: '/tmp/assertions.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-assertions',
      config: {
        servers: [],
        agents: [],
        scenarios: [
          {
            id: 'scn-assertions',
            name: 'Assertions',
            servers: [],
            prompt: 'test',
            eval: {
              response_assertions: [
                { type: 'contains', value: 'hello' },
                { type: 'not_contains', value: 'error' },
                { type: 'starts_with', value: 'start' },
                { type: 'ends_with', value: 'end' },
                { type: 'equals', value: 'exact' },
                { type: 'regex', pattern: 'foo|bar' },
                { type: 'jsonpath', path: '$.status', equals: 'active' },
                { type: 'jsonpath_exists', path: '$.id' },
                { type: 'jsonpath_not_exists', path: '$.error' }
              ]
            }
          }
        ]
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    expect(uiConfig.scenarios[0]?.evalRules).toEqual([
      { type: 'response_contains', value: 'hello' },
      { type: 'response_not_contains', value: 'error' },
      { type: 'response_starts_with', value: 'start' },
      { type: 'response_ends_with', value: 'end' },
      { type: 'response_equals', value: 'exact' },
      { type: 'response_regex', value: 'foo|bar' },
      { type: 'response_jsonpath', path: '$.status', equals: 'active' },
      { type: 'response_jsonpath_exists', path: '$.id' },
      { type: 'response_jsonpath_not_exists', path: '$.error' }
    ]);

    const roundTripped = toCoreConfigYaml(uiConfig);
    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-assertions'
    );
    expect((scenario?.['eval'] as AnyRecord | undefined)?.['response_assertions']).toEqual(
      sourceRecord.config.scenarios[0] &&
        !('ref' in sourceRecord.config.scenarios[0]) &&
        sourceRecord.config.scenarios[0].eval?.response_assertions
    );
  });

  it('round-trips agent_check rules via core agent_assertions', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-agent-check',
      name: 'agent-check-roundtrip',
      path: '/tmp/agent-check.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-agent-check',
      config: {
        servers: [],
        agents: [],
        scenarios: [
          {
            id: 'scn-agent-check',
            name: 'Agent Check',
            servers: [],
            prompt: 'test',
            eval: {
              agent_assertions: [
                {
                  label: 'Logical range',
                  prompt: 'Confirm the answer includes a valid logical time range.'
                }
              ]
            }
          }
        ]
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    expect(uiConfig.scenarios[0]?.evalRules).toEqual([
      {
        type: 'agent_check',
        label: 'Logical range',
        prompt: 'Confirm the answer includes a valid logical time range.'
      }
    ]);

    const roundTripped = toCoreConfigYaml(uiConfig);
    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-agent-check'
    );
    expect((scenario?.['eval'] as AnyRecord | undefined)?.['agent_assertions']).toEqual([
      {
        label: 'Logical range',
        prompt: 'Confirm the answer includes a valid logical time range.'
      }
    ]);
  });

  it('round-trips tool_sequence rules as ordered tool lists', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-tool-sequence',
      name: 'tool-sequence-roundtrip',
      path: '/tmp/tool-sequence.yaml',
      mtime: '2026-04-01T10:00:00.000Z',
      hash: 'hash-tool-sequence',
      config: {
        servers: [],
        agents: [],
        scenarios: [
          {
            id: 'scn-tool-sequence',
            name: 'Tool Sequence',
            servers: [],
            prompt: 'test',
            eval: {
              tool_sequence: ['search', 'fetch']
            }
          }
        ]
      }
    };

    const uiConfig = fromCoreConfigYaml(sourceRecord);
    expect(uiConfig.scenarios[0]?.evalRules).toEqual([
      { type: 'tool_sequence', sequence: ['search', 'fetch'] }
    ]);

    const roundTripped = toCoreConfigYaml(uiConfig);
    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-tool-sequence'
    );
    expect((scenario?.['eval'] as AnyRecord | undefined)?.['tool_sequence']).toEqual([
      'search',
      'fetch'
    ]);
  });

  it('maps legacy response_contains/not_contains to new core contains/not_contains', () => {
    const roundTripped = toCoreConfigYaml({
      id: 'cfg-legacy',
      name: 'legacy-rules',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      servers: [],
      agents: [],
      scenarios: [
        {
          id: 'scn-legacy',
          name: 'Legacy',
          serverIds: [],
          prompt: 'test',
          evalRules: [
            { type: 'response_contains', value: 'must-have' },
            { type: 'response_not_contains', value: 'must-not-have' }
          ],
          extractRules: []
        }
      ]
    });

    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-legacy'
    );
    expect((scenario?.['eval'] as AnyRecord | undefined)?.['response_assertions']).toEqual([
      { type: 'contains', value: 'must-have' },
      { type: 'not_contains', value: 'must-not-have' }
    ]);
  });

  it('omits empty eval and extract blocks in lean serialization', () => {
    const roundTripped = toCoreConfigYaml({
      id: 'cfg-lean-empty',
      name: 'lean-empty',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      servers: [],
      agents: [],
      scenarios: [
        {
          id: 'scn-empty',
          name: 'Empty',
          serverIds: [],
          prompt: 'test',
          evalRules: [],
          extractRules: []
        }
      ]
    });

    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-empty'
    );
    expect(scenario?.eval).toBeUndefined();
    expect(scenario?.extract).toBeUndefined();
  });

  it('emits only populated tool_constraints keys and omits empty response_assertions', () => {
    const roundTripped = toCoreConfigYaml({
      id: 'cfg-lean-tools',
      name: 'lean-tools',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      servers: [],
      agents: [],
      scenarios: [
        {
          id: 'scn-tools',
          name: 'Tools',
          serverIds: [],
          prompt: 'test',
          evalRules: [{ type: 'required_tool', value: 'get_tag_data' }],
          extractRules: []
        }
      ]
    });

    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-tools'
    );
    expect(scenario?.eval).toEqual({
      tool_constraints: {
        required_tools: ['get_tag_data']
      }
    });
    expect(scenario?.extract).toBeUndefined();
  });

  it('serializes scenario and eval keys in deterministic order', () => {
    const roundTripped = toCoreConfigYaml({
      id: 'cfg-order',
      name: 'order',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      servers: [],
      agents: [],
      scenarios: [
        {
          id: 'scn-order',
          name: 'Order',
          serverIds: ['srv-a'],
          prompt: 'test',
          evalRules: [
            { type: 'required_tool', value: 'get_tag_data' },
            { type: 'forbidden_tool', value: 'delete_all' },
            { type: 'tool_sequence', sequence: ['get_tag_data', 'summarize'] },
            { type: 'response_contains', value: 'ok' }
          ],
          extractRules: [{ name: 'count', pattern: '(\\d+)' }]
        }
      ]
    } as EvalConfig);

    const scenario = (roundTripped.scenarios as unknown as AnyRecord[]).find(
      (item) => item['id'] === 'scn-order'
    );
    expect(scenario).toBeTruthy();
    expect(Object.keys(scenario!)).toEqual([
      'id',
      'name',
      'mcp_servers',
      'prompt',
      'attachments',
      'eval',
      'extract'
    ]);
    expect('servers' in scenario!).toBe(false);

    const evalBlock = scenario!.eval as AnyRecord;
    expect(Object.keys(evalBlock)).toEqual([
      'tool_constraints',
      'tool_sequence',
      'response_assertions'
    ]);

    const toolConstraints = evalBlock.tool_constraints as AnyRecord;
    expect(Object.keys(toolConstraints)).toEqual(['required_tools', 'forbidden_tools']);

    const serializedScenario = JSON.stringify(scenario);
    const orderedKeys = [
      '"id":',
      '"name":',
      '"mcp_servers":',
      '"prompt":',
      '"eval":',
      '"extract":'
    ];
    const positions = orderedKeys.map((key) => serializedScenario.indexOf(key));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const serializedEval = JSON.stringify(evalBlock);
    const evalKeyPositions = [
      '"tool_constraints":',
      '"tool_sequence":',
      '"response_assertions":'
    ].map((key) => serializedEval.indexOf(key));
    expect(evalKeyPositions.every((pos) => pos >= 0)).toBe(true);
    expect([...evalKeyPositions].sort((a, b) => a - b)).toEqual(evalKeyPositions);

    const serializedToolConstraints = JSON.stringify(toolConstraints);
    const toolConstraintPositions = ['"required_tools":', '"forbidden_tools":'].map((key) =>
      serializedToolConstraints.indexOf(key)
    );
    expect(toolConstraintPositions.every((pos) => pos >= 0)).toBe(true);
    expect([...toolConstraintPositions].sort((a, b) => a - b)).toEqual(toolConstraintPositions);
  });

  it('toCoreLibraries serializes non-empty extractRules', () => {
    const libraries = toCoreLibraries({
      servers: [],
      agents: [],
      scenarios: [
        {
          id: 'scn-lib-extract',
          name: 'Library Extract',
          serverIds: [],
          prompt: 'extract values',
          evalRules: [],
          extractRules: [
            { name: 'avg', pattern: '(average|avg|mean)' },
            { name: 'count', pattern: '(\\d+)' }
          ]
        }
      ]
    });

    const scenario = libraries.scenarios.find((item) => item.id === 'scn-lib-extract');
    expect(scenario).toBeTruthy();
    expect(scenario?.extract).toEqual([
      { name: 'avg', from: 'final_text', regex: '(average|avg|mean)' },
      { name: 'count', from: 'final_text', regex: '(\\d+)' }
    ]);
  });

  it('throws when loading unsupported response assertion types from core config', () => {
    const sourceRecord: WorkspaceConfigRecord = {
      id: 'cfg-unknown-assertion',
      name: 'unknown-assertion',
      path: '/tmp/unknown-assertion.yaml',
      mtime: '2026-04-23T10:00:00.000Z',
      hash: 'hash-unknown-assertion',
      config: {
        servers: [],
        agents: [],
        scenarios: [
          {
            id: 'scn-unknown',
            name: 'Unknown assertion',
            servers: [],
            prompt: 'test',
            eval: {
              response_assertions: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { type: 'future_type', value: 'x' } as any
              ]
            }
          }
        ]
      }
    };

    expect(() => fromCoreConfigYaml(sourceRecord)).toThrow(
      /Unsupported response assertion type in config: future_type/
    );
  });
});
