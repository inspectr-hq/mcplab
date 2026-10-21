import { useEffect, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';

export function useDefaultEvaluationAgent() {
  const { source } = useDataSource();
  const [state, setState] = useState<{ name?: string; loading: boolean; error?: string }>({
    loading: true
  });
  useEffect(() => {
    let current = true;
    let loaded = false;
    let requestVersion = 0;
    const load = async () => {
      const version = ++requestVersion;
      if (!loaded) setState((previous) => ({ ...previous, loading: true, error: undefined }));
      try {
        const settings = await source.getWorkspaceSettings();
        if (!current || version !== requestVersion) return;
        loaded = true;
        setState({ name: settings?.defaultEvaluationAgentName, loading: false });
      } catch {
        if (!current || version !== requestVersion) return;
        if (loaded) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: 'Could not load the workspace default agent. Select agents for this run.'
        }));
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      current = false;
      window.removeEventListener('focus', load);
    };
  }, [source]);
  return state;
}
