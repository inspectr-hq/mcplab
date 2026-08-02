import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ScenarioRunTraceRecord, TraceMessage } from '@inspectr/mcplab-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ToolResponse = {
  structuredContent?: Record<string, unknown>;
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

async function createTraceTools(): Promise<Map<string, RegisteredTool>> {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-trace-'));
  temporaryRoots.push(root);
  const libraryRoot = join(root, 'library');
  const runsDir = join(root, 'runs');
  mkdirSync(join(runsDir, 'run-trace'), { recursive: true });
  writeFileSync(
    join(runsDir, 'run-trace', 'trace.jsonl'),
    `${traceFixture().map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8'
  );
  return setupTools(libraryRoot, 'runs');
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
    expect(timelineTexts).toEqual(expect.arrayContaining(['Find the a\n...[truncated 13 chars]']));
    expect(timelineTexts.join('\n')).not.toContain('Verify the record');
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

    expect(structured<Record<string, unknown>>(result)).toMatchObject({
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
  });
});
