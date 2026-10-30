import { createContext, useContext } from 'react';
import type { EvalConfig } from '@/types/eval';

interface ConfigContextValue {
  configs: EvalConfig[];
  loading: boolean;
  getConfig: (id: string) => EvalConfig | undefined;
  addConfig: (config: EvalConfig) => Promise<EvalConfig>;
  updateConfig: (id: string, config: EvalConfig) => Promise<EvalConfig>;
  deleteConfig: (id: string) => Promise<void>;
  cloneConfig: (id: string) => Promise<EvalConfig>;
  reload: () => Promise<void>;
}

export const ConfigContext = createContext<ConfigContextValue | null>(null);

export function useConfigs() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigs must be used within ConfigProvider');
  return ctx;
}
