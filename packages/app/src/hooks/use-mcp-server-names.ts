import { useMemo } from 'react';
import { useLibraries } from '@/contexts/LibraryContext';

export function useMcpServerNames(): Record<string, string> {
  const { servers } = useLibraries();
  return useMemo(
    () =>
      Object.fromEntries(
        servers.map((server) => [server.id, server.name?.trim() || server.id] as const)
      ),
    [servers]
  );
}
