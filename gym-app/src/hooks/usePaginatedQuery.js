import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Cursor-based pagination hook for Supabase queries.
 *
 * Usage:
 *   const { data, loading, hasMore, loadMore, refresh } = usePaginatedQuery({
 *     table: 'workout_sessions',
 *     select: 'id, name, completed_at',
 *     filters: { profile_id: user.id, status: 'completed' },
 *     orderBy: 'completed_at',
 *     ascending: false,
 *     pageSize: 20,
 *     enabled: !!user?.id,
 *   });
 */
export default function usePaginatedQuery({
  table,
  select = '*',
  filters = {},
  orderBy = 'created_at',
  ascending = false,
  pageSize = 20,
  enabled = true,
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef(null);
  const loadedRef = useRef(false);

  const buildQuery = useCallback(() => {
    let query = supabase.from(table).select(select);
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    });
    query = query.order(orderBy, { ascending });
    return query;
  }, [table, select, JSON.stringify(filters), orderBy, ascending]);

  const loadPage = useCallback(async (isRefresh = false) => {
    if (!enabled) return;
    if (loading) return;
    if (!isRefresh && !hasMore) return;

    setLoading(true);
    let query = buildQuery().limit(pageSize);

    const cursor = isRefresh ? null : cursorRef.current;
    if (cursor) {
      if (ascending) {
        query = query.gt(orderBy, cursor);
      } else {
        query = query.lt(orderBy, cursor);
      }
    }

    const { data: rows, error } = await query;

    if (error) {
      setLoading(false);
      setInitialLoading(false);
      return;
    }

    const newRows = rows || [];
    setHasMore(newRows.length === pageSize);

    if (newRows.length > 0) {
      cursorRef.current = newRows[newRows.length - 1][orderBy];
    }

    if (isRefresh) {
      setData(newRows);
    } else {
      setData(prev => [...prev, ...newRows]);
    }

    setLoading(false);
    setInitialLoading(false);
    loadedRef.current = true;
  }, [enabled, loading, hasMore, buildQuery, pageSize, orderBy, ascending]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) loadPage(false);
  }, [loading, hasMore, loadPage]);

  const refresh = useCallback(() => {
    cursorRef.current = null;
    setHasMore(true);
    loadPage(true);
  }, [loadPage]);

  // Auto-load first page
  if (enabled && !loadedRef.current && !loading) {
    loadPage(true);
  }

  return { data, loading: initialLoading, loadingMore: loading && !initialLoading, hasMore, loadMore, refresh };
}
