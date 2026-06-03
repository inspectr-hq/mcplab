import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SettingsPage from './Settings';

const { sourceMock, agentsRef, reloadMock } = vi.hoisted(() => {
  const agentsRef = {
    value: [{ id: 'assistant-1', name: 'Assistant One', model: 'gpt-4o' }]
  };
  return {
    agentsRef,
    reloadMock: vi.fn(),
    sourceMock: {
      getWorkspaceSettings: vi.fn().mockResolvedValue({
        workspaceRoot: '/tmp/workspace',
        evalsDir: '/tmp/evals',
        runsDir: '/tmp/runs',
        librariesDir: '/tmp/libs',
        defaultQueueWorkers: 3,
        scenarioAssistantAgentName: 'assistant-1'
      }),
      updateWorkspaceSettings: vi.fn().mockResolvedValue({
        workspaceRoot: '/tmp/workspace',
        evalsDir: '/tmp/evals',
        runsDir: '/tmp/runs',
        librariesDir: '/tmp/libs',
        defaultQueueWorkers: 4,
        scenarioAssistantAgentName: 'assistant-1'
      })
    }
  };
});

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceMock
  })
}));

vi.mock('@/contexts/LibraryContext', () => ({
  useLibraries: () => ({
    agents: agentsRef.value,
    reload: reloadMock,
    loading: false
  })
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    sourceMock.getWorkspaceSettings.mockClear();
    sourceMock.updateWorkspaceSettings.mockClear();
    reloadMock.mockClear();
  });

  it('loads and saves the evaluation workers setting', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled();
    });

    expect(screen.getByText('Evaluation workers')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('combobox')[1]!);
    fireEvent.click(screen.getByText('4'));

    await waitFor(() => {
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        defaultQueueWorkers: 4
      });
    });
  });

  it('rolls back the evaluation workers field when save fails', async () => {
    sourceMock.updateWorkspaceSettings.mockRejectedValueOnce(new Error('save failed'));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole('combobox')[1]!);
    fireEvent.click(screen.getByText('4'));

    await waitFor(() => {
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        defaultQueueWorkers: 4
      });
    });

    await waitFor(() => {
      expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('3');
    });
  });
});
