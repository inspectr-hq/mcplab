import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompareResultDetails from './CompareResultDetails';
import type { EvalResult } from '@/types/eval';

const { sourceMock } = vi.hoisted(() => {
  const getResult = vi.fn();
  return { sourceMock: { getResult } };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({ source: sourceMock })
}));

function makeResult(id: string, durationMs: number): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: 'hash',
    timestamp: '2026-05-28T10:00:00.000Z',
    mcpServerVersions: {},
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'Scenario 1',
        agentId: 'agent-1',
        agentName: 'Agent 1',
        runs: [
          {
            runIndex: 0,
            passed: true,
            toolCalls: [],
            finalAnswer: 'ok',
            conversation: [],
            duration: durationMs,
            extractedValues: {},
            failureReasons: []
          }
        ],
        passRate: 1,
        avgToolCalls: 0,
        avgDuration: durationMs
      }
    ],
    overallPassRate: 1,
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: 0,
    avgLatency: durationMs
  };
}

describe('CompareResultDetails', () => {
  beforeEach(() => {
    sourceMock.getResult.mockResolvedValue(undefined);
  });

  it('shows guidance when required query params are missing', async () => {
    render(
      <MemoryRouter initialEntries={['/compare/results']}>
        <Routes>
          <Route path="/compare/results" element={<CompareResultDetails />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Full Result Compare')).toBeInTheDocument();
    expect(screen.getByText(/Select exactly two runs in Compare/)).toBeInTheDocument();
  });

  it('renders side-by-side iframes with optional agent filters', async () => {
    sourceMock.getResult
      .mockResolvedValueOnce(makeResult('run-1', 1200))
      .mockResolvedValueOnce(makeResult('run-1', 2200));

    render(
      <MemoryRouter
        initialEntries={[
          '/compare/results?left=run-1&right=run-1&leftConfig=cfg-1&rightConfig=cfg-1&leftAgent=agent-a&rightAgent=agent-b'
        ]}
      >
        <Routes>
          <Route path="/compare/results" element={<CompareResultDetails />} />
        </Routes>
      </MemoryRouter>
    );

    const leftFrame = screen.getByTitle('Result run-1 · agent-a');
    const rightFrame = screen.getByTitle('Result run-1 · agent-b');
    expect(leftFrame).toHaveAttribute('src', '/results/run-1?configId=cfg-1&agent=agent-a&embed=1');
    expect(rightFrame).toHaveAttribute(
      'src',
      '/results/run-1?configId=cfg-1&agent=agent-b&embed=1'
    );

    expect(screen.getByRole('link', { name: 'Open Left' })).toHaveAttribute(
      'href',
      '/results/run-1?configId=cfg-1&agent=agent-a'
    );
    expect(screen.getByRole('link', { name: 'Open Right' })).toHaveAttribute(
      'href',
      '/results/run-1?configId=cfg-1&agent=agent-b'
    );
  });
});
