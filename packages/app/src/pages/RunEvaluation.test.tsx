import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RunEvaluation from './RunEvaluation';
import type { EvalConfig, AgentConfig } from '@/types/eval';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let scrollIntoViewSpy: ReturnType<typeof vi.fn> | null = null;
const activeJobStorageKey = 'mcplab.runEvaluation.activeJobId';

const {
  configReloadMock,
  librariesReloadMock,
  sourceMock,
  configsRef,
  libraryAgentsRef,
  libraryLoadingRef,
  queueEventHandlerRef
} = vi.hoisted(() => {
  const getRunQueue = vi.fn().mockResolvedValue({ active: null, queued: [] });
  const configReloadMock = vi.fn();
  const librariesReloadMock = vi.fn();
  const configsRef = { value: [] as EvalConfig[] };
  const libraryAgentsRef = { value: [] as AgentConfig[] };
  const queueEventHandlerRef: { current: ((event: unknown) => void) | null } = { current: null };
  return {
    libraryLoadingRef: { value: false },
    configReloadMock,
    librariesReloadMock,
    configsRef,
    libraryAgentsRef,
    queueEventHandlerRef,
    sourceMock: {
      getWorkspaceSettings: vi
        .fn()
        .mockResolvedValue({ defaultEvaluationAgentName: 'workspace-agent' }),
      getRunQueue,
      getResult: vi.fn(),
      subscribeRunQueue: vi.fn((callback: (event: unknown) => void) => {
        queueEventHandlerRef.current = callback;
        return vi.fn();
      }),
      subscribeRunJob: vi.fn((_jobId: string, _callback: (event: unknown) => void) => () => {}),
      stopRun: vi.fn(),
      removeQueuedRun: vi.fn(),
      removeEvaluationRun: vi.fn().mockResolvedValue(undefined),
      startRun: vi.fn(),
      openRover: vi.fn().mockResolvedValue({ ok: true })
    }
  };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfigs: () => ({
    configs: configsRef.value,
    loading: false,
    getConfig: () => undefined,
    addConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    cloneConfig: vi.fn(),
    reload: configReloadMock
  })
}));

vi.mock('@/contexts/LibraryContext', () => ({
  useLibraries: () => ({
    servers: [],
    agents: libraryAgentsRef.value,
    scenarios: [],
    loading: libraryLoadingRef.value,
    setServers: vi.fn(),
    setAgents: vi.fn(),
    setScenarios: vi.fn(),
    reload: librariesReloadMock
  })
}));

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  scrollIntoViewSpy = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewSpy
  });
  configsRef.value = [];
  libraryAgentsRef.value = [];
  libraryLoadingRef.value = false;
  sourceMock.startRun.mockReset();
  sourceMock.startRun.mockResolvedValue({ jobId: 'job-1' });
  sourceMock.getResult.mockReset().mockResolvedValue(undefined);
  sourceMock.subscribeRunJob.mockReset();
  sourceMock.subscribeRunJob.mockImplementation(() => () => {});
  sourceMock.subscribeRunQueue.mockClear();
  queueEventHandlerRef.current = null;
  sourceMock.stopRun.mockReset();
  sourceMock.openRover.mockClear();
  sourceMock.removeQueuedRun.mockReset();
  sourceMock.removeEvaluationRun.mockClear();
  sessionStorage.removeItem(activeJobStorageKey);
  sourceMock.getRunQueue.mockResolvedValue({
    active: null,
    active_jobs: [],
    admitting_jobs: [],
    queued: []
  });
});

afterEach(() => {
  const actWarnings =
    consoleErrorSpy?.mock.calls.filter(([message]) =>
      String(message).includes('not wrapped in act')
    ) ?? [];
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = null;
  scrollIntoViewSpy = null;
  expect(actWarnings).toHaveLength(0);
});

describe('RunEvaluation', () => {
  it('waits for the library before preselecting an inherited agent', async () => {
    configsRef.value = [
      { id: 'empty', name: 'Empty', agents: [], scenarios: [], createdAt: '', updatedAt: '' }
    ];
    libraryLoadingRef.value = true;
    const view = render(
      <MemoryRouter initialEntries={['/run?configId=empty']}>
        <RunEvaluation />
      </MemoryRouter>
    );
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    libraryAgentsRef.value = [
      {
        id: 'workspace-agent',
        name: 'Workspace Agent',
        provider: 'openai',
        model: 'test',
        temperature: 0,
        maxTokens: 100
      }
    ];
    libraryLoadingRef.value = false;
    view.rerender(
      <MemoryRouter initialEntries={['/run?configId=empty']}>
        <RunEvaluation />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Workspace Agent' })).toBeChecked()
    );
  });
  it('preselects the workspace default for an evaluation without agents', async () => {
    configsRef.value = [
      { id: 'empty', name: 'Empty', agents: [], scenarios: [], createdAt: '', updatedAt: '' }
    ];
    libraryAgentsRef.value = [
      {
        id: 'workspace-agent',
        name: 'Workspace Agent',
        provider: 'openai',
        model: 'test',
        temperature: 0,
        maxTokens: 100
      },
      {
        id: 'other',
        name: 'Other Agent',
        provider: 'openai',
        model: 'test',
        temperature: 0,
        maxTokens: 100
      }
    ];
    render(
      <MemoryRouter initialEntries={['/run?configId=empty']}>
        <RunEvaluation />
      </MemoryRouter>
    );
    expect(await screen.findByText(/Workspace default agent: Workspace Agent/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Workspace Agent' })).toBeChecked()
    );
    expect(screen.getByRole('checkbox', { name: 'Other Agent' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other Agent' }));
    expect(screen.queryByText(/Workspace default agent:/)).not.toBeInTheDocument();
  });
  it('shows the result card when the final attached job completes', async () => {
    sessionStorage.setItem(activeJobStorageKey, 'job-final');
    let onEvent: ((event: any) => void) | undefined;
    sourceMock.subscribeRunJob.mockImplementation((jobId, callback) => {
      if (jobId === 'job-final') onEvent = callback;
      return () => {};
    });
    sourceMock.getRunQueue.mockResolvedValue({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: [],
      evaluations: []
    });
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(onEvent).toBeDefined());
    await act(async () => {
      onEvent?.({
        type: 'completed',
        ts: '2026-10-14T10:00:00.000Z',
        payload: { runId: 'evaluation-final' }
      });
    });

    expect(await screen.findByText('Evaluation Complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Results' })).toHaveAttribute(
      'href',
      '/results/evaluation-final'
    );
  });

  it('shows the result card when a queued evaluation completes while this page is open', async () => {
    const activeEvaluation = {
      evaluationRunId: 'evaluation-queue-complete',
      status: 'running' as const,
      totalJobs: 1,
      completedJobs: 0,
      failedJobs: 0,
      stoppedJobs: 0,
      pausedJobs: 0,
      jobs: [{ jobId: 'job-queue-complete', status: 'running' as const, runParams: {} }]
    };
    sourceMock.getRunQueue
      .mockResolvedValueOnce({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [activeEvaluation]
      })
      .mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: []
      });
    sourceMock.getResult.mockResolvedValue({ id: 'evaluation-queue-complete' });
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(sourceMock.getRunQueue).toHaveBeenCalledTimes(1));
    await act(async () => {
      queueEventHandlerRef.current?.({
        type: 'queue_event',
        ts: '2026-10-14T10:00:00.000Z',
        payload: {
          event: {
            active: null,
            active_jobs: [],
            admitting_jobs: [],
            queued: [],
            evaluations: []
          }
        }
      });
    });

    expect(await screen.findByText('Evaluation Complete')).toBeInTheDocument();
    expect(sourceMock.getResult).toHaveBeenCalledWith('evaluation-queue-complete');
    expect(screen.getByRole('link', { name: 'View Results' })).toHaveAttribute(
      'href',
      '/results/evaluation-queue-complete'
    );
  });

  it('does not show a completion card when a removed evaluation disappears from the queue', async () => {
    const activeEvaluation = {
      evaluationRunId: 'evaluation-removed',
      status: 'queued' as const,
      totalJobs: 1,
      completedJobs: 0,
      failedJobs: 0,
      stoppedJobs: 0,
      pausedJobs: 0,
      jobs: [{ jobId: 'job-removed', status: 'queued' as const, runParams: {} }]
    };
    sourceMock.getRunQueue
      .mockResolvedValueOnce({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [activeEvaluation]
      })
      .mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: []
      });
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(sourceMock.getRunQueue).toHaveBeenCalledTimes(1));
    await act(async () => {
      queueEventHandlerRef.current?.({
        type: 'queue_event',
        ts: '2026-10-14T10:00:00.000Z',
        payload: {
          event: { active: null, active_jobs: [], admitting_jobs: [], queued: [], evaluations: [] }
        }
      });
    });

    await waitFor(() => expect(sourceMock.getResult).toHaveBeenCalledWith('evaluation-removed'));
    expect(screen.queryByText('Evaluation Complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View Results' })).not.toBeInTheDocument();
  });

  it('shows a stopped state instead of success when a stopped evaluation disappears', async () => {
    const activeEvaluation = {
      evaluationRunId: 'evaluation-stopped',
      status: 'running' as const,
      totalJobs: 1,
      completedJobs: 0,
      failedJobs: 0,
      stoppedJobs: 0,
      pausedJobs: 0,
      jobs: [{ jobId: 'job-stopped', status: 'running' as const, runParams: {} }]
    };
    sourceMock.getRunQueue
      .mockResolvedValueOnce({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [activeEvaluation]
      })
      .mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: []
      });
    sourceMock.getResult.mockResolvedValue({
      id: 'evaluation-stopped',
      outcomes: { passed: 1, stopped: 1 }
    });
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(sourceMock.getRunQueue).toHaveBeenCalledTimes(1));
    await act(async () => {
      queueEventHandlerRef.current?.({
        type: 'queue_event',
        ts: '2026-10-14T10:00:00.000Z',
        payload: {
          event: { active: null, active_jobs: [], admitting_jobs: [], queued: [], evaluations: [] }
        }
      });
    });

    expect(await screen.findByText('Run stopped')).toBeInTheDocument();
    expect(screen.queryByText('Evaluation Complete')).not.toBeInTheDocument();
  });

  it('refreshes the visible queue when the server sends a queue event', async () => {
    sourceMock.getRunQueue.mockResolvedValueOnce({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: [],
      evaluations: []
    });
    render(
      <MemoryRouter>
        <RunEvaluation />
      </MemoryRouter>
    );

    await waitFor(() => expect(sourceMock.subscribeRunQueue).toHaveBeenCalledOnce());

    sourceMock.getRunQueue.mockResolvedValue({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: [],
      evaluations: [
        {
          evaluationRunId: 'live-evaluation',
          evaluationName: 'Live evaluation',
          status: 'running',
          totalJobs: 1,
          completedJobs: 0,
          failedJobs: 0,
          stoppedJobs: 0,
          pausedJobs: 0,
          jobs: [{ jobId: 'live-job', status: 'running', runParams: {} }]
        }
      ]
    });
    await act(async () => {
      queueEventHandlerRef.current?.({
        type: 'queue_event',
        payload: { event: {} }
      });
    });

    expect(await screen.findByText('Live evaluation')).toBeInTheDocument();
  });

  it.each(['queued', 'waiting_for_rover', 'running', 'paused_rover'] as const)(
    'keeps Open browser agent available for a %s browser job',
    async (status) => {
      const browserJob = {
        jobId: 'browser-job',
        status,
        executionType: 'rover',
        roverAgent: { name: 'Polo browser', provider: 'polo', url: 'https://polo.example' },
        runParams: { configPath: '/tmp/eval.yaml', runsPerScenario: 1 },
        childProgress: [
          {
            scenarioId: 'search-tags',
            agentName: 'Polo browser',
            completed: 0,
            total: 1,
            status: 'queued'
          }
        ]
      };
      sourceMock.getRunQueue.mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [
          {
            evaluationRunId: 'mixed-run',
            evaluationName: 'Mixed evaluation',
            status:
              status === 'running' ? 'running' : status === 'paused_rover' ? 'paused' : 'queued',
            totalJobs: 2,
            completedJobs: 1,
            failedJobs: 0,
            stoppedJobs: 0,
            pausedJobs: status === 'paused_rover' ? 1 : 0,
            jobs: [
              { jobId: 'api-job', status: 'completed', executionType: 'mcplab', runParams: {} },
              browserJob
            ]
          }
        ]
      });
      render(
        <MemoryRouter initialEntries={['/run']}>
          <RunEvaluation />
        </MemoryRouter>
      );
      const button = await screen.findByRole('button', { name: 'Open browser agent' });
      fireEvent.click(button);
      await waitFor(() => expect(sourceMock.openRover).toHaveBeenCalledWith('browser-job'));
      fireEvent.click(screen.getByRole('button', { name: 'Expand evaluation details' }));
      expect(screen.queryByLabelText('Subjob running')).not.toBeInTheDocument();
      const buttons = screen.getAllByRole('button', { name: 'Open browser agent' });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[1]);
      await waitFor(() => expect(sourceMock.openRover).toHaveBeenCalledTimes(2));
      expect(sourceMock.openRover.mock.calls).toEqual([['browser-job'], ['browser-job']]);
    }
  );

  it('shows the processing icon only for running subjobs', async () => {
    sourceMock.getRunQueue.mockResolvedValue({
      active: null,
      queued: [],
      evaluations: [
        {
          evaluationRunId: 'mixed-run',
          evaluationName: 'Mixed evaluation',
          status: 'running',
          totalJobs: 5,
          completedJobs: 1,
          failedJobs: 1,
          stoppedJobs: 1,
          pausedJobs: 0,
          jobs: [
            {
              jobId: 'api-job',
              status: 'running',
              runParams: {},
              childProgress: ['running', 'queued', 'completed', 'error', 'stopped'].map(
                (status) => ({
                  scenarioId: `${status}-scenario`,
                  agentName: 'Test agent',
                  status,
                  completed: status === 'completed' ? 1 : 0,
                  total: 1
                })
              )
            }
          ]
        }
      ]
    });
    render(
      <MemoryRouter>
        <RunEvaluation />
      </MemoryRouter>
    );
    await screen.findByText('Mixed evaluation');
    fireEvent.click(screen.getByRole('button', { name: 'Expand evaluation details' }));
    const icons = screen.getAllByLabelText('Subjob running');
    expect(icons).toHaveLength(1);
    expect(icons[0].parentElement).toHaveTextContent('running-scenario');
  });

  it('does not offer a browser action for a running API job or a finished browser job', async () => {
    sourceMock.getRunQueue.mockResolvedValue({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: [],
      evaluations: [
        {
          evaluationRunId: 'mixed-run',
          evaluationName: 'Mixed evaluation',
          status: 'running',
          totalJobs: 2,
          completedJobs: 1,
          failedJobs: 0,
          stoppedJobs: 0,
          pausedJobs: 0,
          jobs: [
            { jobId: 'api-job', status: 'running', executionType: 'mcplab', runParams: {} },
            { jobId: 'browser-job', status: 'completed', executionType: 'rover', runParams: {} }
          ]
        }
      ]
    });
    render(
      <MemoryRouter initialEntries={['/run']}>
        <RunEvaluation />
      </MemoryRouter>
    );
    await screen.findByText('Mixed evaluation');
    expect(screen.queryByRole('button', { name: 'Open browser agent' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand evaluation details' }));
    expect(screen.queryByRole('button', { name: 'Open browser agent' })).toBeNull();
    expect(screen.getByLabelText('Subjob running').parentElement).toHaveTextContent('running');
  });

  it('reloads configs and libraries when refresh is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(configReloadMock).toHaveBeenCalled();
    });

    const initialConfigCalls = configReloadMock.mock.calls.length;
    const initialLibraryCalls = librariesReloadMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh configs' }));

    await waitFor(() => {
      expect(configReloadMock).toHaveBeenCalledTimes(initialConfigCalls + 1);
      expect(librariesReloadMock).toHaveBeenCalledTimes(initialLibraryCalls + 1);
    });
  });

  it('shows library-only agents in the agent checklist alongside config agents', async () => {
    const inlineAgent: AgentConfig = {
      id: 'agent-inline',
      name: 'Inline Agent',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0,
      maxTokens: 4096
    };
    const libraryOnlyAgent: AgentConfig = {
      id: 'agent-library-only',
      name: 'Library Only Agent',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0,
      maxTokens: 4096
    };
    const testConfig: EvalConfig = {
      id: 'test-config',
      name: 'Test Config',
      agents: [inlineAgent],
      agentEntries: [{ kind: 'inline', agent: inlineAgent }],
      scenarios: [],
      scenarioEntries: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sourcePath: '/path/to/test.yaml'
    };

    configsRef.value = [testConfig];
    libraryAgentsRef.value = [libraryOnlyAgent];

    render(
      <MemoryRouter initialEntries={['/run?configId=test-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Inline Agent')).toBeInTheDocument();
    });
    expect(screen.getByText('Library Only Agent')).toBeInTheDocument();
  });

  it('selects and clears LLM and browser agents independently', async () => {
    const llmAgent: AgentConfig = {
      id: 'agent-llm',
      name: 'LLM Agent',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0,
      maxTokens: 4096
    };
    const browserAgent: AgentConfig = {
      id: 'agent-browser',
      name: 'Browser Agent',
      type: 'browser',
      provider: 'chatgpt-com',
      model: '',
      maxTokens: 0,
      url: 'https://chatgpt.com'
    };
    configsRef.value = [
      {
        id: 'test-config',
        name: 'Test Config',
        agents: [llmAgent, browserAgent],
        scenarios: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        sourcePath: '/path/to/test.yaml'
      }
    ];

    render(
      <MemoryRouter initialEntries={['/run?configId=test-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'LLM Agent' })).toBeChecked());
    const llmCheckbox = screen.getByRole('checkbox', { name: 'LLM Agent' });
    const browserCheckbox = screen.getByRole('checkbox', { name: 'Browser Agent' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear LLM Agents' }));
    expect(llmCheckbox).not.toBeChecked();
    expect(browserCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Select all LLM Agents' }));
    expect(llmCheckbox).toBeChecked();
    expect(browserCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Browser Agents' }));
    expect(llmCheckbox).toBeChecked();
    expect(browserCheckbox).not.toBeChecked();
  });

  it('defaults the run selection to config-scoped agents instead of all library agents', async () => {
    const configAgentA: AgentConfig = {
      id: 'agent-a',
      name: 'Agent A',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0,
      maxTokens: 4096
    };
    const configAgentB: AgentConfig = {
      id: 'agent-b',
      name: 'Agent B',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0,
      maxTokens: 4096
    };
    const libraryOnlyAgent: AgentConfig = {
      id: 'agent-library-only',
      name: 'Library Only Agent',
      provider: 'azure',
      model: 'gpt-5-mini',
      temperature: 0,
      maxTokens: 4096
    };
    const testConfig: EvalConfig = {
      id: 'test-config',
      name: 'Test Config',
      agents: [configAgentA, configAgentB],
      agentEntries: [
        { kind: 'referenced', ref: 'agent-a' },
        { kind: 'referenced', ref: 'agent-b' }
      ],
      scenarios: [
        {
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Do thing',
          serverIds: [],
          evalRules: [],
          extractRules: []
        }
      ],
      scenarioEntries: [
        {
          kind: 'inline',
          scenario: {
            id: 'scenario-1',
            name: 'Scenario 1',
            prompt: 'Do thing',
            serverIds: [],
            evalRules: [],
            extractRules: []
          }
        }
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sourcePath: '/path/to/test.yaml'
    };

    configsRef.value = [testConfig];
    libraryAgentsRef.value = [configAgentA, configAgentB, libraryOnlyAgent];

    render(
      <MemoryRouter initialEntries={['/run?configId=test-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Agent A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(sourceMock.startRun).toHaveBeenCalledTimes(1);
    });
    expect(sourceMock.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: '/path/to/test.yaml',
        scenarioIds: ['scenario-1'],
        agents: ['agent-a', 'agent-b']
      })
    );
  });

  it('trims referenced agent ids when initializing selected agents', async () => {
    const configAgent: AgentConfig = {
      id: 'agent-a',
      name: 'Agent A',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0,
      maxTokens: 4096
    };
    const testConfig: EvalConfig = {
      id: 'test-config',
      name: 'Test Config',
      agents: [configAgent],
      agentEntries: [{ kind: 'referenced', ref: ' agent-a ' }],
      scenarios: [
        {
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Do thing',
          serverIds: [],
          evalRules: [],
          extractRules: []
        }
      ],
      scenarioEntries: [
        {
          kind: 'inline',
          scenario: {
            id: 'scenario-1',
            name: 'Scenario 1',
            prompt: 'Do thing',
            serverIds: [],
            evalRules: [],
            extractRules: []
          }
        }
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sourcePath: '/path/to/test.yaml'
    };

    configsRef.value = [testConfig];
    libraryAgentsRef.value = [configAgent];

    render(
      <MemoryRouter initialEntries={['/run?configId=test-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Agent A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(sourceMock.startRun).toHaveBeenCalledTimes(1);
    });
    expect(sourceMock.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: ['agent-a']
      })
    );
  });

  it.each([
    { label: 'Start a new conversation', beforeStart: true, betweenScenarios: true },
    { label: 'Continue the same conversation', beforeStart: false, betweenScenarios: false },
    { label: 'Use agent default', beforeStart: undefined, betweenScenarios: undefined }
  ])('logs $label for browser scenarios', async ({ label, beforeStart, betweenScenarios }) => {
    const llmAgent: AgentConfig = {
      id: 'agent-llm',
      name: 'LLM Agent',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0,
      maxTokens: 4096
    };
    const browserAgent: AgentConfig = {
      id: 'agent-browser',
      name: 'Browser Agent',
      type: 'browser',
      provider: 'learned-provider',
      model: '',
      maxTokens: 0,
      url: 'https://chatgpt.com',
      newConversationBetweenScenarios: false
    };
    const scenario = {
      id: 'scenario-1',
      name: 'Scenario 1',
      prompt: 'Do thing',
      serverIds: [],
      evalRules: [],
      extractRules: []
    };
    configsRef.value = [
      {
        id: 'test-config',
        name: 'Test Config',
        agents: [llmAgent, browserAgent],
        scenarios: [scenario],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        sourcePath: '/path/to/test.yaml'
      }
    ];

    render(
      <MemoryRouter initialEntries={['/run?configId=test-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('LLM Agents')).toBeInTheDocument();
      expect(screen.getByText('Browser Agents')).toBeInTheDocument();
      expect(screen.getByText('Conversation behavior')).toBeInTheDocument();
    });
    const varianceInput = screen.getByRole('spinbutton', { name: 'Variance Runs' });
    const browserCheckbox = screen.getByRole('checkbox', { name: 'Browser Agent' });
    fireEvent.click(browserCheckbox);
    expect(varianceInput).toBeEnabled();
    fireEvent.change(varianceInput, { target: { value: '2' } });
    fireEvent.click(browserCheckbox);
    expect(varianceInput).toBeDisabled();
    expect(varianceInput).toHaveValue(1);

    if (label !== 'Use agent default') {
      fireEvent.click(screen.getByRole('combobox', { name: 'Conversation behavior' }));
      fireEvent.click(screen.getByRole('option', { name: label }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(sourceMock.startRun).toHaveBeenCalledTimes(1));
    expect(sourceMock.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: ['agent-llm', 'agent-browser'],
        runsPerScenario: 1
      })
    );
    if (beforeStart === undefined) {
      expect(sourceMock.startRun.mock.calls[0][0]).not.toHaveProperty('newConversationBeforeStart');
    } else {
      expect(sourceMock.startRun.mock.calls[0][0].newConversationBeforeStart).toBe(beforeStart);
    }
    if (betweenScenarios === undefined) {
      expect(sourceMock.startRun.mock.calls[0][0]).not.toHaveProperty(
        'newConversationBetweenScenarios'
      );
    } else {
      expect(sourceMock.startRun.mock.calls[0][0].newConversationBetweenScenarios).toBe(
        betweenScenarios
      );
    }
    expect(screen.getByText(/Config=Test Config mode=/)).toHaveTextContent(
      `newConversationBeforeStart=${beforeStart ?? 'agent_default'} newConversationBetweenScenarios=${betweenScenarios ?? 'agent_default'}`
    );
  });

  it('advances progress for config-declared agent runs', async () => {
    const testConfig: EvalConfig = {
      id: 'test-config',
      name: 'Test Config',
      agents: [
        {
          id: 'agent-a',
          name: 'Agent A',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          temperature: 0,
          maxTokens: 4096
        }
      ],
      scenarios: [
        {
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Do thing',
          serverIds: [],
          evalRules: [],
          extractRules: []
        }
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sourcePath: '/path/to/test.yaml'
    };
    let onEvent: ((event: unknown) => void) | null = null;
    sourceMock.startRun.mockResolvedValueOnce({ jobId: 'job-1' });
    sourceMock.subscribeRunJob.mockImplementationOnce((_jobId, callback) => {
      onEvent = callback;
      return () => {};
    });
    configsRef.value = [testConfig];

    render(
      <MemoryRouter initialEntries={['/run?configId=test-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(sourceMock.subscribeRunJob).toHaveBeenCalledWith('job-1', expect.any(Function));
    });

    await act(async () => {
      onEvent?.({
        type: 'log',
        ts: '2026-06-07T00:00:00.000Z',
        payload: { message: 'Using config-declared agents: agent-a' }
      });
    });

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.firstElementChild).toHaveStyle({ transform: 'translateX(-65%)' });
  });

  it('shows suite path context in config dropdown labels', async () => {
    const configA: EvalConfig = {
      id: 'cfg-a',
      name: 'basic-asset-tags',
      configName: 'basic-asset-tags',
      relativePath: 'suite-a/basic-asset-tags.yaml',
      suitePath: 'suite-a',
      agents: [],
      scenarios: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    };
    const configB: EvalConfig = {
      id: 'cfg-b',
      name: 'basic-asset-tags',
      configName: 'basic-asset-tags',
      relativePath: 'suite-b/basic-asset-tags.yaml',
      suitePath: 'suite-b',
      agents: [],
      scenarios: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    };
    configsRef.value = [configA, configB];

    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox'));
    });

    expect(await screen.findByText('(suite-a)')).toBeInTheDocument();
    expect(await screen.findByText('(suite-b)')).toBeInTheDocument();
  });

  it('renders admitting jobs separately from queued jobs', async () => {
    sourceMock.getRunQueue.mockResolvedValueOnce({
      active: null,
      active_jobs: [],
      admitting_jobs: [
        {
          jobId: 'job-admitting',
          status: 'queued',
          runParams: {
            configPath: '/tmp/eval.yaml',
            runsPerScenario: 1,
            scenarioIds: null,
            agents: null,
            runNote: null,
            serverOverrideAll: null,
            scenarioServerOverrides: null
          }
        }
      ],
      queued: [
        {
          jobId: 'job-queued',
          status: 'queued',
          runParams: {
            configPath: '/tmp/eval-2.yaml',
            runsPerScenario: 1,
            scenarioIds: null,
            agents: null,
            runNote: null,
            serverOverrideAll: null,
            scenarioServerOverrides: null
          }
        }
      ]
    });

    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Starting')).toBeInTheDocument();
      expect(screen.getByText('#1 Queued')).toBeInTheDocument();
    });
  });

  it('highlights only running evaluations and hides stop for queued evaluations', async () => {
    sourceMock.getRunQueue.mockResolvedValue({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: [],
      evaluations: [
        {
          evaluationRunId: 'evaluation-queued',
          evaluationName: 'Queued evaluation',
          status: 'queued',
          totalJobs: 1,
          completedJobs: 0,
          failedJobs: 0,
          stoppedJobs: 0,
          pausedJobs: 0,
          jobs: [
            {
              jobId: 'job-queued',
              status: 'queued',
              runParams: { configPath: '/tmp/eval.yaml', runsPerScenario: 1 }
            }
          ]
        },
        {
          evaluationRunId: 'evaluation-running',
          evaluationName: 'Running evaluation',
          status: 'running',
          totalJobs: 1,
          completedJobs: 0,
          failedJobs: 0,
          stoppedJobs: 0,
          pausedJobs: 0,
          jobs: [
            {
              jobId: 'job-running',
              status: 'running',
              runParams: { configPath: '/tmp/eval-2.yaml', runsPerScenario: 1 }
            }
          ]
        }
      ]
    });

    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    const queued = await screen.findByText('Queued evaluation');
    const queuedCard = queued.closest('div.rounded-md.border');
    expect(queuedCard).toBeTruthy();
    expect(queuedCard).not.toHaveClass('bg-primary/5');
    expect(queuedCard).toHaveTextContent('Remove');
    expect(queuedCard).not.toHaveTextContent('Stop run');
    const queuedActions = Array.from(queuedCard!.querySelectorAll('button')).map((button) =>
      button.textContent?.trim()
    );
    expect(queuedActions.indexOf('Details')).toBeLessThan(queuedActions.indexOf('Remove'));

    const running = screen.getByText('Running evaluation');
    const runningCard = running.closest('div.rounded-md.border');
    expect(runningCard).toHaveClass('bg-primary/5');
    expect(runningCard).toHaveTextContent('Stop run');
    const runningBadge = Array.from(runningCard?.querySelectorAll('div') ?? []).find(
      (node) => node.textContent?.trim() === 'running'
    );
    expect(runningBadge).toHaveClass('bg-emerald-500/15', 'text-emerald-700');
  });

  it.each(['stopped', 'failed', 'partial'] as const)(
    'shows stopped groups but hides finished %s groups from the queue',
    async (status) => {
      sourceMock.getRunQueue.mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [
          {
            evaluationRunId: 'evaluation-stopped',
            evaluationName: 'Stopped LLM evaluation',
            status,
            totalJobs: 1,
            completedJobs: 0,
            failedJobs: 1,
            stoppedJobs: 1,
            pausedJobs: 0,
            jobs: [
              {
                jobId: 'llm-completed',
                status: status === 'stopped' ? 'completed' : 'error',
                executionType: 'mcplab',
                runParams: { configPath: '/tmp/eval.yaml', runsPerScenario: 1, agents: ['LLM'] },
                childProgress: [
                  {
                    scenarioId: 'scenario-1',
                    agentName: 'LLM',
                    completed: 0,
                    total: 1,
                    status: status === 'stopped' ? 'stopped' : 'error'
                  }
                ]
              }
            ]
          }
        ]
      });

      await act(async () => {
        render(
          <MemoryRouter initialEntries={['/run']}>
            <Routes>
              <Route path="/run" element={<RunEvaluation />} />
            </Routes>
          </MemoryRouter>
        );
      });

      await waitFor(() => expect(sourceMock.getRunQueue).toHaveBeenCalled());
      if (status !== 'stopped') {
        await screen.findByText('No active or queued runs. Start a run above.');
        expect(screen.queryByText('Stopped LLM evaluation')).toBeNull();
        return;
      }
      await act(async () => {
        fireEvent.click(
          await screen.findByRole('button', {
            name:
              status === 'stopped'
                ? 'Remove stopped run from queue'
                : 'Remove evaluation from queue'
          })
        );
      });
      expect(sourceMock.removeEvaluationRun).toHaveBeenCalledWith('evaluation-stopped');
    }
  );

  it.each(['error', 'completed', 'stopped'] as const)(
    'shows grouped results after the last child sends %s',
    async (eventType) => {
      sessionStorage.setItem(activeJobStorageKey, 'job-last');
      let onEvent: ((event: any) => void) | undefined;
      sourceMock.subscribeRunJob.mockImplementation((jobId, callback) => {
        if (jobId === 'job-last') onEvent = callback;
        return () => {};
      });
      sourceMock.getRunQueue.mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [
          {
            evaluationRunId: 'evaluation-mixed',
            evaluationName: 'Mixed result group',
            status: 'partial',
            totalJobs: eventType === 'stopped' ? 3 : 2,
            completedJobs: 1,
            failedJobs: eventType === 'stopped' ? 2 : 1,
            stoppedJobs: eventType === 'stopped' ? 1 : 0,
            pausedJobs: 0,
            jobs: [
              {
                jobId: 'job-last',
                status:
                  eventType === 'stopped'
                    ? 'stopped'
                    : eventType === 'error'
                      ? 'error'
                      : 'completed',
                runParams: {}
              },
              {
                jobId: 'job-other',
                status: eventType === 'error' ? 'completed' : 'error',
                runParams: {}
              },
              ...(eventType === 'stopped'
                ? [{ jobId: 'job-completed', status: 'completed', runParams: {} }]
                : [])
            ]
          }
        ]
      });
      render(
        <MemoryRouter initialEntries={['/run']}>
          <Routes>
            <Route path="/run" element={<RunEvaluation />} />
          </Routes>
        </MemoryRouter>
      );
      await waitFor(() => expect(onEvent).toBeDefined());
      await act(async () => {
        onEvent?.({
          type: eventType === 'stopped' ? 'error' : eventType,
          ts: '2026-10-09T00:18:28.000Z',
          payload:
            eventType === 'stopped'
              ? { status: 'stopped', message: 'Run stopped by user' }
              : eventType === 'error'
                ? { message: 'MCP connection failed' }
                : { runId: 'evaluation-mixed' }
        });
      });
      expect(await screen.findByText('Completed with errors')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View Results' })).toHaveAttribute(
        'href',
        '/results/evaluation-mixed'
      );
      expect(screen.getByText('100%')).toBeInTheDocument();
      expect(screen.queryByText('Mixed result group')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
      expect(sessionStorage.getItem(activeJobStorageKey)).toBeNull();
    }
  );

  it.each([
    'completed',
    'legacy-stop',
    'structured-stop',
    'queue-stop',
    'group-stop',
    'lookup-failed',
    'fully-stopped',
    'fully-stopped-results'
  ])(
    'shows stopped completion separately from errors and keeps grouped results (%s)',
    async (eventType) => {
      sessionStorage.setItem(activeJobStorageKey, 'job-last');
      let onEvent: ((event: any) => void) | undefined;
      sourceMock.subscribeRunJob.mockImplementation((jobId, callback) => {
        if (jobId === 'job-last') onEvent = callback;
        return () => {};
      });
      sourceMock.getRunQueue.mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [
          {
            evaluationRunId: 'evaluation-mixed',
            evaluationName: 'Mixed result group',
            status: 'stopped',
            totalJobs: 2,
            completedJobs: eventType.startsWith('fully-stopped') ? 0 : 1,
            failedJobs: eventType.startsWith('fully-stopped') ? 2 : 1,
            stoppedJobs: eventType.startsWith('fully-stopped') ? 2 : 1,
            pausedJobs: 0,
            jobs: [
              {
                jobId: 'job-last',
                status:
                  eventType === 'queue-stop' || eventType.startsWith('fully-stopped')
                    ? 'stopped'
                    : 'completed',
                runParams: {}
              },
              {
                jobId: 'job-other',
                status: 'stopped',
                runParams: {}
              }
            ]
          }
        ]
      });
      render(
        <MemoryRouter initialEntries={['/run']}>
          <Routes>
            <Route path="/run" element={<RunEvaluation />} />
          </Routes>
        </MemoryRouter>
      );
      await waitFor(() => expect(onEvent).toBeDefined());
      if (eventType === 'lookup-failed')
        sourceMock.getRunQueue.mockRejectedValueOnce(new Error('Offline'));
      await act(async () => {
        onEvent?.({
          type: eventType === 'completed' ? 'completed' : 'error',
          ts: '2026-10-09T00:18:28.000Z',
          payload:
            eventType === 'completed'
              ? { runId: 'evaluation-mixed' }
              : eventType === 'structured-stop'
                ? { status: 'stopped', message: 'Cancelled' }
                : eventType === 'queue-stop' || eventType === 'group-stop'
                  ? { message: 'Cancelled elsewhere' }
                  : {
                      message: 'Run stopped by user',
                      ...(eventType === 'fully-stopped-results'
                        ? { runId: 'evaluation-mixed' }
                        : {})
                    }
        });
      });
      if (eventType === 'lookup-failed') {
        expect(await screen.findByText('Run stopped')).toBeInTheDocument();
        expect(screen.queryByText('Evaluation Complete')).toBeNull();
        expect(screen.queryByText(/Error:.*Run stopped/)).toBeNull();
        return;
      }
      if (eventType.startsWith('fully-stopped')) {
        expect(await screen.findByText('Run stopped')).toBeInTheDocument();
        expect(screen.queryByText('Completed with stopped scenarios')).toBeNull();
        expect(screen.queryByRole('link', { name: 'View Runs' })).toBeNull();
        if (eventType === 'fully-stopped-results') {
          expect(screen.getByRole('link', { name: 'View Results' })).toHaveAttribute(
            'href',
            '/results/evaluation-mixed'
          );
        } else {
          expect(screen.queryByRole('link', { name: 'View Results' })).toBeNull();
        }
        return;
      }
      expect(await screen.findByText('Completed with stopped scenarios')).toBeInTheDocument();
      expect(screen.queryByText('Completed with errors')).toBeNull();
      expect(screen.queryByText(/Error:.*(Cancelled|Run stopped)/)).toBeNull();
      expect(
        screen.getByText('2/2 finished, 1 completed, 0 error(s), 1 stopped.')
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View Results' })).toHaveAttribute(
        'href',
        '/results/evaluation-mixed'
      );
      expect(screen.getByText('100%')).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
      expect(sessionStorage.getItem(activeJobStorageKey)).toBeNull();
    }
  );

  it('does not show the global OAuth banner for a different blocked queued job during reattach', async () => {
    sessionStorage.setItem(activeJobStorageKey, 'job-running');
    sourceMock.getRunQueue.mockResolvedValueOnce({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: [
        {
          jobId: 'job-blocked',
          status: 'blocked_auth',
          blockedReason: 'oauth_required',
          requiredServers: ['srv-1776925640074'],
          runParams: {
            configPath: '/tmp/eval.yaml',
            runsPerScenario: 1,
            scenarioIds: null,
            agents: null,
            runNote: null,
            serverOverrideAll: null,
            scenarioServerOverrides: null
          }
        }
      ]
    });

    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Reattached to in-progress evaluation run/)).toBeInTheDocument();
      expect(screen.getByText('Connect & Resume')).toBeInTheDocument();
    });

    expect(screen.queryByText(/OAuth required for:/)).not.toBeInTheDocument();
  });

  it.each(['completed', 'error'] as const)(
    'continues after %s when the remaining child needs OAuth',
    async (eventType) => {
      sessionStorage.setItem(activeJobStorageKey, 'job-finished');
      let onEvent:
        | ((event: { type: string; ts: string; payload: Record<string, unknown> }) => void)
        | undefined;
      sourceMock.subscribeRunJob.mockImplementation((jobId, callback) => {
        if (jobId === 'job-finished') onEvent = callback;
        return () => {};
      });
      sourceMock.getRunQueue.mockResolvedValue({
        active: null,
        active_jobs: [],
        admitting_jobs: [],
        queued: [],
        evaluations: [
          {
            evaluationRunId: 'evaluation-1',
            evaluationName: 'Mixed evaluation',
            status: 'blocked_auth',
            totalJobs: 2,
            completedJobs: 1,
            failedJobs: 0,
            stoppedJobs: 0,
            pausedJobs: 0,
            jobs: [
              {
                jobId: 'job-finished',
                status: 'completed',
                runParams: { configPath: '/tmp/eval.yaml', runsPerScenario: 1 }
              },
              {
                jobId: 'job-blocked',
                status: 'blocked_auth',
                runParams: { configPath: '/tmp/eval.yaml', runsPerScenario: 1 }
              }
            ]
          }
        ]
      });

      render(
        <MemoryRouter initialEntries={['/run']}>
          <Routes>
            <Route path="/run" element={<RunEvaluation />} />
          </Routes>
        </MemoryRouter>
      );
      await waitFor(() => expect(onEvent).toBeDefined());
      await act(async () => {
        onEvent?.({
          type: eventType,
          ts: '2026-09-28T10:00:00.000Z',
          payload: { runId: 'evaluation-1' }
        });
      });

      await waitFor(() => {
        expect(sourceMock.subscribeRunJob).toHaveBeenCalledWith(
          'job-blocked',
          expect.any(Function)
        );
      });
      expect(sessionStorage.getItem(activeJobStorageKey)).toBe('job-blocked');
      expect(screen.queryByText(/Run completed\./)).toBeNull();
    }
  );
});
