import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigEditor from './ConfigEditor';
import type { EvalConfig } from '@/types/eval';

const { configRef, librariesRef, reloadMock } = vi.hoisted(() => ({
  configRef: { value: null as EvalConfig | null },
  librariesRef: {
    value: {
      servers: [],
      agents: [],
      scenarios: []
    }
  },
  reloadMock: vi.fn()
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
  ScenarioForm: () => <div data-testid="scenario-form" />
}));

describe('ConfigEditor', () => {
  beforeEach(() => {
    reloadMock.mockClear();
    configRef.value = {
      id: 'cfg-1',
      name: 'Editor Config',
      configName: '',
      description: '',
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
      servers: [],
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
  });

  it('renders the edit page even when a library scenario has a malformed name', () => {
    render(
      <MemoryRouter
        initialEntries={['/mcp-evaluations/cfg-1/edit']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/mcp-evaluations/:id/edit" element={<ConfigEditor />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Editor Config')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});
