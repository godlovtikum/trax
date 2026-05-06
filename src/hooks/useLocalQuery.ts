/**
 * useLocalQuery — read from the local SQLite mirror reactively.
 *
 * Re-runs the query whenever the sync engine reports new data, so
 * screens stay current without polling. Safe to use during the rollout
 * window: if the native SQLite module isn't linked into the build yet,
 * the hook returns `{data: null, loading: false, error}` and the
 * caller can fall back to its existing API-driven path.
 *
 * Usage:
 *
 *   const {data} = useLocalQuery<TransactionRow[]>(
 *     `select * from transactions
 *       where user_id = ? and deleted_at is null
 *       order by date desc, created_at desc
 *       limit 50`,
 *     [userId],
 *   );
 */

import {useEffect, useRef, useState} from 'react';

import {getLocalDatabase} from '../lib/db/connection';
import {subscribeToSyncCompletion} from '../lib/sync';

export interface LocalQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useLocalQuery<TRow extends Record<string, unknown>>(
  sqlStatement: string,
  parameters: ReadonlyArray<unknown> = [],
): LocalQueryResult<TRow[]> {
  const [data, setData] = useState<TRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // The params array is a fresh reference every render — serialise it
  // for the dependency comparison so we don't refetch on every render.
  const paramsKey = JSON.stringify(parameters);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runQuery = async (): Promise<void> => {
    try {
      const db = await getLocalDatabase();
      const result = await db.execute(sqlStatement, parameters);
      const rows = (result.rows?._array ?? []) as TRow[];
      if (!isMountedRef.current) return;
      setData(rows);
      setError(null);
    } catch (queryError) {
      if (!isMountedRef.current) return;
      setData(null);
      setError(queryError instanceof Error ? queryError : new Error(String(queryError)));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void runQuery();
    const unsubscribe = subscribeToSyncCompletion(() => {
      void runQuery();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sqlStatement, paramsKey]);

  return {
    data,
    loading,
    error,
    refetch: runQuery,
  };
}
