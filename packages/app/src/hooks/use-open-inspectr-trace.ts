import { useCallback, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';

/** Identifies one Inspectr trace: a scenario run's request ID on an inspected origin. */
export function inspectrTraceKey(origin: string, requestId: string): string {
  return `${origin}|${requestId}`;
}

/**
 * Opens a run's Inspectr trace in a new tab. Inspectr proxies stop with the app server, so the
 * session for the origin is (re)started on demand before navigating.
 */
export function useOpenInspectrTrace(runId: string | undefined) {
  const { source } = useDataSource();
  const [openingTrace, setOpeningTrace] = useState<string | null>(null);

  const openTrace = useCallback(
    async (origin: string, requestId: string) => {
      if (!runId) return;
      // Open the tab synchronously: browsers block popups opened after an await.
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      setOpeningTrace(inspectrTraceKey(origin, requestId));
      try {
        const session = await source.openRunInspectrSession(runId, origin);
        const url = `${session.dashboardUrl}#traces/${encodeURIComponent(requestId)}`;
        if (tab) tab.location.href = url;
        else window.open(url, '_blank', 'noopener');
      } catch (error) {
        tab?.close();
        toast({
          title: 'Could not open Inspectr',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive'
        });
      } finally {
        setOpeningTrace(null);
      }
    },
    [runId, source]
  );

  return { openingTrace, openTrace };
}
