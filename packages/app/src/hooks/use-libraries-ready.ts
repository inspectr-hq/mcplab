import { useRef } from 'react';
import { useLibraries } from '@/contexts/useLibraries';

export function useLibrariesReady(): boolean {
  const { loading } = useLibraries();
  const hasLoadedLibraries = useRef(false);
  if (!loading) hasLoadedLibraries.current = true;
  return hasLoadedLibraries.current;
}
