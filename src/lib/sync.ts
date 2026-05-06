/**
 * Sync engine.
 *
 * Pulls incremental changes from `GET /api/sync/pull?since=<cursor>` and
 * applies them to the local SQLite mirror. Triggers a pull on:
 *
 *   • App start (after the stored session has loaded).
 *   • Login (via onAuthChange).
 *   • Reconnect (via subscribeToNetworkStatus).
 *   • App foreground (via AppState).
 *   • Every 5 minutes while the app is foregrounded.
 *
 * On logout the local mirror is wiped so the next user starts clean.
 *
 * The engine is defensive: if `@op-engineering/op-sqlite` isn't linked
 * into the current build (e.g. during the rollout window before the
 * native rebuild lands on the device), every pull is logged and
 * skipped. The rest of the app keeps working against the existing
 * AsyncStorage cache.
 */

import {AppState, AppStateStatus} from 'react-native';

import {apiFetch, getSession, onAuthChange, type AuthSession} from './api';
import {subscribeToNetworkStatus, isOnline} from './network';
import {
  clearLocalUserData,
  getLocalDatabase,
  readSyncMeta,
  writeSyncMeta,
  type LocalDatabase,
} from './db/connection';
import {SYNC_META_KEYS, SYNCED_TABLES, type SyncedTableName} from './db/schema';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SyncChangeset {
  cursor: string;
  tables: Partial<Record<SyncedTableName, ReadonlyArray<Record<string, unknown>>>>;
}

interface ApplyResult {
  upserts: number;
  tombstones: number;
}

// ─── Public surface ────────────────────────────────────────────────────────

const PULL_INTERVAL_MS = 5 * 60 * 1000;

let initialised = false;
let pullPromiseInFlight: Promise<void> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let lastSeenSession: AuthSession | null = null;
const syncListeners = new Set<() => void>();

/**
 * Subscribe to "the local mirror just changed" events. Use from
 * `useLocalQuery` to know when to re-run a query. Returns an
 * unsubscribe function.
 */
export function subscribeToSyncCompletion(callback: () => void): () => void {
  syncListeners.add(callback);
  return () => {
    syncListeners.delete(callback);
  };
}

function emitSyncCompletion(): void {
  for (const listener of syncListeners) {
    try {
      listener();
    } catch (listenerError) {
      if (__DEV__) console.warn('[sync] listener threw', listenerError);
    }
  }
}

/**
 * Wire all sync triggers. Idempotent — safe to call multiple times.
 * Call once during app startup, AFTER `initializeOfflineSync()`.
 */
export function initializeSync(): void {
  if (initialised) return;
  initialised = true;

  // 1. React to login / logout.
  onAuthChange(currentSession => {
    void handleAuthTransition(lastSeenSession, currentSession);
    lastSeenSession = currentSession;
  });
  lastSeenSession = getSession();

  // 2. Reconnect → pull.
  subscribeToNetworkStatus(connected => {
    if (connected && getSession()) void pullChanges();
  });

  // 3. Foreground → pull.
  AppState.addEventListener('change', handleAppStateChange);

  // 4. Periodic pull while foregrounded.
  periodicTimer = setInterval(() => {
    if (AppState.currentState === 'active' && getSession() && isOnline()) {
      void pullChanges();
    }
  }, PULL_INTERVAL_MS);

  // 5. Kick off the first pull if there's already a session loaded.
  if (getSession()) void pullChanges();
}

/**
 * Public manual trigger — call from places that just made a write that
 * affects state the user is about to look at (rare; the periodic +
 * reconnect triggers cover almost everything).
 */
export async function syncNow(): Promise<void> {
  await pullChanges();
}

// ─── Internals ─────────────────────────────────────────────────────────────

function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active' && getSession() && isOnline()) {
    void pullChanges();
  }
}

async function handleAuthTransition(
  previous: AuthSession | null,
  next: AuthSession | null,
): Promise<void> {
  const previousUser = previous?.user.id ?? null;
  const nextUser = next?.user.id ?? null;

  if (previousUser === nextUser) return;

  // Logout, or user-switch on the same device — wipe the local mirror.
  if (previousUser && previousUser !== nextUser) {
    try {
      await clearLocalUserData();
    } catch (clearError) {
      if (__DEV__) console.warn('[sync] failed to clear local data', clearError);
    }
  }

  // Brand-new session → record owner and pull from epoch.
  if (nextUser) {
    try {
      await writeSyncMeta(SYNC_META_KEYS.ownerUserId, nextUser);
    } catch (metaError) {
      if (__DEV__) console.warn('[sync] failed to record owner', metaError);
      return;
    }
    void pullChanges();
  }
}

/**
 * Single-flight pull. Concurrent callers share one network round-trip.
 * Network failures and missing-native-module errors are logged and
 * swallowed — sync is best-effort.
 */
async function pullChanges(): Promise<void> {
  if (pullPromiseInFlight) return pullPromiseInFlight;
  if (!getSession()) return;
  if (!isOnline()) return;

  pullPromiseInFlight = (async () => {
    let db: LocalDatabase;
    try {
      db = await getLocalDatabase();
    } catch (openError) {
      // Native module missing or DB open failed — keep app running.
      if (__DEV__) console.warn('[sync] local DB unavailable, skipping pull:', openError);
      return;
    }

    let cursor: string | null;
    try {
      cursor = await readSyncMeta(SYNC_META_KEYS.syncCursor);
    } catch (cursorError) {
      if (__DEV__) console.warn('[sync] cursor read failed', cursorError);
      cursor = null;
    }

    let changeset: SyncChangeset;
    try {
      changeset = await apiFetch<SyncChangeset>('/api/sync/pull', {
        method: 'GET',
        query: cursor ? {since: cursor} : undefined,
        offlineable: false, // sync is itself the offline strategy
      });
    } catch (networkError) {
      if (__DEV__) console.warn('[sync] pull failed', networkError);
      return;
    }

    if (!changeset || typeof changeset !== 'object' || !changeset.tables) {
      if (__DEV__) console.warn('[sync] malformed pull response', changeset);
      return;
    }

    let totals: ApplyResult = {upserts: 0, tombstones: 0};
    try {
      totals = await applyChangeset(db, changeset);
    } catch (applyError) {
      if (__DEV__) console.warn('[sync] apply failed', applyError);
      return;
    }

    if (changeset.cursor) {
      try {
        await writeSyncMeta(SYNC_META_KEYS.syncCursor, changeset.cursor);
      } catch (metaError) {
        if (__DEV__) console.warn('[sync] cursor write failed', metaError);
      }
    }

    if (totals.upserts > 0 || totals.tombstones > 0) {
      emitSyncCompletion();
    }
  })();

  try {
    await pullPromiseInFlight;
  } finally {
    pullPromiseInFlight = null;
  }
}

// ─── Changeset application ─────────────────────────────────────────────────

/**
 * Per-table whitelist of columns we know about locally. The server may
 * eventually grow new columns; quietly ignore them here so an updated
 * server doesn't crash older clients.
 */
const TABLE_COLUMNS: Record<SyncedTableName, readonly string[]> = {
  profiles: [
    'id', 'email', 'full_name',
    'primary_currency', 'secondary_currency',
    'created_at', 'updated_at',
  ],
  categories: [
    'id', 'user_id', 'name', 'type', 'color', 'icon', 'is_default',
    'created_at', 'updated_at', 'deleted_at',
  ],
  accounts: [
    'id', 'user_id', 'name', 'type', 'currency', 'is_default',
    'created_at', 'updated_at', 'deleted_at',
  ],
  transactions: [
    'id', 'user_id', 'account_id', 'category_id', 'type', 'amount',
    'currency', 'description', 'date', 'is_recurring', 'recurrence',
    'receipt_url', 'created_at', 'updated_at', 'deleted_at',
  ],
  budgets: [
    'id', 'user_id', 'category_id', 'amount', 'period', 'currency',
    'created_at', 'updated_at', 'deleted_at',
  ],
  savings_goals: [
    'id', 'user_id', 'name', 'target_amount', 'current_amount',
    'currency', 'deadline', 'color',
    'created_at', 'updated_at', 'deleted_at',
  ],
  investments: [
    'id', 'user_id', 'name', 'type', 'amount', 'currency', 'date',
    'notes', 'created_at', 'updated_at', 'deleted_at',
  ],
  savings_contributions: [
    'id', 'goal_id', 'user_id', 'amount', 'note', 'contributed_at',
    'created_at', 'updated_at', 'deleted_at',
  ],
  notification_settings: [
    'id', 'user_id', 'enabled', 'frequency', 'custom_interval_days',
    'notification_time', 'day_of_week', 'day_of_month',
    'spending_alerts_enabled', 'spending_alert_threshold',
    'budget_alerts_enabled', 'savings_alerts_enabled', 'investment_alerts_enabled',
    'created_at', 'updated_at',
  ],
};

/**
 * Tables that carry tombstones (deleted_at). For these, a row with a
 * non-null `deleted_at` is removed from the local mirror.
 */
const TABLES_WITH_TOMBSTONES = new Set<SyncedTableName>([
  'categories',
  'accounts',
  'transactions',
  'budgets',
  'savings_goals',
  'savings_contributions',
  'investments',
]);

async function applyChangeset(
  db: LocalDatabase,
  changeset: SyncChangeset,
): Promise<ApplyResult> {
  const commands: Array<{query: string; params?: readonly unknown[]}> = [];
  let upserts = 0;
  let tombstones = 0;

  for (const tableName of SYNCED_TABLES) {
    const rows = changeset.tables[tableName];
    if (!rows || rows.length === 0) continue;

    const columns = TABLE_COLUMNS[tableName];
    const handlesTombstones = TABLES_WITH_TOMBSTONES.has(tableName);

    for (const row of rows) {
      const id = row['id'];
      if (typeof id !== 'string' || !id) continue;

      // Tombstoned row → delete locally.
      if (handlesTombstones && row['deleted_at'] != null) {
        commands.push({
          query: `delete from ${tableName} where id = ?`,
          params: [id],
        });
        tombstones += 1;
        continue;
      }

      // Otherwise upsert. Build the column list / placeholders / values.
      const presentColumns = columns.filter(c => row[c] !== undefined);
      const placeholders = presentColumns.map(() => '?').join(', ');
      const values = presentColumns.map(c => normaliseValue(row[c]));
      const updateAssignments = presentColumns
        .filter(c => c !== 'id')
        .map(c => `${c} = excluded.${c}`)
        .join(', ');

      commands.push({
        query:
          `insert into ${tableName} (${presentColumns.join(', ')})
            values (${placeholders})
           on conflict(id) do update set ${updateAssignments}`,
        params: values,
      });
      upserts += 1;
    }
  }

  if (commands.length > 0) {
    await db.executeBatch(commands);
  }

  return {upserts, tombstones};
}

/**
 * Coerce JSON values into something op-sqlite can bind. Booleans →
 * 0/1; null/undefined → null; everything else passes through.
 */
function normaliseValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number') return value;
  // op-sqlite cannot bind objects; serialise. (Currently no synced
  // column is JSON, but defensive.)
  return JSON.stringify(value);
}
