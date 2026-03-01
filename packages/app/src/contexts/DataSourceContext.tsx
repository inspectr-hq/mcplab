import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { workspaceSource } from "@/lib/data-sources/workspace-source";
import { workspaceApiClient } from "@/lib/data-sources/workspace-api-client";
import type { EvalDataSource } from "@/lib/data-sources/types";

interface DataSourceContextValue {
  mode: "workspace";
  connection: "connected" | "disconnected" | "checking";
  version: string | null;
  source: EvalDataSource;
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null);

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const mode = "workspace" as const;
  const [connection, setConnection] = useState<"connected" | "disconnected" | "checking">(
    "checking",
  );
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    setConnection("checking");
    workspaceApiClient
      .health()
      .then((health) => {
        setConnection("connected");
        setVersion(typeof health?.version === "string" ? health.version : null);
      })
      .catch(() => {
        setConnection("disconnected");
        setVersion(null);
      });
  }, [mode]);

  const source = useMemo<EvalDataSource>(() => workspaceSource, []);

  return (
    <DataSourceContext.Provider value={{ mode, connection, version, source }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  const ctx = useContext(DataSourceContext);
  if (!ctx) throw new Error("useDataSource must be used within DataSourceProvider");
  return ctx;
}
