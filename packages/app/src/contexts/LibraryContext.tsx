import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentConfig, Scenario, ServerConfig } from "@/types/eval";
import { useDataSource } from "@/contexts/DataSourceContext";

interface LibraryState {
  servers: ServerConfig[];
  agents: AgentConfig[];
  scenarios: Scenario[];
}

interface LibraryContextValue extends LibraryState {
  loading: boolean;
  setServers: (servers: ServerConfig[]) => Promise<void>;
  setAgents: (agents: AgentConfig[]) => Promise<void>;
  setScenarios: (scenarios: Scenario[]) => Promise<void>;
  reload: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { source } = useDataSource();
  const [state, setState] = useState<LibraryState>({ servers: [], agents: [], scenarios: [] });
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const libraries = await source.getLibraries();
      setState(libraries);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [source]);

  useEffect(() => {
    const handleFocus = () => {
      void reload();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [source]);

  const save = async (next: LibraryState) => {
    setState(next);
    await source.saveLibraries(next);
  };

  const value = useMemo<LibraryContextValue>(
    () => ({
      ...state,
      loading,
      setServers: async (servers) => save({ ...state, servers }),
      setAgents: async (agents) => save({ ...state, agents }),
      setScenarios: async (scenarios) => save({ ...state, scenarios }),
      reload
    }),
    [state, loading]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibraries() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibraries must be used within LibraryProvider");
  return ctx;
}
