import { useEffect, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';

export function useDefaultEvaluationAgent() {
  const { source } = useDataSource();
  const [state, setState] = useState<{ name?: string; loading: boolean; error?: string }>({
    loading: true
  });
  useEffect(() => {
    let current = true;
    setState({ loading: true });
    source.getWorkspaceSettings().then(
      (settings) => {
        if (current) setState({ name: settings?.defaultEvaluationAgentName, loading: false });
      },
      () => {
        if (current)
          setState({
            loading: false,
            error: 'Could not load the workspace default agent. Reload this page to try again.'
          });
      }
    );
    return () => {
      current = false;
    };
  }, [source]);
  return state;
}
