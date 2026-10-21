import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      testDecisionConnection: vi.fn(),
      getWorkspaceSettings: vi.fn().mockResolvedValue({
        workspaceRoot: '/tmp/workspace',
        evalsDir: '/tmp/evals',
        runsDir: '/tmp/runs',
        librariesDir: '/tmp/libs',
        defaultQueueWorkers: 3,
        assistantAgentName: 'assistant-1',
        evaluationJudgeAgentName: 'assistant-1'
      }),
      updateWorkspaceSettings: vi.fn().mockResolvedValue({
        workspaceRoot: '/tmp/workspace',
        evalsDir: '/tmp/evals',
        runsDir: '/tmp/runs',
        librariesDir: '/tmp/libs',
        defaultQueueWorkers: 4,
        assistantAgentName: 'assistant-1',
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
  it('offers only LLM agents as the shared evaluation default', async () => {
    agentsRef.value.push({ id: 'browser', name: 'Browser Agent', model: '', type: 'browser' });
    render(<SettingsPage />);
    const select = await screen.findByRole('combobox', { name: 'Default Evaluation Agent' });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.click(select);
    expect(screen.queryByRole('option', { name: /Browser Agent/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Assistant One/ })).toBeInTheDocument();
  });
  it('restores the agent setting after a failed save', async () => {
    sourceMock.updateWorkspaceSettings.mockRejectedValueOnce(new Error('Save failed'));
    render(<SettingsPage />);
    const select = await screen.findByRole('combobox', { name: 'Default Evaluation Agent' });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: /Assistant One/ }));
    await waitFor(() => expect(select).toHaveTextContent('None'));
    await waitFor(() => expect(select).toBeEnabled());
  });
  it('selects and clears the workspace default evaluation agent', async () => {
    render(<SettingsPage />);
    const select = await screen.findByRole('combobox', { name: 'Default Evaluation Agent' });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: /Assistant One/ }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        defaultEvaluationAgentName: 'assistant-1'
      })
    );
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        defaultEvaluationAgentName: null
      })
    );
  });
  it('allows repairing an unsupported provider in persisted decision settings', async () => {
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: {
        provider: 'unknown',
        model: 'bad-model',
        passThreshold: 0.9,
        failThreshold: 0.1
      }
    });
    render(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/saved decision engine/i)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({ evaluationDecision: null })
    );
  });
  it('keeps the saved configuration warning visible while testing a replacement draft', async () => {
    let finishTest!: (result: { ok: boolean; message: string }) => void;
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: {
        provider: 'unknown',
        model: 'bad-model',
        passThreshold: 0.9,
        failThreshold: 0.1
      }
    });
    sourceMock.testDecisionConnection.mockImplementationOnce(
      () => new Promise((resolve) => (finishTest = resolve))
    );
    render(<SettingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/saved decision engine/i);
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('button', { name: 'Testing...' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/saved decision engine/i);
    await act(async () => finishTest({ ok: true, message: 'Connection succeeded.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: {
          provider: 'openai',
          model: 'gpt-6-luna',
          passThreshold: 0.9,
          failThreshold: 0.1
        }
      })
    );
    await waitFor(() =>
      expect(screen.queryByText(/saved decision engine/i)).not.toBeInTheDocument()
    );
  });
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sourceMock.getWorkspaceSettings.mockClear();
    sourceMock.updateWorkspaceSettings.mockClear();
    sourceMock.testDecisionConnection.mockReset().mockResolvedValue({
      ok: true,
      message: 'OpenAI Decisions returned a valid decision.',
      provider: 'openai',
      requestedModel: 'gpt-6-luna',
      probability: 0.5,
      durationMs: 10
    });
    reloadMock.mockClear();
    agentsRef.value = [{ id: 'assistant-1', name: 'Assistant One', model: 'gpt-4o' }];
  });

  it('turns a saved engine off without clearing its configuration', async () => {
    const decision = {
      provider: 'ollama',
      model: 'tev1:4b',
      baseUrl: 'http://ollama:11434',
      passThreshold: 0.85,
      failThreshold: 0.15
    };
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: decision
    });
    render(<SettingsPage />);
    const toggle = await screen.findByRole('switch', { name: 'Use Decision Engine' });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText('Ollama model name')).toHaveValue('tev1:4b');
    expect(screen.getByLabelText('Ollama server URL')).toHaveValue('http://ollama:11434');
    expect(screen.getByLabelText('Pass probability threshold')).toHaveValue(0.85);
    expect(screen.getByLabelText('Fail probability threshold')).toHaveValue(0.15);
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: { ...decision, enabled: false }
      })
    );
  });
  it('reloads a disabled engine and turns it back on with the retained settings', async () => {
    const decision = {
      provider: 'typesafe',
      model: 'jev-custom',
      passThreshold: 0.85,
      failThreshold: 0.15
    };
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: { ...decision, enabled: false }
    });
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('jev-custom'));
    const toggle = screen.getByRole('switch', { name: 'Use Decision Engine' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: decision
      })
    );
  });
  it('saves an off engine without a judge, but requires backup when turning it on', async () => {
    const decision = {
      provider: 'openai',
      model: 'gpt-6-luna',
      passThreshold: 0.9,
      failThreshold: 0.1,
      enabled: false
    };
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: '',
      evaluationDecision: decision
    });
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('gpt-6-luna'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: decision
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Decision Engine' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Use Decision Engine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/LLM.*judge/i);
    expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
  });
  it('allows removing the judge once the engine is saved off', async () => {
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({
      evaluationJudgeAgentName: 'assistant-1',
      evaluationDecision: {
        provider: 'openai',
        model: 'gpt-6-luna',
        passThreshold: 0.9,
        failThreshold: 0.1,
        enabled: false
      }
    });
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('gpt-6-luna'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Default Evaluation Judge' }));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationJudgeAgentName: null
      })
    );
  });
  it('can explicitly test a connection while the engine is off', async () => {
    const decision = {
      provider: 'openai',
      model: 'gpt-6-luna',
      passThreshold: 0.9,
      failThreshold: 0.1,
      enabled: false
    };
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({ evaluationDecision: decision });
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('gpt-6-luna'));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('returned a valid decision')
    );
    expect(sourceMock.testDecisionConnection).toHaveBeenCalledWith(
      decision,
      expect.any(AbortSignal)
    );
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
  });

  it('tests the current draft without saving or requiring a judge backup', async () => {
    sourceMock.getWorkspaceSettings.mockResolvedValueOnce({ evaluationJudgeAgentName: '' });
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ollama' }));
    fireEvent.change(screen.getByLabelText('Ollama model name'), { target: { value: 'tev1:4b' } });
    fireEvent.change(screen.getByLabelText('Ollama server URL'), {
      target: { value: 'http://ollama:11434' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(sourceMock.testDecisionConnection).toHaveBeenCalledWith(
      {
        provider: 'ollama',
        model: 'tev1:4b',
        baseUrl: 'http://ollama:11434',
        passThreshold: 0.9,
        failThreshold: 0.1
      },
      expect.any(AbortSignal)
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('returned a valid decision')
    );
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Pass probability threshold'), {
      target: { value: '0.8' }
    });
    expect(screen.getByText('OpenAI Decisions returned a valid decision.')).toBeInTheDocument();
  });
  it('shows missing credentials as a failed connection test', async () => {
    sourceMock.testDecisionConnection.mockResolvedValue({
      ok: false,
      message: 'Missing backend credentials. Requires OPENAI_API_KEY.',
      provider: 'openai',
      requestedModel: 'gpt-6-luna',
      failure: 'missing_credentials',
      durationMs: 0
    });
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('OPENAI_API_KEY'));
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
  });
  it('cancels pending tests and ignores old responses after the draft changes', async () => {
    let resolveProbe!: (result: { ok: boolean; message: string }) => void;
    sourceMock.testDecisionConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        })
    );
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(screen.getByRole('button', { name: 'Testing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Decision Engine' })).toBeDisabled();
    const signal = sourceMock.testDecisionConnection.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ollama' }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolveProbe({ ok: true, message: 'Old connection result' }));
    expect(screen.queryByText('Old connection result')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled();
  });
  it('keeps a connection test running when only probability thresholds change', async () => {
    let resolveProbe!: (result: { ok: boolean; message: string }) => void;
    sourceMock.testDecisionConnection.mockImplementationOnce(
      () => new Promise((resolve) => (resolveProbe = resolve))
    );
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ollama' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    const signal = sourceMock.testDecisionConnection.mock.calls[0][1] as AbortSignal;
    fireEvent.change(screen.getByLabelText('Pass probability threshold'), {
      target: { value: '0.8' }
    });
    expect(signal.aborted).toBe(false);
    await act(async () => resolveProbe({ ok: true, message: 'Connection succeeded.' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Connection succeeded.');
  });
  it('does not send a connection test for invalid thresholds', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Decisions' }));
    fireEvent.change(screen.getByLabelText('Fail probability threshold'), {
      target: { value: '0.9' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(sourceMock.testDecisionConnection).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/fail.*pass/i);
  });

  it('tests and saves a custom Azure Foundry deployment using backend credentials', async () => {
    sourceMock.testDecisionConnection.mockResolvedValue({
      ok: true,
      message: 'Azure Foundry returned a valid decision.',
      provider: 'azure_foundry',
      requestedModel: 'my-decision-deployment',
      model: 'microsoft-decision-1',
      probability: 0.95,
      durationMs: 15
    });
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'Azure Foundry' }));
    expect(screen.getByLabelText('Deployment name')).toHaveValue('Microsoft-Decision-1');
    expect(screen.getByText(/AZURE_FOUNDRY_ENDPOINT.*AZURE_FOUNDRY_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Ollama server URL')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Deployment name'), {
      target: { value: 'my-decision-deployment' }
    });
    const config = {
      provider: 'azure_foundry',
      model: 'my-decision-deployment',
      passThreshold: 0.9,
      failThreshold: 0.1
    };
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Azure Foundry'));
    expect(sourceMock.testDecisionConnection).toHaveBeenCalledWith(config, expect.any(AbortSignal));
    expect(sourceMock.updateWorkspaceSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Decision Engine' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: config
      })
    );
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
    const modelInput = screen.getByLabelText('Ollama model name');
    expect(modelInput).toHaveAccessibleDescription(/ollama list/);
    fireEvent.change(modelInput, { target: { value: 'tev1:0.8b' } });
    fireEvent.change(screen.getByLabelText('Ollama server URL'), {
      target: { value: 'http://ollama:11434' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: {
          provider: 'ollama',
          model: 'tev1:0.8b',
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

  it('limits Cloudflare models and permits custom TypeSafe models', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(sourceMock.getWorkspaceSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'Cloudflare Clef' }));
    expect(screen.getByRole('combobox', { name: 'Decision model' })).toHaveTextContent(
      'clef-flash'
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision model' }));
    fireEvent.click(screen.getByRole('option', { name: 'clef' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenCalledWith({
        evaluationDecision: {
          provider: 'cloudflare',
          model: 'clef',
          passThreshold: 0.9,
          failThreshold: 0.1
        }
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Decision provider' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Decision provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'TypeSafe Jev' }));
    expect(screen.getByLabelText('Decision model')).toHaveValue('jev-1.13.0');
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: 'jev-custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Engine' }));
    await waitFor(() =>
      expect(sourceMock.updateWorkspaceSettings).toHaveBeenLastCalledWith({
        evaluationDecision: {
          provider: 'typesafe',
          model: 'jev-custom',
          passThreshold: 0.9,
          failThreshold: 0.1
        }
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
