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
  });

  it('computes WoW deltas for pass rate and latency', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listRunSummaries
      .mockResolvedValueOnce([
        makeSummary('run-30d-a', 0.8, 100, '2026-03-09T12:00:00.000Z'),
        makeSummary('run-30d-b', 0.6, 140, '2026-03-08T12:00:00.000Z')
      ])
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
      expect(sourceMock.listRunSummaries).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('120ms')).toBeInTheDocument();
    expect(screen.getByText(/\+20\.0% from last week/)).toBeInTheDocument();
    expect(screen.getByText(/-80ms from last week/)).toBeInTheDocument();
  });

  it('shows fallback text when previous-week baseline is missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listRunSummaries.mockResolvedValueOnce([
      makeSummary('run-30d', 1, 90, '2026-03-09')
    ]);
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

  it('shows empty state for Recent Runs when no runs exist in last 30 days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T12:00:00.000Z').getTime());
    sourceMock.listRunSummaries.mockResolvedValueOnce([]);
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
