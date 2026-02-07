import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { EvalConfig } from "@/types/eval";
import { useDataSource } from "@/contexts/DataSourceContext";

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

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { source, mode } = useDataSource();
  const [configs, setConfigs] = useState<EvalConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await source.listConfigs();
      setConfigs(next);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void reload();
  }, [reload, mode]);

  const getConfig = useCallback((id: string) => configs.find((c) => c.id === id), [configs]);

  const addConfig = useCallback(
    async (config: EvalConfig) => {
      const created = await source.createConfig(config);
      setConfigs((prev) => [...prev, created]);
      return created;
    },
    [source],
  );

  const updateConfig = useCallback(
    async (id: string, config: EvalConfig) => {
      const updated = await source.updateConfig({ ...config, id });
      setConfigs((prev) => prev.map((item) => (item.id === id ? updated : item)));
      return updated;
    },
    [source],
  );

  const deleteConfig = useCallback(
    async (id: string) => {
      await source.deleteConfig(id);
      setConfigs((prev) => prev.filter((item) => item.id !== id));
    },
    [source],
  );

  const cloneConfig = useCallback(async (id: string) => {
    const original = configs.find((c) => c.id === id);
    if (!original) throw new Error("Config not found");
    const cloned: EvalConfig = {
      ...structuredClone(original),
      id: `cfg-${Date.now()}`,
      name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const created = await source.createConfig(cloned);
    setConfigs((prev) => [...prev, created]);
    return created;
  }, [configs, source]);

  return (
    <ConfigContext.Provider value={{ configs, loading, getConfig, addConfig, updateConfig, deleteConfig, cloneConfig, reload }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfigs() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfigs must be used within ConfigProvider");
  return ctx;
}
