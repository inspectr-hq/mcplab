import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { EvalConfig } from "@/types/eval";
import { mockConfigs } from "@/data/mock-data";

interface ConfigContextValue {
  configs: EvalConfig[];
  getConfig: (id: string) => EvalConfig | undefined;
  addConfig: (config: EvalConfig) => void;
  updateConfig: (id: string, config: EvalConfig) => void;
  deleteConfig: (id: string) => void;
  cloneConfig: (id: string) => EvalConfig;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [configs, setConfigs] = useState<EvalConfig[]>(() => {
    const stored = localStorage.getItem("mcp-eval-configs");
    return stored ? JSON.parse(stored) : mockConfigs;
  });

  const persist = (next: EvalConfig[]) => {
    setConfigs(next);
    localStorage.setItem("mcp-eval-configs", JSON.stringify(next));
  };

  const getConfig = useCallback((id: string) => configs.find((c) => c.id === id), [configs]);

  const addConfig = useCallback((config: EvalConfig) => {
    persist([...configs, config]);
  }, [configs]);

  const updateConfig = useCallback((id: string, config: EvalConfig) => {
    persist(configs.map((c) => (c.id === id ? config : c)));
  }, [configs]);

  const deleteConfig = useCallback((id: string) => {
    persist(configs.filter((c) => c.id !== id));
  }, [configs]);

  const cloneConfig = useCallback((id: string) => {
    const original = configs.find((c) => c.id === id);
    if (!original) throw new Error("Config not found");
    const cloned: EvalConfig = {
      ...structuredClone(original),
      id: `cfg-${Date.now()}`,
      name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persist([...configs, cloned]);
    return cloned;
  }, [configs]);

  return (
    <ConfigContext.Provider value={{ configs, getConfig, addConfig, updateConfig, deleteConfig, cloneConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfigs() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfigs must be used within ConfigProvider");
  return ctx;
}
