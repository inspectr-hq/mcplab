import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Compare from './Compare';
import type { EvalResult } from '@/types/eval';

const { sourceMock } = vi.hoisted(() => {
  const listResults = vi.fn();
  return {
    sourceMock: {
      listResults
    }
  };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

function makeRun(id: string, scenarios: EvalResult['scenarios']): EvalResult {
  return {
    id,
    configId: `cfg-${id}`,
    configHash: 'hash',
    timestamp: '2026-03-10T10:00:00.000Z',
    mcpServerVersions: {},
    scenarios,
    overallPassRate: 1,
    totalScenarios: scenarios.length,
    totalRuns: scenarios.reduce((sum, s) => sum + s.runs.length, 0),
    avgToolCalls: 1,
    avgLatency: 100
  };
}

function makeRunAt(
  id: string,
  timestamp: string,
  scenarios: EvalResult['scenarios'] = [
    {
      scenarioId: 'scn-1',
      scenarioName: 'Scenario 1',
      agentId: 'agent-a',
      agentName: 'Agent A',
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 100,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [],
          finalAnswer: 'ok',
          conversation: [],
          duration: 100,
          extractedValues: {},
          failureReasons: []
        }
      ]
    }
  ]
): EvalResult {
  return {
    ...makeRun(id, scenarios),
    timestamp
  };
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

function formatDayLabel(timestamp: string) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

const baseResults: EvalResult[] = [
  makeRun('run-1', [
    {
      scenarioId: 'scn-1',
      scenarioName: 'Scenario 1',
      agentId: 'agent-a',
      agentName: 'Agent A',
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 100,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [
            { name: 'search', arguments: {}, duration: 100, timestamp: '2026-03-10T10:00:01.000Z' }
          ],
          finalAnswer: 'ok',
          conversation: [],
          duration: 100,
          extractedValues: {},
          failureReasons: []
        }
      ]
    },
    {
      scenarioId: 'scn-1',
      scenarioName: 'Scenario 1',
      agentId: 'agent-b',
      agentName: 'Agent B',
      passRate: 0,
      avgToolCalls: 2,
      avgDuration: 220,
      runs: [
        {
          runIndex: 0,
          passed: false,
          toolCalls: [
            { name: 'search', arguments: {}, duration: 120, timestamp: '2026-03-10T10:00:02.000Z' },
            { name: 'fetch', arguments: {}, duration: 100, timestamp: '2026-03-10T10:00:03.000Z' }
          ],
          finalAnswer: 'failed',
          conversation: [],
          duration: 220,
          extractedValues: {},
          failureReasons: ['no match']
        }
      ]
    }
  ]),
  makeRun('run-2', [
    {
      scenarioId: 'scn-1',
      scenarioName: 'Scenario 1',
      agentId: 'agent-b',
      agentName: 'Agent B',
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 120,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [
            { name: 'search', arguments: {}, duration: 120, timestamp: '2026-03-10T10:00:04.000Z' }
          ],
          finalAnswer: 'ok',
          conversation: [],
          duration: 120,
          extractedValues: {},
          failureReasons: []
        }
      ]
    },
    {
      scenarioId: 'scn-2',
      scenarioName: 'Scenario 2',
      agentId: 'agent-a',
      agentName: 'Agent A',
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 110,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [
            { name: 'search', arguments: {}, duration: 110, timestamp: '2026-03-10T10:00:05.000Z' }
          ],
          finalAnswer: 'ok',
          conversation: [],
          duration: 110,
          extractedValues: {},
          failureReasons: []
        }
      ]
    }
  ])
];

const mixedAgentCountResults: EvalResult[] = [
  ...baseResults,
  makeRun('run-3', [
    {
      scenarioId: 'scn-3',
      scenarioName: 'Scenario 3',
      agentId: 'agent-solo',
      agentName: 'Agent Solo',
      passRate: 1,
      avgToolCalls: 1,
      avgDuration: 80,
      runs: [
        {
          runIndex: 0,
          passed: true,
          toolCalls: [
            { name: 'search', arguments: {}, duration: 80, timestamp: '2026-03-10T10:00:06.000Z' }
          ],
          finalAnswer: 'ok',
          conversation: [],
          duration: 80,
          extractedValues: {},
          failureReasons: []
        }
      ]
    }
  ])
];

describe('Compare', () => {
  const LocationProbe = () => {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
  };
  it('switches to Within One Run mode and renders side-by-side comparison', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Compare Runs');
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare agents' })[0]!);

    await waitFor(() => {
      expect(screen.getByText('Within One Run Controls')).toBeInTheDocument();
      expect(screen.getByText('Agent Summary')).toBeInTheDocument();
      expect(screen.getByText('Scenario × Agent Matrix')).toBeInTheDocument();
      expect(screen.getAllByText('Agent A').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Agent B').length).toBeGreaterThan(0);
    });
  });

  it('hydrates from URL params for within-run mode and shows sparse cells as em-dash', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter
        initialEntries={['/compare?mode=within-run&runId=run-2&agents=agent-b,agent-a']}
      >
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Scenario × Agent Matrix');
    expect(screen.getByText('Scenario 1')).toBeInTheDocument();
    expect(screen.getByText('Scenario 2')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('gracefully falls back when URL params are invalid', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={['/compare?mode=within-run&runId=missing&agents=unknown']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Agent Summary');
    expect(screen.getByText('Scenario × Agent Matrix')).toBeInTheDocument();
  });

  it('shows Compare agents action only for runs with multiple agents', async () => {
    sourceMock.listResults.mockResolvedValue(mixedAgentCountResults);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-3');
    expect(screen.getAllByRole('button', { name: 'Compare agents' })).toHaveLength(2);
  });

  it('starts within-run compare directly from the run list action', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare agents' })[0]!);

    await waitFor(() => {
      expect(screen.getByText('Within One Run Controls')).toBeInTheDocument();
      expect(screen.getByText('Agent Summary')).toBeInTheDocument();
      expect(screen.getByText('Scenario × Agent Matrix')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Compare full results' })).toBeInTheDocument();
    });
  });

  it('builds a side-by-side full results link for exactly two selected agents', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare agents' })[0]!);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Compare full results' });
      expect(link).toHaveAttribute(
        'href',
        '/compare/results?left=run-1&right=run-1&leftConfig=cfg-run-1&rightConfig=cfg-run-1&leftAgent=agent-a&rightAgent=agent-b'
      );
    });
  });

  it('keeps provider and model metadata from the same scenario row', async () => {
    sourceMock.listResults.mockResolvedValue([
      makeRun('run-mixed', [
        {
          scenarioId: 'scn-1',
          scenarioName: 'Scenario 1',
          agentId: 'agent-a',
          agentName: 'Agent A',
          provider: 'anthropic',
          passRate: 1,
          avgToolCalls: 1,
          avgDuration: 100,
          runs: [
            {
              runIndex: 0,
              passed: true,
              toolCalls: [
                {
                  name: 'search',
                  arguments: {},
                  duration: 100,
                  timestamp: '2026-03-10T10:00:01.000Z'
                }
              ],
              finalAnswer: 'ok',
              conversation: [],
              duration: 100,
              extractedValues: {},
              failureReasons: []
            }
          ]
        },
        {
          scenarioId: 'scn-2',
          scenarioName: 'Scenario 2',
          agentId: 'agent-a',
          agentName: 'Agent A',
          provider: 'openai',
          model: 'gpt-4',
          passRate: 1,
          avgToolCalls: 1,
          avgDuration: 110,
          runs: [
            {
              runIndex: 0,
              passed: true,
              toolCalls: [
                {
                  name: 'search',
                  arguments: {},
                  duration: 110,
                  timestamp: '2026-03-10T10:00:02.000Z'
                }
              ],
              finalAnswer: 'ok',
              conversation: [],
              duration: 110,
              extractedValues: {},
              failureReasons: []
            }
          ]
        },
        {
          scenarioId: 'scn-1',
          scenarioName: 'Scenario 1',
          agentId: 'agent-b',
          agentName: 'Agent B',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          passRate: 1,
          avgToolCalls: 1,
          avgDuration: 90,
          runs: [
            {
              runIndex: 0,
              passed: true,
              toolCalls: [
                {
                  name: 'search',
                  arguments: {},
                  duration: 90,
                  timestamp: '2026-03-10T10:00:03.000Z'
                }
              ],
              finalAnswer: 'ok',
              conversation: [],
              duration: 90,
              extractedValues: {},
              failureReasons: []
            }
          ]
        }
      ])
    ]);

    render(
      <MemoryRouter
        initialEntries={['/compare?mode=within-run&runId=run-mixed&agents=agent-a,agent-b']}
      >
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Agent Summary');
    expect(screen.getAllByText(/OpenAI · gpt-4/)).toHaveLength(2);
    expect(screen.queryByText(/Anthropic · gpt-4/)).not.toBeInTheDocument();
  });

  it('shows the MCP badge and check counts in the run selection table', async () => {
    const run = makeRunAt('run-with-metadata', '2026-03-10T10:00:00.000Z');
    run.configName = 'MCPLab full tool suite';
    run.configPath = '/workspace/mcplab/mcplab-full-tool-suite.yaml';
    run.mcpServerVersions = { 'mcp-lab': '1.8.3' };
    run.checkCounts = { passed: 3, failed: 1, not_evaluated: 0, total: 4 };
    sourceMock.listResults.mockResolvedValue([run]);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-with-metadata');
    const runCell = screen.getByText('run-with-metadata').closest('td');
    expect(runCell).not.toBeNull();
    expect(within(runCell!).getByText('MCPLab full tool suite')).toBeInTheDocument();
    expect(screen.queryByText(/mcplab-full-tool-suite\.yaml/)).not.toBeInTheDocument();
    expect(document.body.textContent).toContain('mcp-lab@1.8.3');
    expect(screen.getByText('3 ✓')).toBeInTheDocument();
    expect(screen.getByText('1 ✕')).toBeInTheDocument();
  });

  it('shows evaluation names with their paths available on hover in comparison summaries', async () => {
    const left = makeRunAt('run-left', '2026-03-10T10:00:00.000Z');
    left.configName = 'Search evaluation';
    left.configPath = '/workspace/evals/search.yaml';
    const right = makeRunAt('run-right', '2026-03-10T09:00:00.000Z');
    right.configName = 'Tag evaluation';
    right.configPath = '/workspace/evals/tag.yaml';
    sourceMock.listResults.mockResolvedValue([left, right]);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-left');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    await screen.findByText('Summary Comparison');
    const evaluationLabels = screen.getAllByText('Search evaluation');
    expect(evaluationLabels.length).toBeGreaterThan(0);
    const summaryLabel = evaluationLabels.find((label) =>
      label.className.includes('text-[10px]')
    );
    expect(summaryLabel).toBeDefined();
    expect(summaryLabel).toHaveAttribute('title', '/workspace/evals/search.yaml');
    expect(screen.getAllByText('Tag evaluation').length).toBeGreaterThan(0);
  });

  it('filters runs mode by Last 15min preset', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T10:15:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValue([
      makeRunAt('run-fresh', '2026-03-10T10:10:00.000Z'),
      makeRunAt('run-old', '2026-03-10T09:30:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/compare?time_filter=last&time_preset=15min']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-fresh');
    expect(screen.queryByText('run-old')).not.toBeInTheDocument();
    expect(screen.getByText('Last 15min')).toBeInTheDocument();
  });

  it('supports the Last 4 hours preset', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-10T10:00:00.000Z').getTime());
    sourceMock.listResults.mockResolvedValue([
      makeRunAt('run-in-window', '2026-03-10T07:00:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/compare?time_filter=last&time_preset=4h']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-in-window');
    expect(screen.getByText('Last 4 hours')).toBeInTheDocument();
  });

  it('filters runs mode by custom datetime range', async () => {
    const insideTimestamp = new Date('2026-03-10T10:10:00.000Z');
    const start = new Date(insideTimestamp.getTime() - 5 * 60 * 1000);
    const end = new Date(insideTimestamp.getTime() + 5 * 60 * 1000);
    sourceMock.listResults.mockResolvedValue([
      makeRunAt('run-inside', insideTimestamp.toISOString()),
      makeRunAt('run-outside', '2026-03-10T09:30:00.000Z')
    ]);

    render(
      <MemoryRouter
        initialEntries={[
          `/compare?time_filter=custom&time_start=${toDatetimeLocalValue(
            start
          )}&time_end=${toDatetimeLocalValue(end)}`
        ]}
      >
        <Routes>
          <Route path="/compare" element={<Compare />} />
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
    });
    expect(screen.queryByText('run-outside')).not.toBeInTheDocument();
  });

  it('clears time filter query params when reset to all time', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter initialEntries={['/compare?time_filter=last&time_preset=24h']}>
        <Routes>
          <Route
            path="/compare"
            element={
              <>
                <Compare />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-1');
    fireEvent.click(screen.getAllByRole('combobox')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));

    await waitFor(() => {
      const search = screen.getByTestId('location-search').textContent ?? '';
      expect(search).not.toContain('time_filter=');
      expect(search).not.toContain('time_preset=');
      expect(search).not.toContain('time_start=');
      expect(search).not.toContain('time_end=');
    });
  });

  it('ignores time params in within-run mode and keeps within-run UI', async () => {
    sourceMock.listResults.mockResolvedValue(baseResults);

    render(
      <MemoryRouter
        initialEntries={[
          '/compare?mode=within-run&runId=run-1&agents=agent-a,agent-b&time_filter=last&time_preset=15min'
        ]}
      >
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Within One Run Controls');
    expect(screen.queryByText('Date and time filter')).not.toBeInTheDocument();
    expect(screen.getByText('Scenario × Agent Matrix')).toBeInTheDocument();
  });

  it('toggles day separators in runs table', async () => {
    sourceMock.listResults.mockResolvedValue([
      makeRunAt('run-new', '2026-03-10T10:10:00.000Z'),
      makeRunAt('run-old', '2026-03-09T10:10:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-new');
    expect(screen.queryByText(formatDayLabel('2026-03-10T10:10:00.000Z'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Group by day' }));

    expect(screen.getByText(formatDayLabel('2026-03-10T10:10:00.000Z'))).toBeInTheDocument();
    expect(screen.getByText(formatDayLabel('2026-03-09T10:10:00.000Z'))).toBeInTheDocument();
  });

  it('restores day separator toggle state from localStorage', async () => {
    window.localStorage.setItem('mcplab.compare.showDaySeparators', '1');
    sourceMock.listResults.mockResolvedValue([
      makeRunAt('run-new', '2026-03-10T10:10:00.000Z'),
      makeRunAt('run-old', '2026-03-09T10:10:00.000Z')
    ]);

    render(
      <MemoryRouter initialEntries={['/compare']}>
        <Routes>
          <Route path="/compare" element={<Compare />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('run-new');
    expect(screen.getByRole('switch', { name: 'Group by day' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByText(formatDayLabel('2026-03-10T10:10:00.000Z'))).toBeInTheDocument();
  });
});
