import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentDetail from './AgentDetail';

const mocks = vi.hoisted(() => ({ save: vi.fn(), test: vi.fn(), list: vi.fn() }));
vi.mock('@/contexts/LibraryContext', () => ({
  useLibraries: () => ({ agents: [], setAgents: mocks.save, browserProviders: {} })
}));
vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: { testAgentConnection: mocks.test, listProviderModels: mocks.list }
  })
}));
vi.mock('@/hooks/use-rover-status', () => ({ useRoverStatus: () => ({ connected: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.test.mockReset().mockResolvedValue({
    ok: true,
    provider: 'azure_foundry',
    requestedModel: 'my-deployment',
    model: 'resolved-model',
    durationMs: 20,
    message: 'Deployment returned an inference response.'
  });
  mocks.list.mockReset().mockResolvedValue({
    provider: 'azure_foundry',
    items: ['suggested-deployment'],
    kind: 'deployments',
    source: 'AZURE_FOUNDRY_DEPLOYMENTS environment variable'
  });
});
function setup() {
  render(
    <MemoryRouter initialEntries={['/libraries/agents/new']}>
      <Routes>
        <Route path="/libraries/agents/:agentName" element={<AgentDetail />} />
      </Routes>
    </MemoryRouter>
  );
}
async function chooseFoundry() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Provider' }));
  fireEvent.click(screen.getByRole('option', { name: 'Azure Foundry' }));
  fireEvent.change(screen.getByLabelText('Deployment name'), {
    target: { value: 'my-deployment' }
  });
}
async function chooseAzure() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Provider' }));
  fireEvent.click(screen.getByRole('option', { name: 'Azure OpenAI' }));
}
describe('Azure Foundry agent editor', () => {
  it('reports failed inference without claiming a successful connection', async () => {
    mocks.test.mockResolvedValue({
      ok: false,
      message: 'Check the resource endpoint and exact deployment name.',
      failure: 'deployment'
    });
    setup();
    await chooseFoundry();
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('exact deployment name')
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('discards deployment suggestions returned after switching providers', async () => {
    let finish: (value: unknown) => void;
    mocks.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    setup();
    await chooseFoundry();
    fireEvent.click(screen.getByRole('button', { name: 'Load configured deployments' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Provider' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI' }));
    await act(async () =>
      finish!({ items: ['stale-deployment'], kind: 'deployments', source: 'configuration' })
    );
    expect(screen.queryByText(/Loaded 1/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch Models' })).toBeEnabled();
  });
  it('requires a deployment before creating a Foundry agent', async () => {
    setup();
    await chooseFoundry();
    fireEvent.change(screen.getByPlaceholderText('e.g. GPT-4o'), {
      target: { value: 'Foundry agent' }
    });
    fireEvent.change(screen.getByLabelText('Deployment name'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('tests an unsaved deployment and saves the Foundry provider', async () => {
    setup();
    await chooseFoundry();
    fireEvent.change(screen.getByPlaceholderText('e.g. GPT-4o'), {
      target: { value: 'Foundry agent' }
    });
    expect(screen.getByText(/AZURE_FOUNDRY_ENDPOINT/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Deployment returned an inference response.'
      )
    );
    expect(mocks.test).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'azure_foundry', model: 'my-deployment' }),
      expect.any(AbortSignal)
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith([
        expect.objectContaining({
          provider: 'azure_foundry',
          model: 'my-deployment',
          name: 'Foundry agent'
        })
      ])
    );
  });
  it('labels deployment suggestions as configured values rather than discovery', async () => {
    setup();
    await chooseFoundry();
    fireEvent.click(screen.getByRole('button', { name: 'Load configured deployments' }));
    await waitFor(() =>
      expect(screen.getByText(/Loaded 1 deployment names from configuration/)).toBeInTheDocument()
    );
    expect(mocks.list).toHaveBeenCalledWith('azure_foundry');
    expect(mocks.test).not.toHaveBeenCalled();
  });
  it('aborts and discards a test result when the deployment changes', async () => {
    let finish: (value: unknown) => void;
    mocks.test.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    setup();
    await chooseFoundry();
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    const signal = mocks.test.mock.calls[0][1];
    fireEvent.change(screen.getByLabelText('Deployment name'), {
      target: { value: 'new-deployment' }
    });
    expect(signal.aborted).toBe(true);
    await act(async () => finish!({ ok: true, message: 'Stale success' }));
    expect(screen.queryByText('Stale success')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeEnabled();
  });
});
describe('Azure OpenAI deployment suggestions', () => {
  it('shows the configuration hint only after a successful empty lookup', async () => {
    mocks.list.mockResolvedValue({
      provider: 'azure',
      items: [],
      kind: 'deployments',
      source: 'environment variables'
    });
    setup();
    await chooseAzure();
    expect(screen.queryByText(/Set AZURE_OPENAI_DEPLOYMENTS/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load configured deployments' }));
    expect(
      await screen.findByText(
        /Set AZURE_OPENAI_DEPLOYMENT on the MCPLab backend as the fallback\. AZURE_OPENAI_DEPLOYMENTS and AZURE_OPENAI_DEPLOYMENT_NAME add selectable deployment suggestions\./
      )
    ).toBeInTheDocument();
  });

  it('shows the loaded deployment count when deployments are returned', async () => {
    mocks.list.mockResolvedValue({
      provider: 'azure',
      items: ['deployment-one'],
      kind: 'deployments',
      source: 'environment variables'
    });
    setup();
    await chooseAzure();
    fireEvent.click(screen.getByRole('button', { name: 'Load configured deployments' }));
    expect(
      await screen.findByText(/Loaded 1 deployment names from configuration/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Set AZURE_OPENAI_DEPLOYMENTS/)).not.toBeInTheDocument();
  });

  it('keeps the last loaded deployments when a refresh fails', async () => {
    mocks.list
      .mockResolvedValueOnce({
        provider: 'azure',
        items: ['deployment-one'],
        kind: 'deployments',
        source: 'environment variables'
      })
      .mockRejectedValueOnce(new Error('temporary failure'));
    setup();
    await chooseAzure();
    fireEvent.click(screen.getByRole('button', { name: 'Load configured deployments' }));
    expect(
      await screen.findByText(/Loaded 1 deployment names from configuration/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load configured deployments' }));
    await waitFor(() =>
      expect(screen.getByText(/Loaded 1 deployment names from configuration/)).toBeInTheDocument()
    );
  });
});
