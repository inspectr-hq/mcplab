import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigEditor from './ConfigEditor';
import type { EvalConfig } from '@/types/eval';

const { configRef, librariesRef, reloadMock, scenarioFormPropsRef } = vi.hoisted(() => ({
  configRef: { value: null as EvalConfig | null },
  librariesRef: {
    value: {
      servers: [],
      agents: [],
      scenarios: []
    }
  },
  reloadMock: vi.fn(),
  scenarioFormPropsRef: { value: null as { servers?: Array<{ id: string }> } | null }
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfigs: () => ({
    getConfig: (id: string) => (configRef.value?.id === id ? configRef.value : undefined),
    addConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    cloneConfig: vi.fn(),
    configs: configRef.value ? [configRef.value] : [],
    loading: false,
    reload: reloadMock
  })
}));

vi.mock('@/contexts/LibraryContext', () => ({
  useLibraries: () => ({
    ...librariesRef.value,
    reload: vi.fn()
  })
}));

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: {}
  })
}));

vi.mock('@/components/config-editor/ScenarioForm', () => ({
  ScenarioForm: (props: { servers?: Array<{ id: string }> }) => {
    scenarioFormPropsRef.value = props;
    return <div data-testid="scenario-form" />;
  }
}));

describe('ConfigEditor', () => {
  beforeEach(() => {
    reloadMock.mockClear();
    configRef.value = {
      id: 'cfg-1',
      name: 'Editor Config',
      configName: '',
      description: 'Useful context',
      sourcePath: '/workspace/mcplab/evals/editor-config.yaml',
      relativePath: 'mcplab/evals/editor-config.yaml',
      servers: [],
      serverEntries: [],
      agents: [],
      agentEntries: [],
      scenarios: [],
      scenarioEntries: [],
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z'
    };
    librariesRef.value = {
      servers: [
        {
          id: 'library-server',
          name: 'Library Server',
          transport: 'stdio',
          command: 'server'
        }
      ],
      agents: [],
      scenarios: [
        {
          id: 'scn-good',
          name: 'Good Scenario',
          serverIds: [],
          prompt: '',
          evalRules: [],
          extractRules: []
        },
        {
          id: 'scn-bad',
          name: { 'Context - Two-Step Workflow': true } as unknown as string,
          serverIds: [],
          prompt: '',
          evalRules: [],
          extractRules: []
        }
      ]
    };
    scenarioFormPropsRef.value = null;
  });

  it('renders the edit page even when a library scenario has a malformed name', () => {
    render(
      <MemoryRouter initialEntries={['/mcp-evaluations/cfg-1/edit']}>
        <Routes>
          <Route path="/mcp-evaluations/:id/:tab?" element={<ConfigEditor />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Editing: Editor Config')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Useful context')).toBeInTheDocument();
    expect(screen.getByLabelText('Evaluation file')).toHaveTextContent(
      'mcplab/evals/editor-config.yaml'
    );
    expect(
      screen.queryByText('/workspace/mcplab/evals/editor-config.yaml')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('hides optional metadata fields in regular view mode', () => {
    render(
      <MemoryRouter initialEntries={['/mcp-evaluations/cfg-1']}>
        <Routes>
          <Route path="/mcp-evaluations/:id" element={<ConfigEditor />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.queryByText('Name (optional)')).not.toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Useful context')).toBeInTheDocument();
  });

  it('provides library servers to an inline evaluation scenario', () => {
    configRef.value = {
      ...configRef.value!,
      scenarioEntries: [
        {
          kind: 'inline',
          scenario: {
            id: 'inline-scenario',
            name: 'Inline Scenario',
            serverIds: [],
            prompt: 'Test',
            evalRules: [],
            extractRules: []
          }
        }
      ]
    };

    render(
      <MemoryRouter initialEntries={['/mcp-evaluations/cfg-1/edit']}>
        <Routes>
          <Route path="/mcp-evaluations/:id/:tab?" element={<ConfigEditor />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand scenario details' }));

    expect(scenarioFormPropsRef.value?.servers).toEqual([
      expect.objectContaining({ id: 'library-server' })
    ]);
  });
});
