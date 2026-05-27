import { useCallback, useMemo, useState } from 'react';

export function useOffsetPagination(limit: number) {
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const prev = useCallback(() => {
    setOffset((current) => Math.max(0, current - limit));
  }, [limit]);

  const next = useCallback(() => {
    setOffset((current) => current + limit);
  }, [limit]);

  const reset = useCallback(() => setOffset(0), []);

  const updateMeta = useCallback((meta: { has_more: boolean; total_count: number }) => {
    setHasMore(meta.has_more);
    setTotalCount(meta.total_count);
  }, []);

  const rangeLabel = useCallback(
    (itemCount: number) => {
      if (totalCount <= 0 || itemCount <= 0) return 'Showing 0 of 0';
      return `Showing ${offset + 1}-${Math.min(offset + itemCount, totalCount)} of ${totalCount}`;
    },
    [offset, totalCount]
  );

  return useMemo(
    () => ({
      limit,
      offset,
      hasMore,
      totalCount,
      setOffset,
      setHasMore,
      setTotalCount,
      prev,
      next,
      reset,
      updateMeta,
      rangeLabel
    }),
    [hasMore, limit, next, offset, prev, rangeLabel, reset, totalCount, updateMeta]
  );
}
