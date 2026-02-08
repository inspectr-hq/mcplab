import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ResultDetail from './ResultDetail';
import type { EvalResult } from '@/types/eval';

const { getResultMock, sourceMock } = vi.hoisted(() => {
  const getResult = vi.fn();
  return {
    getResultMock: getResult,
    sourceMock: { getResult }
  };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
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

    fireEvent.click(screen.getByRole('button', { name: 'Show conversation' }));

    await waitFor(() => {
      expect(screen.getByText('User prompt')).toBeInTheDocument();
      expect(screen.getByText('Assistant final')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Here are the requested tags.').length).toBeGreaterThan(0);
  });
});
