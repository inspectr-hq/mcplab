import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RunEvaluation from './RunEvaluation';
import type { EvalConfig, AgentConfig } from '@/types/eval';
import { invokeGlobalCopilotAction } from '@/lib/global-copilot-actions';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let scrollIntoViewSpy: ReturnType<typeof vi.fn> | null = null;
const activeJobStorageKey = 'mcplab.runEvaluation.activeJobId';

const { configReloadMock, librariesReloadMock, sourceMock, configsRef, libraryAgentsRef } =
  vi.hoisted(() => {
    const getRunQueue = vi.fn().mockResolvedValue({ active: null, queued: [] });
    const configReloadMock = vi.fn();
    const librariesReloadMock = vi.fn();
    const configsRef = { value: [] as EvalConfig[] };
    const libraryAgentsRef = { value: [] as AgentConfig[] };
    return {
      configReloadMock,
      librariesReloadMock,
      configsRef,
      libraryAgentsRef,
      sourceMock: {
        getRunQueue,
        subscribeRunJob: vi.fn((_jobId: string, _callback: (event: unknown) => void) => () => {}),
        stopRun: vi.fn(),
        removeQueuedRun: vi.fn(),
        startRun: vi.fn()
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
    loading: false,
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
  sourceMock.startRun.mockReset();
  sourceMock.startRun.mockResolvedValue({ jobId: 'job-1' });
  sourceMock.subscribeRunJob.mockReset();
  sourceMock.subscribeRunJob.mockImplementation(() => () => {});
  sourceMock.stopRun.mockReset();
  sourceMock.removeQueuedRun.mockReset();
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

  it('queues a confirmed Copilot run through the same page action with agent overrides', async () => {
    const configAgent: AgentConfig = {
      id: 'agent-default',
      name: 'Default Agent',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0,
      maxTokens: 4096
    };
    const overrideAgent: AgentConfig = {
      id: 'azure-deepseek-v4-flash',
      name: 'DeepSeek',
      provider: 'azure',
      model: 'deepseek-v4-flash',
      temperature: 0,
      maxTokens: 4096
    };
    const testConfig: EvalConfig = {
      id: 'tag-profile-config',
      name: 'Tag Profile',
      agents: [configAgent],
      scenarios: [
        {
          id: 'tag-profile',
          name: 'Tag Profile',
          prompt: 'Profile the tag.',
          serverIds: [],
          evalRules: [],
          extractRules: []
        }
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sourcePath: '/path/to/tag-profile.yaml'
    };
    configsRef.value = [testConfig];
    libraryAgentsRef.value = [configAgent, overrideAgent];

    render(
      <MemoryRouter initialEntries={['/run?configId=tag-profile-config']}>
        <Routes>
          <Route path="/run" element={<RunEvaluation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeInTheDocument());

    await act(async () => {
      await invokeGlobalCopilotAction('queue_evaluation_run', {
        configId: 'tag-profile-config',
        agentIds: ['azure-deepseek-v4-flash'],
        scenarioIds: ['tag-profile'],
        runsPerScenario: 2
      });
    });

    expect(sourceMock.startRun).toHaveBeenCalledWith({
      configPath: '/path/to/tag-profile.yaml',
      agents: ['azure-deepseek-v4-flash'],
      scenarioIds: ['tag-profile'],
      runsPerScenario: 2,
      runNote: undefined
    });
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
    let onEvent: ((event: any) => void) | null = null;
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
});
