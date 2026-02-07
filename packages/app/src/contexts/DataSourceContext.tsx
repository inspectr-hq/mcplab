import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { demoSource } from "@/lib/data-sources/demo-source";
import { workspaceSource } from "@/lib/data-sources/workspace-source";
import { workspaceApiClient } from "@/lib/data-sources/workspace-api-client";
import type { DataMode, EvalDataSource } from "@/lib/data-sources/types";

const MODE_KEY = "mcplab:data-mode";

interface DataSourceContextValue {
  mode: DataMode;
  setMode: (mode: DataMode) => void;
  connection: "connected" | "disconnected" | "checking";
  source: EvalDataSource;
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null);

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataMode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "workspace" ? "workspace" : "demo";
  });
  const [connection, setConnection] = useState<"connected" | "disconnected" | "checking">(
    mode === "workspace" ? "checking" : "connected",
  );

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
    if (mode === "demo") {
      setConnection("connected");
      return;
    }
    setConnection("checking");
    workspaceApiClient
      .health()
      .then(() => setConnection("connected"))
      .catch(() => setConnection("disconnected"));
  }, [mode]);

  const source = useMemo<EvalDataSource>(() => (mode === "workspace" ? workspaceSource : demoSource), [mode]);

  const setMode = (next: DataMode) => setModeState(next);

  return (
    <DataSourceContext.Provider value={{ mode, setMode, connection, source }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  const ctx = useContext(DataSourceContext);
  if (!ctx) throw new Error("useDataSource must be used within DataSourceProvider");
  return ctx;
}
