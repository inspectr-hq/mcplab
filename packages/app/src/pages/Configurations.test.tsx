import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Configurations from './Configurations';
import type { EvalConfig } from '@/types/eval';

const { configsRef, reloadMock, sourceMock, toastMock } = vi.hoisted(() => ({
  configsRef: { value: [] as EvalConfig[] },
  reloadMock: vi.fn(),
  sourceMock: {
    startRun: vi.fn().mockResolvedValue({ jobId: 'job-1' })
  },
  toastMock: vi.fn()
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfigs: () => ({
    configs: configsRef.value,
    deleteConfig: vi.fn(),
    cloneConfig: vi.fn(),
    loading: false,
    reload: reloadMock
  })
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args)
}));

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

describe('Configurations suites', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    reloadMock.mockClear();
    sourceMock.startRun.mockClear();
    toastMock.mockClear();
    configsRef.value = [
      {
        id: 'cfg-1',
        name: 'Root Config',
        suitePath: '',
        relativePath: 'root.yaml',
        sourcePath: '/path/root.yaml',
        agents: [
          {
            id: 'root-agent',
            name: 'Root Agent',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            temperature: 0,
            maxTokens: 4096
          }
        ],
        agentEntries: [{ kind: 'referenced', ref: 'root-agent' }],
        scenarios: [],
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:00:00.000Z'
      },
      {
        id: 'cfg-2',
        name: 'Tag Search',
        suitePath: 'trendminer/tags',
        relativePath: 'trendminer/tags/tag-search.yaml',
        sourcePath: '/path/trendminer/tags/tag-search.yaml',
        agents: [
          {
            id: 'claude-sonnet-46',
            name: 'Claude Sonnet 4.6',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            temperature: 0,
            maxTokens: 4096
          }
        ],
        agentEntries: [{ kind: 'referenced', ref: 'claude-sonnet-46' }],
        scenarios: [],
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:00:00.000Z'
      },
      {
        id: 'cfg-3',
        name: 'Alert Check',
        suitePath: 'trendminer/alerts',
        relativePath: 'trendminer/alerts/alert-check.yaml',
        sourcePath: '/path/trendminer/alerts/alert-check.yaml',
        agents: [
          {
            id: 'agent-a',
            name: 'Agent A',
            provider: 'openai',
            model: 'gpt-4o-mini',
            temperature: 0,
            maxTokens: 4096
          },
          {
            id: 'agent-b',
            name: 'Agent B',
            provider: 'azure',
            model: 'gpt-5-mini',
            temperature: 0,
            maxTokens: 4096
          }
        ],
        agentEntries: [
          { kind: 'referenced', ref: 'agent-a' },
          { kind: 'referenced', ref: 'agent-b' }
        ],
        runDefaults: { selectedAgentNames: ['agent-b'] },
        scenarios: [],
        createdAt: '2026-04-23T08:00:00.000Z',
        updatedAt: '2026-04-23T08:00:00.000Z'
      }
    ];
  });

  it('renders grouped suite headers including root bucket', async () => {
    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations']}
      >
        <Routes>
          <Route path="/mcp-evaluations" element={<Configurations />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
    expect(screen.getAllByText('(root)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('trendminer/tags').length).toBeGreaterThan(0);
    expect(screen.getAllByText('trendminer/alerts').length).toBeGreaterThan(0);
  });

  it('filters configs by suite selection', async () => {
    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations']}
      >
        <Routes>
          <Route path="/mcp-evaluations" element={<Configurations />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (node) => node.textContent?.trim() === 'trendminer/tags'
    ) as HTMLElement | undefined;
    expect(option).toBeDefined();
    fireEvent.click(option!);

    expect(screen.getByText('Tag Search')).toBeInTheDocument();
    expect(screen.queryByText('Root Config')).not.toBeInTheDocument();
    expect(screen.queryByText('Alert Check')).not.toBeInTheDocument();
  });

  it('filters configs by parent suite including nested sublevels', async () => {
    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations']}
      >
        <Routes>
          <Route path="/mcp-evaluations" element={<Configurations />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (node) => node.textContent?.trim() === 'trendminer'
    ) as HTMLElement | undefined;
    expect(option).toBeDefined();
    fireEvent.click(option!);

    expect(screen.getByText('Tag Search')).toBeInTheDocument();
    expect(screen.getByText('Alert Check')).toBeInTheDocument();
    expect(screen.queryByText('Root Config')).not.toBeInTheDocument();
  });

  it('queues all configs in a suite when Run Suite is clicked', async () => {
    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations']}
      >
        <Routes>
          <Route path="/mcp-evaluations" element={<Configurations />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
    const suiteHeader = screen.getByLabelText('Collapse suite trendminer/tags').closest('tr');
    expect(suiteHeader).toBeTruthy();
    fireEvent.click(within(suiteHeader as HTMLElement).getByRole('button', { name: 'Run Suite' }));

    await waitFor(() => expect(sourceMock.startRun).toHaveBeenCalledTimes(1));
    expect(sourceMock.startRun).toHaveBeenCalledWith({
      configPath: '/path/trendminer/tags/tag-search.yaml',
      runsPerScenario: 1,
      agents: ['claude-sonnet-46']
    });
  });

  it('quick run passes only the config-scoped agents', async () => {
    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations']}
      >
        <Routes>
          <Route path="/mcp-evaluations" element={<Configurations />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Queue Root Config' }));

    await waitFor(() => expect(sourceMock.startRun).toHaveBeenCalledTimes(1));
    expect(sourceMock.startRun).toHaveBeenCalledWith({
      configPath: '/path/root.yaml',
      runsPerScenario: 1,
      agents: ['root-agent']
    });
  });

  it('run suite resolves each config agent list independently and honors run defaults', async () => {
    configsRef.value = [
      {
        ...configsRef.value[1],
        suitePath: 'trendminer',
        relativePath: 'trendminer/tag-search.yaml'
      },
      {
        ...configsRef.value[2],
        suitePath: 'trendminer',
        relativePath: 'trendminer/alert-check.yaml'
      }
    ];

    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations']}
      >
        <Routes>
          <Route path="/mcp-evaluations" element={<Configurations />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (node) => node.textContent?.trim() === 'trendminer'
    ) as HTMLElement | undefined;
    expect(option).toBeDefined();
    fireEvent.click(option!);

    const suiteHeader = screen.getByLabelText('Collapse suite trendminer').closest('tr');
    expect(suiteHeader).toBeTruthy();
    fireEvent.click(within(suiteHeader as HTMLElement).getByRole('button', { name: 'Run Suite' }));

    await waitFor(() => expect(sourceMock.startRun).toHaveBeenCalledTimes(2));
    expect(sourceMock.startRun).toHaveBeenNthCalledWith(1, {
      configPath: '/path/trendminer/alerts/alert-check.yaml',
      runsPerScenario: 1,
      agents: ['agent-b']
    });
    expect(sourceMock.startRun).toHaveBeenNthCalledWith(2, {
      configPath: '/path/trendminer/tags/tag-search.yaml',
      runsPerScenario: 1,
      agents: ['claude-sonnet-46']
    });
  });
});
