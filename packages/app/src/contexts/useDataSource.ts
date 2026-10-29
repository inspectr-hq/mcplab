import { createContext, useContext } from 'react';
import type { EvalDataSource } from '@/lib/data-sources/types';

interface DataSourceContextValue {
  mode: 'workspace';
  connection: 'connected' | 'disconnected' | 'checking';
  version: string | null;
  source: EvalDataSource;
}

export const DataSourceContext = createContext<DataSourceContextValue | null>(null);

export function useDataSource() {
  const ctx = useContext(DataSourceContext);
  if (!ctx) throw new Error('useDataSource must be used within DataSourceProvider');
  return ctx;
}
