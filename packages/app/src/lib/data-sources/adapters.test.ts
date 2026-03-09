import { describe, expect, it } from 'vitest';
import { fromCoreConfigYaml, fromCoreResultsJson, toCoreConfigYaml } from './adapters';
import type { CoreResultsJson, ScenarioRunTraceRecord, WorkspaceConfigRecord } from './types';

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

  it('maps run note from core results metadata', () => {
    const results = baseResults();
    results.metadata.run_note = 'mcp-server v1.8.2 #staging';
    const mapped = fromCoreResultsJson(results, []);
    expect((mapped as { runNote?: string }).runNote).toBe('mcp-server v1.8.2 #staging');
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
          { ref: 'scn-weather' },
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
    expect(roundTripped.scenarios).toEqual(sourceRecord.config.scenarios);
    expect(roundTripped.run_defaults).toEqual(sourceRecord.config.run_defaults);
    expect('server_refs' in (roundTripped as Record<string, unknown>)).toBe(false);
    expect('agent_refs' in (roundTripped as Record<string, unknown>)).toBe(false);
    expect('scenario_refs' in (roundTripped as Record<string, unknown>)).toBe(false);
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
    const writtenTopLevel = (roundTripped.servers as any[]).find((s: any) => s.id === 'my-api');
    expect(writtenTopLevel?.auth).toEqual({
      type: 'oauth_client_credentials',
      token_url: 'https://auth.example.com/token',
      client_id_env: 'MY_CLIENT_ID',
      client_secret_env: 'MY_CLIENT_SECRET',
      scope: 'read write',
      audience: 'https://api.example.com'
    });

    // Scenario-owned inline server preserves oauth_client_credentials in mcp_servers
    const writtenScenario = (roundTripped.scenarios as any[]).find((s: any) => s.id === 'scn-cc');
    const writtenScopedApi = writtenScenario?.mcp_servers?.find((s: any) => s.id === 'scoped-api');
    expect(writtenScopedApi?.auth).toEqual({
      type: 'oauth_client_credentials',
      token_url: 'https://auth2.example.com/token',
      client_id_env: 'SCOPED_CLIENT_ID',
      client_secret_env: 'SCOPED_CLIENT_SECRET'
    });
  });
});
