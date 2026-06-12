import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Index';
import type { EvalResult } from '@/types/eval';
import type { WorkspaceRunSummary } from '@/lib/data-sources/types';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null
}));

const { sourceMock, configsRef } = vi.hoisted(() => {
  const listResults = vi.fn();
  const listRunSummaries = vi.fn();
  return {
    sourceMock: { listResults, listRunSummaries },
    configsRef: { value: [] as Array<{ id: string }> }
  };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({ source: sourceMock })
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfigs: () => ({ configs: configsRef.value })
}));

function makeRun(id: string, passRate: number, avgLatency: number, timestamp: string): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: 'hash',
    timestamp,
    mcpServerVersions: {},
    scenarios: [],
    overallPassRate: passRate,
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: 1,
    avgLatency
  };
}

function withScenarioFailure(
  run: EvalResult,
  params: { error?: string; failureReasons?: string[] }
): EvalResult {
  return {
    ...run,
    overallPassRate: 0,
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'Scenario 1',
        agentId: 'agent-1',
        agentName: 'Agent 1',
        passRate: 0,
        avgToolCalls: 0,
        avgDuration: 0,
        runs: [
          {
            runIndex: 0,
            passed: false,
            error: params.error,
            toolCalls: [],
            finalAnswer: '',
            conversation: [],
            duration: 0,
            extractedValues: {},
            failureReasons: params.failureReasons ?? []
          }
        ]
      }
    ]
  };
}

function makeSummary(
  runId: string,
  passRate: number,
  avgLatencyMs: number,
  timestamp: string
): WorkspaceRunSummary {
  return {
    runId,
    path: `/tmp/${runId}`,
    timestamp,
    configHash: 'hash',
    totalScenarios: 1,
    totalRuns: 1,
    passRate,
    avgToolCalls: 1,
    avgLatencyMs
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    sourceMock.listResults.mockReset();
    sourceMock.listRunSummaries.mockReset();
    sourceMock.listResults.mockResolvedValue([]);
  });

  it('computes WoW deltas for pass rate and latency', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValueOnce([
      makeRun('run-30d-a', 0.8, 100, '2026-03-09T12:00:00.000Z'),
      makeRun('run-30d-b', 0.6, 140, '2026-03-08T12:00:00.000Z')
    ]);
    sourceMock.listRunSummaries
      .mockResolvedValueOnce([
        makeSummary('run-current', 0.8, 100, '2026-03-09T12:00:00.000Z'),
        makeSummary('run-current-2', 0.6, 140, '2026-03-08T12:00:00.000Z')
      ])
      .mockResolvedValueOnce([
        makeSummary('run-prev', 0.5, 200, '2026-03-02T12:00:00.000Z'),
        makeSummary('run-prev-2', 0.5, 200, '2026-03-01T12:00:00.000Z')
      ]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(sourceMock.listRunSummaries).toHaveBeenCalledTimes(2);
      expect(sourceMock.listResults).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('120ms')).toBeInTheDocument();
    expect(screen.getByText(/\+20\.0% from last week/)).toBeInTheDocument();
    expect(screen.getByText(/-80ms from last week/)).toBeInTheDocument();
  });

  it('shows fallback text when previous-week baseline is missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValueOnce([makeRun('run-30d', 1, 90, '2026-03-09')]);
    sourceMock.listRunSummaries.mockResolvedValueOnce([
      makeSummary('run-current', 1, 90, '2026-03-09')
    ]);
    sourceMock.listRunSummaries.mockResolvedValueOnce([]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    );

    const fallbackTexts = await screen.findAllByText('No prior-week baseline');
    expect(fallbackTexts).toHaveLength(2);
  });

  it('shows failure-signal badges in recent runs overview', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValueOnce([
      withScenarioFailure(makeRun('run-auth', 0, 100, '2026-03-09T12:00:00.000Z'), {
        error:
          'Failed to list tools for server \'trendminer-v1\' after 3 retries. Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token","error_description":"Authentication failed"}'
      }),
      withScenarioFailure(makeRun('run-rate', 0, 120, '2026-03-08T12:00:00.000Z'), {
        error: '429 Too Many Requests',
        failureReasons: ['Scenario error: 429 Too Many Requests']
      })
    ]);
    sourceMock.listRunSummaries.mockResolvedValueOnce([
      makeSummary('run-current', 0.8, 100, '2026-03-09T12:00:00.000Z')
    ]);
    sourceMock.listRunSummaries.mockResolvedValueOnce([
      makeSummary('run-prev', 0.5, 200, '2026-03-02T12:00:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-auth');
    expect(screen.getByText('Auth error')).toBeInTheDocument();
    expect(screen.getByText('Rate limited')).toBeInTheDocument();
  });

  it('shows empty state for Recent Runs when no runs exist in last 30 days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValueOnce([]);
    sourceMock.listRunSummaries.mockResolvedValueOnce([]);
    sourceMock.listRunSummaries.mockResolvedValueOnce([]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('No runs in the past 30 days.')).toBeInTheDocument();
  });
});
