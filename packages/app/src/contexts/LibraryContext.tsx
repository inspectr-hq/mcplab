import {
  LibraryContext,
  type LibraryState,
  type LibraryContextValue
} from '@/contexts/useLibraries';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDataSource } from '@/contexts/useDataSource';

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { source } = useDataSource();
  const [state, setState] = useState<LibraryState>({
    servers: [],
    agents: [],
    scenarios: [],
    browserProviders: {}
  });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const libraries = await source.getLibraries();
      setState(libraries);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handleFocus = () => {
      void reload();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [reload]);

  const save = useCallback(
    async (next: LibraryState) => {
      setState(next);
      await source.saveLibraries(next);
    },
    [source]
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      ...state,
      loading,
      setServers: async (servers) => save({ ...state, servers }),
      setAgents: async (agents) => save({ ...state, agents }),
      setScenarios: async (scenarios) => save({ ...state, scenarios }),
      reload
    }),
    [state, loading, reload, save]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
