import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResultDetail from './ResultDetail';
import type { EvalConfig, EvalResult } from '@/types/eval';
import type {
  ResultAssistantPendingToolCall,
  ResultAssistantSessionView
} from '@/lib/data-sources/types';

const { getResultMock, sourceMock, mockResultAssistantState, mockConfigs, mockLibraryScenarios } =
  vi.hoisted(() => {
    const getResult = vi.fn();
    const listMarkdownReports = vi.fn().mockResolvedValue([]);
    const updateRunNote = vi.fn().mockResolvedValue(undefined);
    const startRun = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    const configs: EvalConfig[] = [];
    const libraryScenarios: EvalConfig['scenarios'] = [];
    const assistantState = {
      assistantMessages: [] as ResultAssistantSessionView['messages'],
      assistantPendingToolCalls: [] as ResultAssistantPendingToolCall[],
      assistantInput: '',
      assistantLoading: false,
      assistantChatEndRef: { current: null as HTMLDivElement | null },
      assistantInputRef: { current: null as HTMLTextAreaElement | null },
      setAssistantInput: vi.fn(),
      askResultAssistant: vi.fn(),
      approveResultAssistantToolCall: vi.fn(),
      denyResultAssistantToolCall: vi.fn(),
      applyResultAssistantSnippet: vi.fn(),
      ensureIntroMessage: vi.fn(),
      resetAssistantSession: vi.fn()
    };
    return {
      getResultMock: getResult,
      sourceMock: { getResult, listMarkdownReports, updateRunNote, startRun },
      mockResultAssistantState: assistantState,
      mockConfigs: configs,
      mockLibraryScenarios: libraryScenarios
    };
  });

vi.mock('@/hooks/use-result-assistant', () => ({
  useResultAssistant: () => mockResultAssistantState
}));

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfigs: () => ({
    configs: mockConfigs,
    loading: false,
    getConfig: () => undefined,
    addConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    cloneConfig: vi.fn(),
    reload: vi.fn()
  })
}));

vi.mock('@/contexts/LibraryContext', () => ({
  useLibraries: () => ({
    servers: [],
    agents: [],
    scenarios: mockLibraryScenarios,
    loading: false,
    setServers: vi.fn(),
    setAgents: vi.fn(),
    setScenarios: vi.fn(),
    reload: vi.fn()
  })
}));

function makeResult(): EvalResult {
  return {
    id: 'run-1',
    configId: 'cfg-1',
    configHash: 'abc123',
    timestamp: '2026-02-08T10:00:00.000Z',
    overallPassRate: 1,
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: 1,
    avgLatency: 120,
    mcpServerVersions: {},
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'Scenario 1',
        agentId: 'agent-1',
        agentName: 'Agent 1',
        passRate: 1,
        avgToolCalls: 1,
        avgDuration: 120,
        runs: [
          {
            runIndex: 0,
            passed: true,
            toolCalls: [
              {
                name: 'search_tags',
                arguments: { q: 'TM5-BP2' },
                duration: 120,
                timestamp: '2026-02-08T10:00:01.000Z'
              }
            ],
            finalAnswer: 'Here are the requested tags.',
            conversation: [
              {
                id: '1',
                kind: 'user_prompt',
                text: 'user: list tags',
                timestamp: '2026-02-08T10:00:00.100Z'
              },
              {
                id: '2',
                kind: 'assistant_thought',
                text: 'tool_calls:search_tags',
                timestamp: '2026-02-08T10:00:00.200Z'
              },
              {
                id: '3',
                kind: 'tool_call',
                text: '{"q":"TM5-BP2"}',
                toolName: 'search_tags',
                timestamp: '2026-02-08T10:00:00.300Z'
              },
              {
                id: '4',
                kind: 'tool_result',
                text: '{"count":9}',
                toolName: 'search_tags',
                ok: true,
                durationMs: 120,
                timestamp: '2026-02-08T10:00:00.420Z'
              },
              {
                id: '5',
                kind: 'assistant_final',
                text: 'Here are the requested tags.',
                timestamp: '2026-02-08T10:00:00.500Z'
              }
            ],
            duration: 120,
            extractedValues: {},
            failureReasons: []
          }
        ]
      }
    ]
  };
}

describe('ResultDetail conversation toggle', () => {
  beforeEach(() => {
    mockConfigs.length = 0;
    mockLibraryScenarios.length = 0;
    mockResultAssistantState.assistantMessages = [];
    mockResultAssistantState.assistantPendingToolCalls = [];
    mockResultAssistantState.assistantInput = '';
    mockResultAssistantState.assistantLoading = false;
    mockResultAssistantState.setAssistantInput.mockClear();
    mockResultAssistantState.askResultAssistant.mockClear();
    mockResultAssistantState.approveResultAssistantToolCall.mockClear();
    mockResultAssistantState.denyResultAssistantToolCall.mockClear();
    mockResultAssistantState.applyResultAssistantSnippet.mockClear();
    mockResultAssistantState.ensureIntroMessage.mockClear();
    mockResultAssistantState.resetAssistantSession.mockClear();
  });

  it('shows run note placeholder for historical runs without note', async () => {
    getResultMock.mockResolvedValue(makeResult());

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getByRole('button', { name: 'Run Note' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Note' }));
    expect(screen.getByText(/Run note:/)).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
  });

  it('offers subtle links to edit the parent scenario and reusable test case', async () => {
    const result = makeResult();
    result.configId = '';
    result.configName = 'Config';
    result.configPath = 'config.yaml';
    const scenario = {
      id: 'scn-1',
      name: 'Scenario 1',
      prompt: 'Prompt',
      serverIds: [],
      evalRules: [],
      extractRules: []
    };
    mockConfigs.push({
      id: 'cfg-1',
      name: 'Config',
      relativePath: 'config.yaml',
      agents: [],
      scenarios: [scenario],
      createdAt: '2026-02-08T10:00:00.000Z',
      updatedAt: '2026-02-08T10:00:00.000Z'
    });
    mockLibraryScenarios.push(scenario);
    getResultMock.mockResolvedValue(result);

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    expect(screen.getByRole('link', { name: 'Edit scenario' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Scenario 1'));

    expect(screen.getByRole('link', { name: 'Edit scenario' })).toHaveAttribute(
      'href',
      '/mcp-evaluations/cfg-1/scenarios'
    );
    expect(screen.getByRole('link', { name: 'Edit test case' })).toHaveAttribute(
      'href',
      '/libraries/test-cases/scn-1?returnTo=%2Fresults%2Frun-1'
    );
  });

  it('is hidden by default and reveals chat timeline without hiding final answer', async () => {
    getResultMock.mockResolvedValue(makeResult());

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getByText('Scenario 1'));
    expect(screen.getByText('Here are the requested tags.')).toBeInTheDocument();
    expect(screen.queryByText('User prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Conversation trace'));

    await waitFor(() => {
      expect(screen.getByText('User prompt')).toBeInTheDocument();
      expect(screen.getByText('Agent final')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Here are the requested tags.').length).toBeGreaterThan(0);
  });

  it('shows an explicit empty state when no tool calls are present', async () => {
    const result = makeResult();
    result.scenarios[0]!.runs[0]!.toolCalls = [];
    getResultMock.mockResolvedValue(result);

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getByText('Scenario 1'));

    await waitFor(() => {
      expect(screen.getByText('No tool calls captured for this run.')).toBeInTheDocument();
    });
  });

  it('renders MCP server versions inline metadata when present and shows unknown for null', async () => {
    const result = makeResult();
    result.mcpServerVersions = { api: '1.2.3', docs: null };
    getResultMock.mockResolvedValue(result);

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    expect(screen.getByText(/MCP:/)).toBeInTheDocument();
    expect(screen.getByText(/api: 1\.2\.3/)).toBeInTheDocument();
    expect(screen.getByText(/docs: unknown/)).toBeInTheDocument();
  });

  it('hides MCP inline metadata for historical runs without versions', async () => {
    getResultMock.mockResolvedValue(makeResult());

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    expect(screen.queryByText(/MCP:/)).not.toBeInTheDocument();
  });

  it('renders tool token totals and per-tool estimated breakdown', async () => {
    const result = makeResult();
    result.toolTokenUsage = { inputTokens: 10, outputTokens: 6, totalTokens: 16 };
    result.scenarios[0].toolTokenUsage = { inputTokens: 10, outputTokens: 6, totalTokens: 16 };
    result.scenarios[0].runs[0].toolTokenUsage = {
      inputTokens: 10,
      outputTokens: 6,
      totalTokens: 16
    };
    result.scenarios[0].runs[0].toolTokenUsageByTool = {
      search_tags: { inputTokens: 10, outputTokens: 6, totalTokens: 16 }
    };
    getResultMock.mockResolvedValue(result);

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    expect(screen.getAllByText('Tool Tokens').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Scenario 1'));
    expect(screen.getByText('Tool token estimate')).toBeInTheDocument();
    expect(screen.getByText('estimated')).toBeInTheDocument();
    expect(screen.getAllByText('search_tags').length).toBeGreaterThan(0);
  });

  it('filters displayed scenarios and metrics when agent query param is set', async () => {
    const result = makeResult();
    result.scenarios.push({
      scenarioId: 'scn-2',
      scenarioName: 'Scenario 2',
      agentId: 'agent-2',
      agentName: 'Agent 2',
      passRate: 0,
      avgToolCalls: 2,
      avgDuration: 250,
      runs: [
        {
          runIndex: 0,
          passed: false,
          toolCalls: [
            {
              name: 'search_tags',
              arguments: { q: 'TM5-BP2' },
              duration: 100,
              timestamp: '2026-02-08T10:00:02.000Z'
            }
          ],
          finalAnswer: 'failed',
          conversation: [],
          duration: 250,
          extractedValues: {},
          failureReasons: ['not found']
        }
      ]
    });
    result.totalScenarios = 2;
    result.totalRuns = 2;
    result.overallPassRate = 0.5;
    result.avgToolCalls = 1.5;
    result.avgLatency = 185;
    getResultMock.mockResolvedValue(result);

    render(
      <MemoryRouter initialEntries={['/results/run-1?agent=agent-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    expect(screen.getByText(/Agent: agent-1/)).toBeInTheDocument();
    expect(screen.getAllByText(/100%/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Agent 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Scenario 2')).not.toBeInTheDocument();
  });

  it('shows resolved assistant tool calls as completed without approval actions', async () => {
    const result = makeResult();
    getResultMock.mockResolvedValue(result);
    mockResultAssistantState.assistantMessages = [
      {
        id: 'msg-1',
        role: 'assistant',
        text: 'I need to inspect the tags.',
        createdAt: '2026-02-08T10:00:00.000Z',
        pendingToolCallId: 'call-1',
        toolRequestName: 'search_tags',
        toolRequestPublicName: 'mcplab__search_tags'
      }
    ];
    mockResultAssistantState.assistantPendingToolCalls = [
      {
        id: 'call-1',
        server: 'mcplab',
        tool: 'search_tags',
        publicToolName: 'mcplab__search_tags',
        arguments: { q: 'TM5-BP2' },
        status: 'approved',
        createdAt: '2026-02-08T10:00:01.000Z',
        resultPreview: 'Approved'
      }
    ];

    render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getByRole('button', { name: 'MCP Lab Assistant' }));

    expect(await screen.findByText('Tool call search tags')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
  });

  it('queues rerun from detail page with same settings', async () => {
    const result = makeResult();
    result.id = 'run-rerun';
    result.configPath = 'evaluate-search-tags.yaml';
    result.rerunAgents = ['agent-1'];
    result.rerunScenarioIds = ['scn-1'];
    getResultMock.mockResolvedValue(result);
    sourceMock.startRun.mockClear();

    render(
      <MemoryRouter initialEntries={['/results/run-rerun']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-rerun');
    fireEvent.click(screen.getByRole('button', { name: 'Rerun' }));

    await waitFor(() => {
      expect(sourceMock.startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: 'evaluate-search-tags.yaml',
          runsPerScenario: 1,
          scenarioIds: ['scn-1'],
          agents: ['agent-1']
        })
      );
    });
  });

  it('marks checks as not evaluated when the run failed before evaluation and shows the scenario clock icon', async () => {
    const result = makeResult();
    result.configId = 'cfg-with-scenario';
    result.overallPassRate = 0;
    result.scenarios[0].passRate = 0;
    result.scenarios[0].runs[0] = {
      ...result.scenarios[0].runs[0],
      passed: false,
      error: '429 Too Many Requests',
      failureReasons: ['Scenario error: 429 Too Many Requests']
    };
    mockConfigs.push({
      id: 'cfg-with-scenario',
      name: 'Config',
      agents: [],
      scenarios: [
        {
          id: 'scn-1',
          name: 'Scenario 1',
          prompt: 'Prompt',
          serverIds: [],
          evalRules: [
            { type: 'required_tool', value: 'navigate_asset_hierarchy' },
            { type: 'response_regex', value: 'ALPHA' }
          ],
          extractRules: []
        }
      ],
      createdAt: '2026-02-08T10:00:00.000Z',
      updatedAt: '2026-02-08T10:00:00.000Z'
    });
    getResultMock.mockResolvedValue(result);

    const { container } = render(
      <MemoryRouter initialEntries={['/results/run-1']}>
        <Routes>
          <Route path="/results/:id" element={<ResultDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getByText('Scenario 1'));

    await waitFor(() => {
      expect(screen.getByText(/429 Too Many Requests/)).toBeInTheDocument();
      expect(screen.getByText('2 not evaluated')).toBeInTheDocument();
    });
    expect(screen.getAllByText('0 passed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0 failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('not_evaluated')).toHaveLength(2);
    expect(
      screen.getByText('Checks were not evaluated because this run failed before evaluation.')
    ).toBeInTheDocument();
    expect(screen.getByText('Required tool · navigate_asset_hierarchy')).toBeInTheDocument();
    expect(screen.getByText('Text matches regex · ALPHA')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-clock3')).toBeTruthy();
  });
});
