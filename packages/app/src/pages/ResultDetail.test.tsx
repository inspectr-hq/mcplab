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
  return {
    getResultMock: getResult,
    sourceMock: { getResult, listSnapshots, compareSnapshot, listMarkdownReports }
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
});
