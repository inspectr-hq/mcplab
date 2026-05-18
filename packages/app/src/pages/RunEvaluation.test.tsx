import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import RunEvaluation from './RunEvaluation';
import type { EvalConfig, AgentConfig } from '@/types/eval';

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
        subscribeRunJob: vi.fn(() => () => {}),
        stopRun: vi.fn(),
        removeQueuedRun: vi.fn(),
        startRun: vi.fn(),
        createSnapshotFromRun: vi.fn()
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
  configsRef.value = [];
  libraryAgentsRef.value = [];
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

    fireEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('(suite-a)')).toBeInTheDocument();
    expect(screen.getByText('(suite-b)')).toBeInTheDocument();
  });
});
