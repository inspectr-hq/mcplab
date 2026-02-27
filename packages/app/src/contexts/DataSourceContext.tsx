import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { workspaceSource } from "@/lib/data-sources/workspace-source";
import { workspaceApiClient } from "@/lib/data-sources/workspace-api-client";
import type { EvalDataSource } from "@/lib/data-sources/types";

interface DataSourceContextValue {
  mode: "workspace";
  connection: "connected" | "disconnected" | "checking";
  source: EvalDataSource;
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null);

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const mode = "workspace" as const;
  const [connection, setConnection] = useState<"connected" | "disconnected" | "checking">(
    "checking",
  );

  useEffect(() => {
    setConnection("checking");
    workspaceApiClient
      .health()
      .then(() => setConnection("connected"))
      .catch(() => setConnection("disconnected"));
  }, [mode]);

  const source = useMemo<EvalDataSource>(() => workspaceSource, []);

  return (
    <DataSourceContext.Provider value={{ mode, connection, source }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  const ctx = useContext(DataSourceContext);
  if (!ctx) throw new Error("useDataSource must be used within DataSourceProvider");
  return ctx;
}
