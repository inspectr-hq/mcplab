import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './Settings';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

const { sourceMock, agentsRef, reloadMock } = vi.hoisted(() => {
  const agentsRef = {
    value: [{ id: 'assistant-1', name: 'Assistant One', model: 'gpt-4o' }] as Array<{
      id: string;
      name: string;
      model: string;
      type?: 'llm' | 'browser';
    }>
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
        scenarioAssistantAgentName: 'assistant-1',
        evaluationJudgeAgentName: 'assistant-1'
      }),
      updateWorkspaceSettings: vi.fn().mockResolvedValue({
        workspaceRoot: '/tmp/workspace',
        evalsDir: '/tmp/evals',
        runsDir: '/tmp/runs',
        librariesDir: '/tmp/libs',
        defaultQueueWorkers: 4,
        scenarioAssistantAgentName: 'assistant-1',
        evaluationJudgeAgentName: 'assistant-1'
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
  it('allows repairing an unsupported provider in persisted decision settings', async () => {
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: { provider: 'unknown', model: 'bad-model', passThreshold: .9, failThreshold: .1 }
    });
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/saved decision engine/i));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() => expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({ evaluationDecision: null }));
  });
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sourceMock.getWorkspaceSettings.mockClear();
    sourceMock.updateWorkspaceSettings.mockClear();
    reloadMock.mockClear();
    agentsRef.value = [{ id: 'assistant-1', name: 'Assistant One', model: 'gpt-4o' }];
  });

  it('saves the whole optional engine configuration only on explicit save', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    expect(screen.getByLabelText('Decision model')).toHaveValue('gpt-6-luna');
    fireEvent.change(screen.getByLabelText('Pass probability threshold'), {
      target: { value: '0.8' }
    });
    fireEvent.change(screen.getByLabelText('Fail probability threshold'), {
      target: { value: '0.2' }
    });
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: {
          provider: 'openai',
          model: 'gpt-6-luna',
          passThreshold: 0.8,
          failThreshold: 0.2
        }
      })
    );
  });

  it('validates probability bounds before saving and allows correction', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    fireEvent.change(screen.getByLabelText('Fail probability threshold'), {
      target: { value: '0.9' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/fail.*pass/i);
    fireEvent.change(screen.getByLabelText('Fail probability threshold'), {
      target: { value: '' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Fail probability threshold'), {
      target: { value: '0.1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() => expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalled());
  });

  it('uses a backend Ollama URL and sends null when the engine is cleared', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ollama' }));
    expect(screen.getByLabelText('Ollama server URL')).toHaveValue('http://localhost:11434');
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: 'clef:custom' } });
    fireEvent.change(screen.getByLabelText('Ollama server URL'), {
      target: { value: 'http://ollama:11434' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: {
          provider: 'ollama',
          model: 'clef:custom',
          baseUrl: 'http://ollama:11434',
          passThreshold: 0.9,
          failThreshold: 0.1
        }
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Decision Engine' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenLastCalledWith({
        evaluationDecision: null
      })
    );
  });

  it('requires a judge backup and retains the draft when saving fails', async () => {
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({ evaluationJudgeAgentName: '' });
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/LLM.*judge/i);
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('combobox', { name: 'Default Evaluation Judge' }));
    fireEvent.click(screen.getByRole('option', { name: /Assistant One/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Decision Engine' })).toBeEnabled()
    );
    sourceMock.updateWorkspaceSettings.mockRejectedValueOnce(new Error('save failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('save failed'));
    expect(screen.getByLabelText('Decision model')).toHaveValue('gpt-6-luna');
  });

  it('loads persisted thresholds and requires clearing the engine before its judge', async () => {
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: {
        provider: 'typesafe',
        model: 'jev-custom',
        passThreshold: 0.85,
        failThreshold: 0.15
      }
    });
    render(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Pass probability threshold')).toHaveValue(0.85)
    );
    expect(screen.getByLabelText('Fail probability threshold')).toHaveValue(0.15);
    expect(screen.getByLabelText('Decision model')).toHaveValue('jev-custom');
    fireEvent.click(screen.getByRole('combobox', { name: 'Default Evaluation Judge' }));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/before removing.*judge/i);
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({ evaluationDecision: null })
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Default Evaluation Judge' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Default Evaluation Judge' }));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenLastCalledWith({
        evaluationJudgeAgentName: null
      })
    );
  });

  it('excludes browser agents from backup judge choices', async () => {
    agentsRef.value.push({
      id: 'browser-1',
      name: 'Browser One',
      model: 'browser',
      type: 'browser'
    });
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Default Evaluation Judge' }));
    expect(screen.queryByRole('option', { name: /Browser One/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Assistant One/ })).toBeInTheDocument();
  });

  afterEach(() => {
    const actWarnings =
      consoleErrorSpy?.mock.calls.filter(([message]) =>
        String(message).includes('not wrapped in act')
      ) ?? [];
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    expect(actWarnings).toHaveLength(0);
  });

  it('loads and saves the evaluation workers setting', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled();
    });

    expect(screen.getByText('Evaluation workers')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'Evaluation workers' }));
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

    fireEvent.click(screen.getByRole('combobox', { name: 'Evaluation workers' }));
    fireEvent.click(screen.getByText('4'));

    await waitFor(() => {
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        defaultQueueWorkers: 4
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Evaluation workers' })).toHaveTextContent('3');
    });
  });
});
