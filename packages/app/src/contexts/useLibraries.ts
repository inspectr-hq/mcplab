import { createContext, useContext } from 'react';
import type { AgentConfig, Scenario, ServerConfig } from '@/types/eval';
import type { BrowserProviderProfile } from '@/lib/data-sources/types';

export interface LibraryState {
  servers: ServerConfig[];
  agents: AgentConfig[];
  scenarios: Scenario[];
  browserProviders: Record<string, BrowserProviderProfile>;
}

export interface LibraryContextValue extends LibraryState {
  loading: boolean;
  setServers: (servers: ServerConfig[]) => Promise<void>;
  setAgents: (agents: AgentConfig[]) => Promise<void>;
  setScenarios: (scenarios: Scenario[]) => Promise<void>;
  reload: () => Promise<void>;
}

export const LibraryContext = createContext<LibraryContextValue | null>(null);

export function useLibraries() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibraries must be used within LibraryProvider');
  return ctx;
}
