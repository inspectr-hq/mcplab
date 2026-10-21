import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { AgentConfig, Scenario, ServerConfig } from '@/types/eval';
import type { BrowserProviderProfile } from '@inspectr/mcplab-core';
import { useDataSource } from '@/contexts/DataSourceContext';

interface LibraryState {
  servers: ServerConfig[];
  agents: AgentConfig[];
  scenarios: Scenario[];
  browserProviders: Record<string, BrowserProviderProfile>;
}

interface LibraryContextValue extends LibraryState {
  loading: boolean;
  setServers: (servers: ServerConfig[]) => Promise<void>;
  setAgents: (agents: AgentConfig[]) => Promise<void>;
  setScenarios: (scenarios: Scenario[]) => Promise<void>;
  reload: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);
const emptyLibraries: LibraryState = {
  servers: [],
  agents: [],
  scenarios: [],
  browserProviders: {}
};

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { source } = useDataSource();
  const [snapshot, setSnapshot] = useState({ source, libraries: emptyLibraries, loading: true });
  const state = snapshot.source === source ? snapshot.libraries : emptyLibraries;
  const loading = snapshot.source !== source || snapshot.loading;
  const activeSource = useRef(source);
  activeSource.current = source;
  const requestVersion = useRef(0);

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const libraries = await source.getLibraries();
      if (activeSource.current === source && version === requestVersion.current) {
        setSnapshot({ source, libraries, loading: false });
      }
    } catch (error) {
      if (activeSource.current === source && version === requestVersion.current) {
        setSnapshot((current) => ({
          source,
          libraries: current.source === source ? current.libraries : emptyLibraries,
          loading: false
        }));
      }
      throw error;
    }
  }, [source]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    const handleFocus = () => {
      void reload().catch(() => undefined);
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [reload]);

  const save = useCallback(
    async (next: LibraryState) => {
      ++requestVersion.current;
      setSnapshot({ source, libraries: next, loading: false });
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

export function useLibraries() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibraries must be used within LibraryProvider');
  return ctx;
}
