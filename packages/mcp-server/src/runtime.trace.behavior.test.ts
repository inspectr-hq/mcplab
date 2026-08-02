import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ScenarioRunTraceRecord, TraceMessage } from '@inspectr/mcplab-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type RegisteredTool = {
  cb: (args: Record<string, unknown>) => Promise<ToolResponse> | ToolResponse;
};

type FinalAnswerItem = {
  index: number;
  scenario_id: string;
  agent: string;
  truncated: boolean;
  text: string;
};

type FinalAnswersOutput = {
  run_id: string;
  items: FinalAnswerItem[];
};

type TimelineItem = {
  type: string;
  text?: string;
  message_index?: number;
};

type ConversationOutput = {
  scenario_id: string;
  agent: string;
  timeline: TimelineItem[];
};

type SearchMatch = { type: string } & Record<string, unknown>;

type SearchOutput = {
  query: string;
  matches: SearchMatch[];
};

const originalEnvironment = { ...process.env };
const originalCwd = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

async function setupTools(
  bundleRoot: string,
  runsDir: string
): Promise<Map<string, RegisteredTool>> {
  process.chdir(join(bundleRoot, '..'));
  process.env.MCPLAB_BUNDLE_ROOT = bundleRoot;
  process.env.MCPLAB_RUNS_DIR = runsDir;
  vi.resetModules();
  const { registerTools } = await import('./runtime.js');
  const tools = new Map<string, RegisteredTool>();
  const fakeServer = {
    registerTool: (name: string, _config: unknown, cb: RegisteredTool['cb']) => {
      tools.set(name, { cb });
      return { name };
    }
  } as unknown as McpServer;
  registerTools(fakeServer);
  return tools;
}

function scenarioRun(
  scenario_id: string,
  agent: string,
  messages: TraceMessage[],
  ts_start: string,
  ts_end: string
): ScenarioRunTraceRecord {
  return {
    type: 'scenario_run',
    trace_version: 3,
    run_index: 0,
    scenario_id,
    agent,
    provider: 'openai',
    model: 'gpt-test',
    ts_start,
    ts_end,
    pass: true,
    messages
  };
}

function textMessage(role: 'user' | 'assistant' | 'tool', text: string, ts: string): TraceMessage {
  return { role, ts, content: [{ type: 'text', text }] };
}

function traceFixture(): ScenarioRunTraceRecord[] {
  return [
    scenarioRun(
      'alpha-search',
      'scout',
      [
        textMessage('user', 'Find the alpha profile.', '2026-08-01T12:00:00.100Z'),
        textMessage('assistant', 'I will inspect the alpha profile.', '2026-08-01T12:00:00.200Z'),
        {
          role: 'assistant',
          ts: '2026-08-01T12:00:00.300Z',
          content: [
            {
              type: 'tool_use',
              id: 'call-alpha',
              server: 'directory',
              name: 'lookup_profile',
              input: { query: 'Alpha token' }
            }
          ]
        },
        {
          role: 'tool',
          ts: '2026-08-01T12:00:00.500Z',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-alpha',
              server: 'directory',
              name: 'lookup_profile',
              is_error: false,
              duration_ms: 120,
              ts_start: '2026-08-01T12:00:00.300Z',
              ts_end: '2026-08-01T12:00:00.500Z',
              content: [{ type: 'text', text: 'Alpha profile found.' }]
            }
          ]
        },
        textMessage('assistant', 'Alpha answer: the profile is active.', '2026-08-01T12:00:00.600Z')
      ],
      '2026-08-01T12:00:00.000Z',
      '2026-08-01T12:00:01.000Z'
    ),
    scenarioRun(
      'alpha-search',
      'analyst',
      [
        textMessage('user', 'Verify the alpha profile.', '2026-08-01T12:01:00.100Z'),
        textMessage('assistant', 'I will verify the record.', '2026-08-01T12:01:00.200Z'),
        {
          role: 'assistant',
          ts: '2026-08-01T12:01:00.300Z',
          content: [
            {
              type: 'tool_use',
              id: 'call-alpha-analyst',
              server: 'directory',
              name: 'lookup_profile',
              input: { query: 'alpha verification' }
            }
          ]
        },
        {
          role: 'tool',
          ts: '2026-08-01T12:01:00.400Z',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-alpha-analyst',
              server: 'directory',
              name: 'lookup_profile',
              is_error: false,
              duration_ms: 60,
              content: [{ type: 'text', text: 'Verification complete.' }]
            }
          ]
        },
        textMessage('assistant', 'Alpha verification answer is positive.', '2026-08-01T12:01:00.500Z')
      ],
      '2026-08-01T12:01:00.000Z',
      '2026-08-01T12:01:01.000Z'
    ),
    scenarioRun(
      'beta-summary',
      'scout',
      [
        textMessage('user', 'Summarize beta.', '2026-08-01T12:02:00.100Z'),
        textMessage('assistant', 'Beta has two active entries.', '2026-08-01T12:02:00.200Z'),
        textMessage('assistant', 'Beta answer: two active entries.', '2026-08-01T12:02:00.300Z')
      ],
      '2026-08-01T12:02:00.000Z',
      '2026-08-01T12:02:01.000Z'
    ),
    scenarioRun(
      'beta-summary',
      'analyst',
      [
        textMessage('user', 'Produce the beta conclusion.', '2026-08-01T12:03:00.100Z'),
        textMessage('assistant', 'I will check the beta records.', '2026-08-01T12:03:00.200Z'),
        {
          role: 'assistant',
          ts: '2026-08-01T12:03:00.300Z',
          content: [
            {
              type: 'tool_use',
              id: 'call-beta',
              server: 'reports',
              name: 'get_summary',
              input: { subject: 'beta' }
            }
          ]
        },
        {
          role: 'tool',
          ts: '2026-08-01T12:03:00.700Z',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-beta',
              server: 'reports',
              name: 'get_summary',
              is_error: false,
              duration_ms: 80,
              content: [{ type: 'text', text: 'Beta summary ready.' }]
            }
          ]
        },
        textMessage(
          'assistant',
          'Beta final answer: the report confirms two active entries and no unresolved exceptions.',
          '2026-08-01T12:03:00.800Z'
        )
      ],
      '2026-08-01T12:03:00.000Z',
      '2026-08-01T12:03:01.000Z'
    )
  ];
}

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

async function createTraceToolsRaw(
  runs: Array<{ runId: string; traceContent?: string }>
): Promise<Map<string, RegisteredTool>> {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-trace-'));
  temporaryRoots.push(root);
  const libraryRoot = join(root, 'library');
  const runsDir = join(root, 'runs');
  mkdirSync(runsDir, { recursive: true });
  for (const run of runs) {
    const runDir = join(runsDir, run.runId);
    mkdirSync(runDir, { recursive: true });
    if (run.traceContent !== undefined) {
      writeFileSync(join(runDir, 'trace.jsonl'), run.traceContent, 'utf8');
    }
  }
  return setupTools(libraryRoot, 'runs');
}

async function createTraceTools(
  records: ScenarioRunTraceRecord[] = traceFixture()
): Promise<Map<string, RegisteredTool>> {
  return createTraceToolsRaw([{ runId: 'run-trace', traceContent: jsonl(records) }]);
}

function structured<T extends Record<string, unknown>>(result: ToolResponse): T {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as T;
}

describe('trace tool behavior', () => {
  it('extracts final answers across agents and includes truncation text', async () => {
    const tools = await createTraceTools();

    const result = await tools.get('mcplab_trace_get_final_answers')!.cb({
      run_id: 'run-trace',
      max_chars_per_answer: 40
    });
    const output = structured<FinalAnswersOutput>(result);

    expect(output).toMatchObject({
      run_id: 'run-trace',
      items: [
        { index: 0, scenario_id: 'alpha-search', agent: 'scout', truncated: false, text: 'Alpha answer: the profile is active.' },
        { index: 1, scenario_id: 'alpha-search', agent: 'analyst', truncated: false, text: 'Alpha verification answer is positive.' },
        { index: 2, scenario_id: 'beta-summary', agent: 'scout', truncated: false, text: 'Beta answer: two active entries.' },
        { index: 3, scenario_id: 'beta-summary', agent: 'analyst', truncated: true, text: expect.stringContaining('...[truncated') }
      ]
    });
    expect(output.items[3].text.length).toBeGreaterThan(40);
  });

  it('assigns contiguous indices when a scenario run has no final answer', async () => {
    const tools = await createTraceTools([
      scenarioRun(
        'gamma-1',
        'scout',
        [
          textMessage('user', 'First question.', '2026-08-01T12:00:00.100Z'),
          textMessage('assistant', 'Answer one.', '2026-08-01T12:00:00.200Z')
        ],
        '2026-08-01T12:00:00.000Z',
        '2026-08-01T12:00:01.000Z'
      ),
      // Middle run ends on a tool call with no assistant text -> no final answer, gets dropped.
      scenarioRun(
        'gamma-2',
        'scout',
        [
          textMessage('user', 'Second question.', '2026-08-01T12:01:00.100Z'),
          {
            role: 'assistant',
            ts: '2026-08-01T12:01:00.200Z',
            content: [
              {
                type: 'tool_use',
                id: 'call-gamma',
                server: 'directory',
                name: 'lookup_profile',
                input: { query: 'gamma' }
              }
            ]
          }
        ],
        '2026-08-01T12:01:00.000Z',
        '2026-08-01T12:01:01.000Z'
      ),
      scenarioRun(
        'gamma-3',
        'scout',
        [
          textMessage('user', 'Third question.', '2026-08-01T12:02:00.100Z'),
          textMessage('assistant', 'Answer three.', '2026-08-01T12:02:00.200Z')
        ],
        '2026-08-01T12:02:00.000Z',
        '2026-08-01T12:02:01.000Z'
      )
    ]);

    const result = await tools.get('mcplab_trace_get_final_answers')!.cb({ run_id: 'run-trace' });
    const output = structured<FinalAnswersOutput>(result);

    // The record with no final answer is dropped; surviving indices stay contiguous (not 0, 2).
    expect(output.items.map((item) => item.index)).toEqual([0, 1]);
    expect(output.items).toMatchObject([
      { index: 0, scenario_id: 'gamma-1', text: 'Answer one.' },
      { index: 1, scenario_id: 'gamma-3', text: 'Answer three.' }
    ]);
  });

  it('returns the ordered conversation timeline for one scenario and agent', async () => {
    const tools = await createTraceTools();

    const result = await tools.get('mcplab_trace_get_conversation')!.cb({
      run_id: 'run-trace',
      scenario_id: 'alpha-search',
      agent: 'scout',
      max_text_chars: 10
    });

    const output = structured<ConversationOutput>(result);
    expect(output).toMatchObject({
      scenario_id: 'alpha-search',
      agent: 'scout',
      timeline: [
        { index: 0, type: 'user_message', message_index: 0, text: 'Find the a\n...[truncated 13 chars]' },
        { index: 1, type: 'agent_message', message_index: 1 },
        { index: 2, type: 'tool_call', tool: 'lookup_profile', id: 'call-alpha' },
        { index: 3, type: 'tool_result', tool: 'lookup_profile', duration_ms: 120, ok: true },
        { index: 4, type: 'agent_message', message_index: 4, text: 'Alpha answ\n...[truncated 26 chars]' }
      ]
    });
    const timelineTexts = output.timeline
      .filter((item): item is TimelineItem & { text: string } => typeof item.text === 'string')
      .map((item) => item.text);
    // Exactly the scout run's three text blocks, truncated to 10 chars. An exact match proves
    // ordering and truncation, and that the analyst run for the same scenario_id does not leak
    // into this timeline (a leak would add extra elements).
    expect(timelineTexts).toEqual([
      'Find the a\n...[truncated 13 chars]',
      'I will ins\n...[truncated 23 chars]',
      'Alpha answ\n...[truncated 26 chars]'
    ]);
    // Distinctive analyst-only content (truncated prefixes of "Verify the alpha profile." and
    // "Alpha verification answer is positive.") must be absent.
    expect(timelineTexts.join('\n')).not.toContain('Verify the');
    expect(timelineTexts.join('\n')).not.toContain('Alpha veri');
  });

  it('searches case-insensitively and filters matches by event type', async () => {
    const tools = await createTraceTools();

    const unfiltered = await tools.get('mcplab_trace_search')!.cb({
      run_id: 'run-trace',
      query: 'ALPHA'
    });
    const filtered = await tools.get('mcplab_trace_search')!.cb({
      run_id: 'run-trace',
      query: 'ALPHA',
      event_types: ['tool_use']
    });

    const unfilteredOutput = structured<SearchOutput>(unfiltered);
    const filteredOutput = structured<SearchOutput>(filtered);
    expect(unfilteredOutput.matches.map((match) => match.type)).toEqual(
      expect.arrayContaining(['message', 'text', 'tool_use', 'tool_result'])
    );
    expect(filteredOutput.query).toBe('ALPHA');
    expect(filteredOutput.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_use',
          scenario_id: 'alpha-search',
          agent: 'scout',
          name: 'lookup_profile'
        }),
        expect.objectContaining({
          type: 'tool_use',
          scenario_id: 'alpha-search',
          agent: 'analyst',
          name: 'lookup_profile'
        })
      ])
    );
    expect(filteredOutput.matches).toHaveLength(2);
    expect(filteredOutput.matches.every((match) => match.type === 'tool_use')).toBe(true);
  });

  it('computes message, block, tool, duration, and final-answer statistics', async () => {
    const tools = await createTraceTools();

    const result = await tools.get('mcplab_trace_stats')!.cb({ run_id: 'run-trace' });

    const output = structured<Record<string, unknown>>(result);
    expect(output).toMatchObject({
      total_scenario_records: 4,
      message_role_counts: { user: 4, assistant: 11, tool: 3 },
      block_type_counts: { text: 12, tool_use: 3, tool_result: 3 },
      scenario_agent_pairs: 4,
      tool_call_count: 3,
      tool_result_count: 3,
      final_answer_count: 4,
      avg_tool_result_duration_ms: 86.67,
      tool_usage: [
        { tool: 'directory::lookup_profile', count: 2 },
        { tool: 'reports::get_summary', count: 1 }
      ]
    });
    // A clean modern trace must not raise the legacy flag.
    expect(output.legacy_trace_detected).toBeUndefined();
  });

  it('resolves run_id "LATEST" to the lexicographically greatest run', async () => {
    const tools = await createTraceToolsRaw([
      {
        runId: 'run-2026-01',
        traceContent: jsonl([
          scenarioRun(
            'older',
            'scout',
            [textMessage('assistant', 'Older answer.', '2026-08-01T12:00:00.200Z')],
            '2026-08-01T12:00:00.000Z',
            '2026-08-01T12:00:01.000Z'
          )
        ])
      },
      {
        runId: 'run-2026-02',
        traceContent: jsonl([
          scenarioRun(
            'newer',
            'scout',
            [textMessage('assistant', 'Newer answer.', '2026-08-02T12:00:00.200Z')],
            '2026-08-02T12:00:00.000Z',
            '2026-08-02T12:00:01.000Z'
          )
        ])
      }
    ]);

    const result = await tools.get('mcplab_trace_get_final_answers')!.cb({ run_id: 'LATEST' });
    const output = structured<FinalAnswersOutput>(result);

    expect(output.run_id).toBe('run-2026-02');
    expect(output.items).toMatchObject([{ scenario_id: 'newer', text: 'Newer answer.' }]);
  });

  it('returns an error when the run trace artifact is missing', async () => {
    const tools = await createTraceToolsRaw([{ runId: 'run-empty' }]);

    const result = await tools.get('mcplab_trace_stats')!.cb({ run_id: 'run-empty' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Artifact not found');
  });

  it('returns an error for "LATEST" when no runs exist', async () => {
    const tools = await createTraceToolsRaw([]);

    const result = await tools.get('mcplab_trace_stats')!.cb({ run_id: 'LATEST' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No runs found');
  });

  it('flags legacy trace lines that are not scenario_run documents', async () => {
    const modern = scenarioRun(
      'alpha',
      'scout',
      [textMessage('assistant', 'Modern answer.', '2026-08-01T12:00:00.200Z')],
      '2026-08-01T12:00:00.000Z',
      '2026-08-01T12:00:01.000Z'
    );
    const tools = await createTraceToolsRaw([
      {
        runId: 'run-legacy',
        // A trace_meta line is ignored; a foreign typed line marks the trace as legacy.
        traceContent: `${JSON.stringify({ type: 'trace_meta', run_id: 'run-legacy' })}\n${JSON.stringify(
          { type: 'legacy_event', note: 'old format' }
        )}\n${JSON.stringify(modern)}\n`
      }
    ]);

    const result = await tools.get('mcplab_trace_stats')!.cb({ run_id: 'run-legacy' });
    const output = structured<Record<string, unknown>>(result);

    expect(output.legacy_trace_detected).toBe(true);
    expect(output.total_scenario_records).toBe(1);
  });

  it('caps trace search matches at the requested limit', async () => {
    const tools = await createTraceTools();

    const capped = await tools.get('mcplab_trace_search')!.cb({
      run_id: 'run-trace',
      query: 'alpha',
      limit: 1
    });
    const uncapped = await tools.get('mcplab_trace_search')!.cb({
      run_id: 'run-trace',
      query: 'alpha'
    });

    expect(structured<SearchOutput>(capped).matches).toHaveLength(1);
    // Without a limit the same query returns strictly more matches, proving the cap is real.
    expect(structured<SearchOutput>(uncapped).matches.length).toBeGreaterThan(1);
  });
});
