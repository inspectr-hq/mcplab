import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Results from './Results';
import type { WorkspaceRunSummary } from '@/lib/data-sources/types';
import type { EvalResult } from '@/types/eval';

const { sourceMock } = vi.hoisted(() => {
  const listResults = vi.fn();
  const listRunSummaries = vi.fn();
  const deleteResult = vi.fn();
  return {
    sourceMock: {
      listResults,
      listRunSummaries: undefined as unknown as typeof listRunSummaries,
      deleteResult
    }
  };
});

const queueMock = { completionVersion: 0 };

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

vi.mock('@/hooks/use-run-queue-status', () => ({
  useRunQueueStatus: () => queueMock
}));

function makeRun(
  id: string,
  tokenTotal: number | null,
  timestamp = '2026-03-10T10:00:00.000Z'
): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: 'hash',
    timestamp,
    mcpServerVersions: {},
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'Scenario 1',
        agentId: 'agent-1',
        agentName: 'Agent 1',
        runs: [],
        passRate: 1,
        avgToolCalls: 0,
        avgDuration: 0
      }
    ],
    overallPassRate: 1,
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: 1,
    avgLatency: 100,
    toolTokenUsage:
      tokenTotal === null
        ? null
        : {
            inputTokens: Math.floor(tokenTotal / 2),
            outputTokens: tokenTotal - Math.floor(tokenTotal / 2),
            totalTokens: tokenTotal
          }
  };
}

function makeSummary(runId: string, toolTokensTotal: number): WorkspaceRunSummary {
  return {
    runId,
    path: `/tmp/${runId}`,
    timestamp: '2026-03-10T10:00:00.000Z',
    configHash: 'hash',
    scenarioIds: ['scn-1'],
    scenarioNames: ['Scenario 1'],
    totalScenarios: 1,
    totalRuns: 1,
    passRate: 1,
    avgToolCalls: 1,
    avgLatencyMs: 100,
    toolTokensTotal
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

function formatDayLabel(timestamp: string) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes())
  ].join('');
}

describe('Results', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sourceMock.listRunSummaries = undefined as unknown as typeof sourceMock.listRunSummaries;
    localStorage.removeItem('mcplab:results:time-filter');
    queueMock.completionVersion = 0;
  });

  it('opens the global MCP Lab Assistant sidebar from the Results header', async () => {
    sourceMock.listResults.mockResolvedValue([makeRun('run-a', 1200)]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Results');
    fireEvent.click(screen.getByRole('button', { name: 'MCP Lab Assistant' }));
    expect(
      screen.getByPlaceholderText('Ask about historical run differences...')
    ).toBeInTheDocument();
  });

  it('shows the LangSmith trace link in the run actions menu', async () => {
    const run = makeRun('run-with-trace', 1200);
    run.langsmithTraceUrls = {
      'request-1': 'https://eu.smith.langchain.com/public/trace-1'
    };
    sourceMock.listResults.mockResolvedValue([run]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-with-trace');
    const actionsButton = screen.getByRole('button', { name: 'More actions' });
    fireEvent.pointerDown(actionsButton, { button: 0 });
    fireEvent.click(actionsButton);

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      'View',
      'LangSmith trace',
      'Export JSON',
      'Delete'
    ]);
    expect(screen.getByRole('menuitem', { name: 'LangSmith trace' })).toHaveAttribute(
      'href',
      'https://eu.smith.langchain.com/public/trace-1'
    );
  });

  it('reloads the overview when an evaluation completes', async () => {
    sourceMock.listResults.mockResolvedValue([makeRun('run-a', 1200)]);
    const renderResults = () =>
      render(
        <MemoryRouter initialEntries={['/results']}>
          <Routes>
            <Route path="/results" element={<Results />} />
          </Routes>
        </MemoryRouter>
      );

    const view = renderResults();
    await screen.findByText('run-a');

    sourceMock.listResults.mockClear();
    sourceMock.listResults.mockResolvedValue([makeRun('run-b', 900)]);
    queueMock.completionVersion = 1;
    view.rerender(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(sourceMock.listResults).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('run-b')).toBeInTheDocument();
  });

  it('refreshes the dashboard when the results are manually refreshed', async () => {
    sourceMock.listRunSummaries = vi.fn().mockResolvedValue([makeSummary('run-a', 1200)]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-a');
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);

    sourceMock.listRunSummaries.mockResolvedValue([makeSummary('run-b', 900)]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await screen.findByText('run-b');
    await waitFor(() => {
      expect(screen.getAllByText('900').length).toBeGreaterThan(0);
    });
  });

  it('toggles MCP Lab Assistant expand mode in results', async () => {
    sourceMock.listResults.mockResolvedValue([makeRun('run-a', 1200)]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Results');
    fireEvent.click(screen.getByRole('button', { name: 'MCP Lab Assistant' }));
    const expandButton = screen.getByRole('button', { name: /Expand/i });
    fireEvent.click(expandButton);
    expect(screen.getByRole('button', { name: /Compact/i })).toBeInTheDocument();
  });

  it('renders tool token totals and n/a when unavailable', async () => {
    sourceMock.listResults.mockResolvedValue([makeRun('run-a', 1200), makeRun('run-b', null)]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Results');
    expect(screen.getByRole('columnheader', { name: /Tool Tokens/i })).toBeInTheDocument();
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
  });

  it('shows the dashboard by default and persists the visibility preference', async () => {
    localStorage.removeItem('mcplab:results:dashboard-visible');
    sourceMock.listResults.mockResolvedValue([makeRun('run-a', 1200)]);

    const view = render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('results-dashboard')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Hide dashboard' });
    fireEvent.click(toggle);

    expect(screen.queryByTestId('results-dashboard')).not.toBeInTheDocument();
    expect(localStorage.getItem('mcplab:results:dashboard-visible')).toBe('false');

    view.unmount();
    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('button', { name: 'Show dashboard' })).toBeInTheDocument();
    expect(screen.queryByTestId('results-dashboard')).not.toBeInTheDocument();
    localStorage.removeItem('mcplab:results:dashboard-visible');
  });

  it('sorts tool tokens with null values always last', async () => {
    sourceMock.listResults.mockResolvedValue([
      makeRun('run-low', 100),
      makeRun('run-high', 900),
      makeRun('run-null', null)
    ]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-low');
    const sortButton = screen.getByRole('button', { name: /Tool Tokens/i });

    fireEvent.click(sortButton);
    await waitFor(() => {
      const runLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.startsWith('/results/run-'));
      expect(runLinks.map((link) => link.textContent)).toEqual(['run-low', 'run-high', 'run-null']);
    });

    fireEvent.click(sortButton);
    await waitFor(() => {
      const runLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.startsWith('/results/run-'));
      expect(runLinks.map((link) => link.textContent)).toEqual(['run-high', 'run-low', 'run-null']);
    });
  });

  it('surfaces auth and rate-limit failures differently from normal assertion failures', async () => {
    sourceMock.listResults.mockResolvedValue([
      withScenarioFailure(makeRun('run-auth', 1200), {
        error:
          'Failed to list tools for server \'trendminer-v1\' after 3 retries. Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token","error_description":"Authentication failed"}'
      }),
      withScenarioFailure(makeRun('run-rate', 900), {
        error: '429 Too Many Requests',
        failureReasons: ['Scenario error: 429 Too Many Requests']
      }),
      withScenarioFailure(makeRun('run-assert', 800), {
        failureReasons: ['Required tool not used: value_based_search']
      })
    ]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-auth');
    expect(screen.getByText('Auth error')).toBeInTheDocument();
    expect(screen.getByText('Rate limited')).toBeInTheDocument();
    expect(screen.queryByText('Infra error')).not.toBeInTheDocument();
  });

  it('shows day separators between runs from different days', async () => {
    sourceMock.listResults.mockResolvedValue([
      makeRun('run-new', 1200, '2026-03-10T10:10:00.000Z'),
      makeRun('run-old', 900, '2026-03-09T10:10:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-new');
    expect(screen.getByText(formatDayLabel('2026-03-10T10:10:00.000Z'))).toBeInTheDocument();
    expect(screen.getByText(formatDayLabel('2026-03-09T10:10:00.000Z'))).toBeInTheDocument();
  });

  it('filters runs by the Last 15min preset', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T10:15:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValue([
      makeRun('run-fresh', 1200, '2026-03-10T10:10:00.000Z'),
      makeRun('run-old', 900, '2026-03-10T09:30:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/results?time_filter=last&time_preset=15min']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-fresh');
    await waitFor(() => {
      expect(screen.getByText('Last 15min')).toBeInTheDocument();
      const runLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.startsWith('/results/run-'));
      expect(runLinks.map((link) => link.textContent)).toEqual(['run-fresh']);
    });
  });

  it('filters runs by a custom date time range', async () => {
    const insideTimestamp = new Date('2026-03-10T10:10:00.000Z');
    const start = new Date(insideTimestamp.getTime() - 5 * 60 * 1000);
    const end = new Date(insideTimestamp.getTime() + 5 * 60 * 1000);
    sourceMock.listResults.mockResolvedValue([
      makeRun('run-inside', 1200, insideTimestamp.toISOString()),
      makeRun('run-outside', 900, '2026-03-10T09:30:00.000Z')
    ]);

    render(
      <MemoryRouter
        initialEntries={[
          `/results?time_filter=custom&time_start=${toDatetimeLocalValue(
            start
          )}&time_end=${toDatetimeLocalValue(end)}`
        ]}
      >
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-inside');
    fireEvent.click(screen.getAllByRole('combobox')[1]!);

    await waitFor(() => {
      expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe(
        toDatetimeLocalValue(start)
      );
      expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe(
        toDatetimeLocalValue(end)
      );
      const runLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.startsWith('/results/run-'));
      expect(runLinks.map((link) => link.textContent)).toEqual(['run-inside']);
    });
  });

  it('shows empty state when no runs match active time filter', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T10:15:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValue([makeRun('run-old', 900, '2026-03-10T09:30:00.000Z')]);

    render(
      <MemoryRouter initialEntries={['/results?time_filter=last&time_preset=15min']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Results');
    expect(screen.getByText('No runs match current filters.')).toBeInTheDocument();
    const runLinks = screen
      .queryAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/results/run-'));
    expect(runLinks).toHaveLength(0);
  });

  it('removes deleted runs from the dashboard immediately', async () => {
    sourceMock.listRunSummaries = vi.fn().mockResolvedValue([makeSummary('run-a', 1200)]);
    sourceMock.deleteResult.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/results']}>
        <Routes>
          <Route path="/results" element={<Results />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-a');
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);
    const menuButton = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-haspopup') === 'menu');
    expect(menuButton).toBeDefined();
    fireEvent.pointerDown(menuButton!, { button: 0 });
    fireEvent.pointerUp(menuButton!, { button: 0 });
    fireEvent.click(menuButton!);
    fireEvent.click(await screen.findByText('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));

    await waitFor(() => {
      expect(screen.queryByText('1,200')).not.toBeInTheDocument();
    });
    expect(screen.getByText('No results in the selected range.')).toBeInTheDocument();
  });
});
