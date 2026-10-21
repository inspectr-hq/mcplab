import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider, useLibraries } from './LibraryContext';

const { sourceRef } = vi.hoisted(() => ({
  sourceRef: { current: { getLibraries: vi.fn(), saveLibraries: vi.fn() } }
}));
vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({ source: sourceRef.current })
}));

const empty = { agents: [], servers: [], scenarios: [], browserProviders: {} };
function Probe() {
  const { loading, agents } = useLibraries();
  return (
    <button disabled={loading}>{loading ? 'Loading libraries' : `Ready: ${agents.length}`}</button>
  );
}

describe('LibraryProvider loading', () => {
  beforeEach(() => {
    sourceRef.current = { getLibraries: vi.fn(), saveLibraries: vi.fn() };
  });

  it('keeps controls usable during focus refresh, including an empty library', async () => {
    let finishRefresh!: (value: typeof empty) => void;
    sourceRef.current.getLibraries.mockResolvedValueOnce(empty).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        })
    );
    render(
      <LibraryProvider>
        <Probe />
      </LibraryProvider>
    );
    expect(screen.getByRole('button')).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Ready: 0'));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.queryByText('Loading libraries')).not.toBeInTheDocument();
    await act(async () => finishRefresh(empty));
  });

  it('loads a new source and ignores late responses from the previous source', async () => {
    let finishOld!: (value: typeof empty) => void;
    sourceRef.current.getLibraries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    const view = render(
      <LibraryProvider>
        <Probe />
      </LibraryProvider>
    );
    let finishNew!: (value: typeof empty) => void;
    sourceRef.current = {
      getLibraries: vi.fn(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          })
      ),
      saveLibraries: vi.fn()
    };
    view.rerender(
      <LibraryProvider>
        <Probe />
      </LibraryProvider>
    );
    await act(async () => finishOld(empty));
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => finishNew(empty));
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('keeps the latest refresh when focus requests finish out of order', async () => {
    let finishOlder!: (value: unknown) => void;
    let finishNewer!: (value: unknown) => void;
    sourceRef.current.getLibraries
      .mockResolvedValueOnce(empty)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOlder = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNewer = resolve;
          })
      );
    render(
      <LibraryProvider>
        <Probe />
      </LibraryProvider>
    );
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Ready: 0'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () =>
      finishNewer({
        ...empty,
        agents: [{ id: 'a', name: 'A', provider: 'openai', model: 'test', maxTokens: 100 }]
      })
    );
    expect(screen.getByRole('button')).toHaveTextContent('Ready: 1');
    await act(async () => finishOlder(empty));
    expect(screen.getByRole('button')).toHaveTextContent('Ready: 1');
  });

  it('keeps cached controls usable after a failed background refresh', async () => {
    sourceRef.current.getLibraries
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(new Error('Offline'));
    render(
      <LibraryProvider>
        <Probe />
      </LibraryProvider>
    );
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Ready: 0'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.getByRole('button')).toHaveTextContent('Ready: 0');
  });
});
