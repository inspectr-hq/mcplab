import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';

const mockUseDataSource = vi.fn();
const mockUseRunQueueStatus = vi.fn();

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => mockUseDataSource()
}));

vi.mock('@/hooks/use-run-queue-status', () => ({
  useRunQueueStatus: () => mockUseRunQueueStatus()
}));

vi.mock('@/components/AppSidebar', () => ({
  AppSidebar: () => <aside>Sidebar</aside>
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarTrigger: () => <button type="button">Toggle</button>
}));

describe('AppLayout queue indicator', () => {
  it('shows no queue badge when idle', () => {
    mockUseDataSource.mockReturnValue({ version: '1.0.0' });
    mockUseRunQueueStatus.mockReturnValue({
      isRunning: false,
      queuedCount: 0,
      oauthBlockedCount: 0,
      streamConnected: true,
      streamStatus: 'connected',
      reconnectStream: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/run" element={<div>Run page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText('Run Queue')).not.toBeInTheDocument();
    expect(screen.queryByText(/OAuth wait /)).not.toBeInTheDocument();
  });

  it('shows running, queue count and oauth wait count in mixed state', () => {
    mockUseDataSource.mockReturnValue({ version: '1.0.0' });
    mockUseRunQueueStatus.mockReturnValue({
      isRunning: true,
      queuedCount: 3,
      oauthBlockedCount: 1,
      streamConnected: true,
      streamStatus: 'connected',
      reconnectStream: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/run" element={<div>Run page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const runQueueLink = screen.getByRole('link', { name: /Run Queue/i });
    expect(runQueueLink).toBeInTheDocument();
    expect(runQueueLink).toHaveAttribute('href', '/run');
    expect(screen.getByText('Run Queue')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByLabelText('Queue processing')).toBeInTheDocument();
    expect(screen.getByText('OAuth wait')).toBeInTheDocument();
    expect(screen.getByText('4')).toHaveClass('bg-yellow-500/20');
  });
});
