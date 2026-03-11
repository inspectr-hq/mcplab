import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ResultDetail from './ResultDetail';
import type { EvalResult } from '@/types/eval';

const { getResultMock, sourceMock } = vi.hoisted(() => {
  const getResult = vi.fn();
  const listSnapshots = vi.fn().mockResolvedValue([]);
  const compareSnapshot = vi.fn();
  const listMarkdownReports = vi.fn().mockResolvedValue([]);
  const updateRunNote = vi.fn().mockResolvedValue(undefined);
  return {
    getResultMock: getResult,
    sourceMock: { getResult, listSnapshots, compareSnapshot, listMarkdownReports, updateRunNote }
  };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfigs: () => ({
    configs: [],
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
    scenarios: [],
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
              { id: '1', kind: 'user_prompt', text: 'user: list tags', timestamp: '2026-02-08T10:00:00.100Z' },
              { id: '2', kind: 'assistant_thought', text: 'tool_calls:search_tags', timestamp: '2026-02-08T10:00:00.200Z' },
              { id: '3', kind: 'tool_call', text: '{"q":"TM5-BP2"}', toolName: 'search_tags', timestamp: '2026-02-08T10:00:00.300Z' },
              { id: '4', kind: 'tool_result', text: '{"count":9}', toolName: 'search_tags', ok: true, durationMs: 120, timestamp: '2026-02-08T10:00:00.420Z' },
              { id: '5', kind: 'assistant_final', text: 'Here are the requested tags.', timestamp: '2026-02-08T10:00:00.500Z' }
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
    result.scenarios[0].runs[0].toolTokenUsage = { inputTokens: 10, outputTokens: 6, totalTokens: 16 };
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
});
