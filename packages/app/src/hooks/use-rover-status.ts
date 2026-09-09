import { useEffect, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';

export interface RoverStatus {
  connected: boolean;
  provider?: string;
  activeJobId?: string | null;
}

export function useRoverStatus(): RoverStatus {
  const { source } = useDataSource();
  const [status, setStatus] = useState<RoverStatus>({ connected: false });

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (typeof source.getRoverStatus !== 'function') return;
      void source
        .getRoverStatus()
        .then((next) => {
          if (!disposed)
            setStatus({
              connected: next.connected,
              provider: next.provider,
              activeJobId: next.activeJobId
            });
        })
        .catch(() => {
          if (!disposed) setStatus({ connected: false });
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [source]);

  return status;
}
