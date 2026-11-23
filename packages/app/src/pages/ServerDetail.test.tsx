import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServerDetail from './ServerDetail';

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  ensureOAuth: vi.fn(),
  save: vi.fn(),
  server: {
    id: 'oauth-server',
    name: 'OAuth Server',
    transport: 'http',
    url: 'https://example.com/mcp',
    authType: 'oauth2',
    oauthClientId: 'client-id'
  }
}));

vi.mock('@/contexts/useLibraries', () => ({
  useLibraries: () => ({ servers: [mocks.server], setServers: mocks.save })
}));
vi.mock('@/contexts/useDataSource', () => ({
  useDataSource: () => ({ source: { discoverToolsForAnalysis: mocks.discover } })
}));
vi.mock('@/lib/oauth-session-utils', () => ({ ensureOAuthForServers: mocks.ensureOAuth }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

beforeEach(() => {
  mocks.discover.mockReset();
  mocks.ensureOAuth.mockReset().mockResolvedValue(undefined);
  mocks.save.mockReset();
});

describe('ServerDetail OAuth connection test', () => {
  it('retries tool discovery after browser OAuth authorization completes', async () => {
    mocks.discover
      .mockRejectedValueOnce(Object.assign(new Error('OAuth authorization required'), { status: 401 }))
      .mockResolvedValueOnce({
        servers: [
          {
            warnings: [],
            tools: [],
            mcpServerVersion: '1.0.0',
            mcpServerImplementation: { name: 'demo' }
          }
        ]
      });

    render(
      <MemoryRouter initialEntries={['/libraries/servers/oauth-server']}>
        <Routes>
          <Route path="/libraries/servers/:serverId" element={<ServerDetail />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => expect(mocks.discover).toHaveBeenCalledTimes(2));
    expect(mocks.ensureOAuth).toHaveBeenCalledWith({
      serverNames: ['oauth-server'],
      source: expect.any(Object)
    });
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });
});
