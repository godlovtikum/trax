// Local-first DAO — every read tries the on-device SQLite mirror first
// and only falls back to the network when the mirror is empty AND has
// never been synced for this user. Every write commits to the local
// mirror SYNCHRONOUSLY so the React Query invalidation that follows
// always sees the new data, even when the device is offline or the
// server takes seconds to respond.
//
// The contract with `apiFetch` and the sync engine:
//
//   • For writes we generate a UUID on the device and pass it to the
//     server via `body.id` AND `Idempotency-Key`. The new
//     `*_create(p_id, …)` RPCs accept the supplied id, so the server
//     row and the local row share a primary key — `sync_pull` becomes
//     a no-op for that row instead of producing a duplicate.
//
//   • Network failures (`ApiError.isOfflineError === true`) keep the
//     local row in place; the offline write queue in `api.ts` will
//     replay the request when connectivity returns. Validation errors
//     (4xx, not 401, not 408) trigger a local rollback and re-throw so
//     the calling screen can show the message.
//
//   • The native module (`@op-engineering/op-sqlite`) is loaded
//     lazily by `getLocalDatabase`. If the build hasn't been rebuilt
//     yet (loadOpSqliteModule throws), every helper transparently
//     falls through to the original network-only behaviour.
//
// Identifier conventions: variables are spelled out (`localRows`,
// `serverResponse`, `categoryRow`) per master_context_file.md §3 — no
// `r`, `s`, `data`, `res` shorthands.

import {ApiError, apiFetch} from './api';
import {
  type LocalDatabase,
  getLocalDatabase,
  readSyncMeta,
  writeSyncMeta,
} from './db/connection';
import {SYNC_META_KEYS} from './db/schema';
import type {
  Account,
  AlertConfig,
  Budget,
  Category,
  CategoryBreakdown,
  Investment,
  MonthSeries,
  MonthlyStats,
  NotificationAlertType,
  NotificationSettings,
  Profile,
  SavingsContribution,
  SavingsGoal,
  Transaction,
  TransactionType,
} from '../types';

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Run `body` against the local SQLite mirror. Returns `null` (and
 * silently swallows the error in dev) when the native module isn't
 * linked or any SQL fails — the caller is expected to fall back to
 * `apiFetch`. We never throw here so a corrupted local cache can
 * never bring down a screen.
 */
async function tryLocalRead<RowShape>(
  body: (db: LocalDatabase) => Promise<RowShape>,
): Promise<RowShape | null> {
  try {
    const db = await getLocalDatabase();
    return await body(db);
  } catch (localError) {
    if (__DEV__) {
      console.warn('[trax/db] local read fell back to network:', localError);
    }
    return null;
  }
}

/**
 * Run `body` against the local SQLite mirror. Returns `false` when the
 * mirror isn't available so the caller can decide whether to skip the
 * local mutation step or surface an error.
 */
async function tryLocalWrite(
  body: (db: LocalDatabase) => Promise<void>,
): Promise<boolean> {
  try {
    const db = await getLocalDatabase();
    await body(db);
    return true;
  } catch (localError) {
    if (__DEV__) {
      console.warn('[trax/db] local write failed:', localError);
    }
    return false;
  }
}

/**
 * True when the cursor has been written by `sync_pull` at least once
 * for the current user — i.e. the local mirror is authoritative for
 * "no rows means really no rows" answers.
 */
async function hasCompletedInitialSync(): Promise<boolean> {
  try {
    const cursorValue = await readSyncMeta(SYNC_META_KEYS.syncCursor);
    return typeof cursorValue === 'string' && cursorValue.length > 0;
  } catch {
    return false;
  }
}

/**
 * Treats an ApiError as "real" (server rejected the body) instead of
 * "transient" (network blip, 5xx, expired session, request timeout).
 * Real errors trigger a local rollback so the UI doesn't drift.
 */
function isHardValidationError(thrownError: unknown): boolean {
  if (!(thrownError instanceof ApiError)) return false;
  if (thrownError.isOfflineError) return false;
  const status = thrownError.httpStatus;
  // 401 → session refresh handles it elsewhere; keep local row.
  // 408 → timeout, treat as transient.
  // 5xx → server bug, replay queue will retry on next mutation.
  if (status === 401 || status === 408) return false;
  return status >= 400 && status < 500;
}

const FALLBACK_NOW = (): string => new Date().toISOString();

/**
 * UUID v4 (random). Seeded from `Math.random()` because the host
 * environment doesn't ship a `crypto.getRandomValues` polyfill — the
 * collision space (~122 bits) is still ample for one device's row
 * inserts, and these ids are application-level keys, not secrets.
 */
function generateRowIdentifier(): string {
  const hexChars = '0123456789abcdef';
  let buffer = '';
  for (let charIndex = 0; charIndex < 36; charIndex++) {
    if (charIndex === 8 || charIndex === 13 || charIndex === 18 || charIndex === 23) {
      buffer += '-';
    } else if (charIndex === 14) {
      buffer += '4';
    } else if (charIndex === 19) {
      buffer += hexChars[(Math.random() * 4) | 8];
    } else {
      buffer += hexChars[(Math.random() * 16) | 0];
    }
  }
  return buffer;
}

// ─── row-shape converters ──────────────────────────────────────────────────

function asNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(raw: unknown): boolean {
  if (raw === 1 || raw === '1' || raw === true) return true;
  return false;
}

function asString(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw;
}

function rowToCategory(row: Record<string, unknown>): Category {
  return {
    id:         String(row['id']),
    user_id:    String(row['user_id']),
    name:       String(row['name'] ?? ''),
    type:       (row['type'] as Category['type']) ?? 'both',
    color:      String(row['color'] ?? '#6366F1'),
    icon:       String(row['icon'] ?? 'pricetag-outline'),
    is_default: asBoolean(row['is_default']),
    created_at: String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
}

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id:         String(row['id']),
    user_id:    String(row['user_id']),
    name:       String(row['name'] ?? ''),
    type:       (row['type'] as Account['type']) ?? 'bank',
    currency:   String(row['currency'] ?? 'XAF'),
    is_default: asBoolean(row['is_default']),
  };
}

function rowToTransaction(row: Record<string, unknown>): Transaction {
  const transaction: Transaction = {
    id:           String(row['id']),
    user_id:      String(row['user_id']),
    account_id:   String(row['account_id'] ?? ''),
    category_id:  String(row['category_id'] ?? ''),
    type:         (row['type'] as TransactionType) ?? 'expense',
    amount:       asNumber(row['amount']),
    currency:     String(row['currency'] ?? 'XAF'),
    description:  asString(row['description']),
    date:         String(row['date']),
    is_recurring: asBoolean(row['is_recurring']),
    recurrence:   asString(row['recurrence']) as Transaction['recurrence'],
    receipt_url:  asString(row['receipt_url']),
    created_at:   String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
  // Optional joined `category` and `account` columns are aliased with
  // a `cat_` / `acct_` prefix in the SELECT so SQLite doesn't squash
  // them onto the parent row's `id`/`name` columns.
  if (row['cat_id']) {
    transaction.category = {
      id:         String(row['cat_id']),
      user_id:    transaction.user_id,
      name:       String(row['cat_name'] ?? ''),
      type:       (row['cat_type'] as Category['type']) ?? 'both',
      color:      String(row['cat_color'] ?? '#6366F1'),
      icon:       String(row['cat_icon'] ?? 'pricetag-outline'),
      is_default: false,
      created_at: '',
    };
  }
  if (row['acct_id']) {
    transaction.account = {
      id:         String(row['acct_id']),
      user_id:    transaction.user_id,
      name:       String(row['acct_name'] ?? ''),
      type:       (row['acct_type'] as Account['type']) ?? 'bank',
      currency:   String(row['acct_currency'] ?? 'XAF'),
      is_default: asBoolean(row['acct_is_default']),
    };
  }
  return transaction;
}

function rowToBudget(row: Record<string, unknown>): Budget {
  const budget: Budget = {
    id:          String(row['id']),
    user_id:     String(row['user_id']),
    category_id: row['category_id'] ? String(row['category_id']) : undefined,
    amount:      asNumber(row['amount']),
    period:      (row['period'] as Budget['period']) ?? 'monthly',
    currency:    String(row['currency'] ?? 'XAF'),
    created_at:  String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
  if (row['cat_id']) {
    budget.category = {
      id:         String(row['cat_id']),
      user_id:    budget.user_id,
      name:       String(row['cat_name'] ?? ''),
      type:       (row['cat_type'] as Category['type']) ?? 'both',
      color:      String(row['cat_color'] ?? '#6366F1'),
      icon:       String(row['cat_icon'] ?? 'pricetag-outline'),
      is_default: false,
      created_at: '',
    };
  }
  if (row['spent'] !== undefined) {
    const spentAmount = asNumber(row['spent']);
    budget.spent = spentAmount;
    if (budget.amount > 0) {
      budget.percentage = Math.min(100, (spentAmount / budget.amount) * 100);
      budget.remaining = Math.max(0, budget.amount - spentAmount);
    } else {
      budget.percentage = 0;
      budget.remaining = 0;
    }
  }
  return budget;
}

function rowToSavingsGoal(row: Record<string, unknown>): SavingsGoal {
  return {
    id:             String(row['id']),
    user_id:        String(row['user_id']),
    name:           String(row['name'] ?? ''),
    target_amount:  asNumber(row['target_amount']),
    current_amount: asNumber(row['current_amount']),
    currency:       String(row['currency'] ?? 'XAF'),
    deadline:       asString(row['deadline']),
    color:          String(row['color'] ?? '#10B981'),
    created_at:     String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
}

function rowToInvestment(row: Record<string, unknown>): Investment {
  return {
    id:         String(row['id']),
    user_id:    String(row['user_id']),
    name:       String(row['name'] ?? ''),
    type:       (row['type'] as Investment['type']) ?? 'other',
    amount:     asNumber(row['amount']),
    currency:   String(row['currency'] ?? 'XAF'),
    date:       String(row['date']),
    notes:      asString(row['notes']),
    created_at: String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
}

function rowToProfile(row: Record<string, unknown>): Profile {
  return {
    id:                 String(row['id']),
    email:              String(row['email'] ?? ''),
    full_name:          asString(row['full_name']),
    primary_currency:   String(row['primary_currency'] ?? 'XAF'),
    secondary_currency: String(row['secondary_currency'] ?? 'USD'),
    created_at:         String(row['created_at'] ?? ''),
  };
}

function rowToNotificationSettings(
  row: Record<string, unknown>,
): NotificationSettings {
  return {
    id:                       String(row['id']),
    user_id:                  String(row['user_id']),
    enabled:                  asBoolean(row['enabled']),
    frequency:                (row['frequency'] as NotificationSettings['frequency']) ?? 'daily',
    custom_interval_days:     row['custom_interval_days'] != null ? asNumber(row['custom_interval_days']) : undefined,
    notification_time:        String(row['notification_time'] ?? '20:00'),
    day_of_week:              row['day_of_week'] != null ? asNumber(row['day_of_week']) : undefined,
    day_of_month:             row['day_of_month'] != null ? asNumber(row['day_of_month']) : undefined,
    spending_alerts_enabled:  asBoolean(row['spending_alerts_enabled'] ?? 1),
    spending_alert_threshold: row['spending_alert_threshold'] != null ? asNumber(row['spending_alert_threshold']) : 50000,
    budget_alerts_enabled:    asBoolean(row['budget_alerts_enabled'] ?? 1),
    savings_alerts_enabled:   asBoolean(row['savings_alerts_enabled'] ?? 0),
    investment_alerts_enabled: asBoolean(row['investment_alerts_enabled'] ?? 0),
    created_at:               String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
}

// Persist a server-shaped row into the local mirror. Used by the
// fallback path in reads so a successful network round trip seeds the
// mirror the first time a screen loads on a fresh install. We do a
// best-effort upsert and silently move on if the local DB is missing.
async function persistTransactionsLocally(
  records: readonly Transaction[],
): Promise<void> {
  if (records.length === 0) return;
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    const commands = records.map(record => ({
      query:
        `insert into transactions (
           id, user_id, account_id, category_id, type, amount, currency,
           description, date, is_recurring, recurrence, receipt_url,
           created_at, updated_at, deleted_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         on conflict(id) do update set
           account_id   = excluded.account_id,
           category_id  = excluded.category_id,
           type         = excluded.type,
           amount       = excluded.amount,
           currency     = excluded.currency,
           description  = excluded.description,
           date         = excluded.date,
           is_recurring = excluded.is_recurring,
           recurrence   = excluded.recurrence,
           receipt_url  = excluded.receipt_url,
           updated_at   = excluded.updated_at`,
      params: [
        record.id, record.user_id, record.account_id || null, record.category_id || null,
        record.type, record.amount, record.currency,
        record.description ?? null, record.date,
        record.is_recurring ? 1 : 0, record.recurrence ?? null, record.receipt_url ?? null,
        record.created_at || now, now,
      ],
    }));
    // Also persist any joined categories/accounts so subsequent local
    // reads can render the rich row without another network call.
    for (const record of records) {
      if (record.category) {
        commands.push({
          query:
            `insert into categories (id, user_id, name, type, color, icon, is_default, created_at, updated_at, deleted_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
             on conflict(id) do update set
               name = excluded.name, type = excluded.type, color = excluded.color,
               icon = excluded.icon, is_default = excluded.is_default,
               updated_at = excluded.updated_at`,
          params: [
            record.category.id, record.category.user_id, record.category.name,
            record.category.type, record.category.color, record.category.icon,
            record.category.is_default ? 1 : 0,
            record.category.created_at || now, now,
          ],
        });
      }
      if (record.account) {
        commands.push({
          query:
            `insert into accounts (id, user_id, name, type, currency, is_default, created_at, updated_at, deleted_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             on conflict(id) do update set
               name = excluded.name, type = excluded.type, currency = excluded.currency,
               is_default = excluded.is_default, updated_at = excluded.updated_at`,
          params: [
            record.account.id, record.account.user_id, record.account.name,
            record.account.type, record.account.currency,
            record.account.is_default ? 1 : 0,
            now, now,
          ],
        });
      }
    }
    await db.executeBatch(commands);
  });
}

async function persistCategoriesLocally(
  records: readonly Category[],
): Promise<void> {
  if (records.length === 0) return;
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.executeBatch(
      records.map(record => ({
        query:
          `insert into categories (id, user_id, name, type, color, icon, is_default, created_at, updated_at, deleted_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           on conflict(id) do update set
             name = excluded.name, type = excluded.type, color = excluded.color,
             icon = excluded.icon, is_default = excluded.is_default,
             updated_at = excluded.updated_at`,
        params: [
          record.id, record.user_id, record.name, record.type,
          record.color, record.icon, record.is_default ? 1 : 0,
          record.created_at || now, now,
        ],
      })),
    );
  });
}

async function persistAccountsLocally(
  records: readonly Account[],
): Promise<void> {
  if (records.length === 0) return;
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.executeBatch(
      records.map(record => ({
        query:
          `insert into accounts (id, user_id, name, type, currency, is_default, created_at, updated_at, deleted_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, NULL)
           on conflict(id) do update set
             name = excluded.name, type = excluded.type, currency = excluded.currency,
             is_default = excluded.is_default, updated_at = excluded.updated_at`,
        params: [
          record.id, record.user_id, record.name, record.type,
          record.currency, record.is_default ? 1 : 0,
          now, now,
        ],
      })),
    );
  });
}

async function persistBudgetsLocally(records: readonly Budget[]): Promise<void> {
  if (records.length === 0) return;
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.executeBatch(
      records.map(record => ({
        query:
          `insert into budgets (id, user_id, category_id, amount, period, currency, created_at, updated_at, deleted_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, NULL)
           on conflict(id) do update set
             category_id = excluded.category_id,
             amount = excluded.amount, period = excluded.period,
             currency = excluded.currency, updated_at = excluded.updated_at`,
        params: [
          record.id, record.user_id, record.category_id ?? null,
          record.amount, record.period, record.currency,
          record.created_at || now, now,
        ],
      })),
    );
  });
}

async function persistSavingsGoalsLocally(
  records: readonly SavingsGoal[],
): Promise<void> {
  if (records.length === 0) return;
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.executeBatch(
      records.map(record => ({
        query:
          `insert into savings_goals (
             id, user_id, name, target_amount, current_amount, currency,
             deadline, color, created_at, updated_at, deleted_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           on conflict(id) do update set
             name = excluded.name, target_amount = excluded.target_amount,
             current_amount = excluded.current_amount,
             currency = excluded.currency, deadline = excluded.deadline,
             color = excluded.color, updated_at = excluded.updated_at`,
        params: [
          record.id, record.user_id, record.name, record.target_amount,
          record.current_amount, record.currency, record.deadline ?? null,
          record.color, record.created_at || now, now,
        ],
      })),
    );
  });
}

async function persistInvestmentsLocally(
  records: readonly Investment[],
): Promise<void> {
  if (records.length === 0) return;
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.executeBatch(
      records.map(record => ({
        query:
          `insert into investments (id, user_id, name, type, amount, currency, date, notes, created_at, updated_at, deleted_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           on conflict(id) do update set
             name = excluded.name, type = excluded.type, amount = excluded.amount,
             currency = excluded.currency, date = excluded.date,
             notes = excluded.notes, updated_at = excluded.updated_at`,
        params: [
          record.id, record.user_id, record.name, record.type, record.amount,
          record.currency, record.date, record.notes ?? null,
          record.created_at || now, now,
        ],
      })),
    );
  });
}

async function persistProfileLocally(profile: Profile): Promise<void> {
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.execute(
      `insert into profiles (id, email, full_name, primary_currency, secondary_currency, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         email = excluded.email, full_name = excluded.full_name,
         primary_currency = excluded.primary_currency,
         secondary_currency = excluded.secondary_currency,
         updated_at = excluded.updated_at`,
      [
        profile.id, profile.email, profile.full_name ?? null,
        profile.primary_currency, profile.secondary_currency,
        profile.created_at || now, now,
      ],
    );
    // Remember which user this device is bound to so the sync engine
    // can clear the mirror on logout.
    await db.execute(
      `insert into sync_meta(key, value) values (?, ?)
         on conflict(key) do update set value = excluded.value`,
      [SYNC_META_KEYS.ownerUserId, profile.id],
    );
  });
}

async function persistNotificationSettingsLocally(
  record: NotificationSettings,
): Promise<void> {
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    await db.execute(
      `insert into notification_settings (
         id, user_id, enabled, frequency, custom_interval_days,
         notification_time, day_of_week, day_of_month,
         spending_alerts_enabled, spending_alert_threshold,
         budget_alerts_enabled, savings_alerts_enabled, investment_alerts_enabled,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         enabled                   = excluded.enabled,
         frequency                 = excluded.frequency,
         custom_interval_days      = excluded.custom_interval_days,
         notification_time         = excluded.notification_time,
         day_of_week               = excluded.day_of_week,
         day_of_month              = excluded.day_of_month,
         spending_alerts_enabled   = excluded.spending_alerts_enabled,
         spending_alert_threshold  = excluded.spending_alert_threshold,
         budget_alerts_enabled     = excluded.budget_alerts_enabled,
         savings_alerts_enabled    = excluded.savings_alerts_enabled,
         investment_alerts_enabled = excluded.investment_alerts_enabled,
         updated_at                = excluded.updated_at`,
      [
        record.id, record.user_id, record.enabled ? 1 : 0,
        record.frequency, record.custom_interval_days ?? null,
        record.notification_time, record.day_of_week ?? null,
        record.day_of_month ?? null,
        record.spending_alerts_enabled   ? 1 : 0,
        record.spending_alert_threshold  ?? 50000,
        record.budget_alerts_enabled     ? 1 : 0,
        record.savings_alerts_enabled    ? 1 : 0,
        record.investment_alerts_enabled ? 1 : 0,
        record.created_at || now, now,
      ],
    );
  });
}

// ─── Profile ───────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const localProfile = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from profiles where id = ? limit 1`,
      [userId],
    );
    const row = result.rows?._array?.[0];
    return row ? rowToProfile(row) : null;
  });
  if (localProfile) return localProfile;

  // Fall through to network — and seed locally so subsequent reads
  // don't need the network either.
  const serverProfile = await apiFetch<Profile | null>('/api/profile');
  if (serverProfile) {
    await persistProfileLocally(serverProfile);
  }
  return serverProfile;
}

export async function updateProfile(
  _userId: string,
  updates: Partial<Profile>,
): Promise<void> {
  // Apply locally first so currency/name changes appear immediately.
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    const setFragments: string[] = ['updated_at = ?'];
    const queryParams: unknown[] = [now];
    if (updates.full_name !== undefined) {
      setFragments.push('full_name = ?');
      queryParams.push(updates.full_name ?? null);
    }
    if (updates.primary_currency !== undefined) {
      setFragments.push('primary_currency = ?');
      queryParams.push(updates.primary_currency);
    }
    if (updates.secondary_currency !== undefined) {
      setFragments.push('secondary_currency = ?');
      queryParams.push(updates.secondary_currency);
    }
    if (updates.email !== undefined) {
      setFragments.push('email = ?');
      queryParams.push(updates.email);
    }
    queryParams.push(_userId);
    await db.execute(
      `update profiles set ${setFragments.join(', ')} where id = ?`,
      queryParams,
    );
  });

  await apiFetch('/api/profile', {method: 'PATCH', body: updates});
}

// ─── Categories ────────────────────────────────────────────────────────────

export async function seedDefaultCategories(_userId: string): Promise<void> {
  // Server seeds on signup automatically. The endpoint is a no-op for
  // existing users; we keep the call so legacy code paths continue to
  // work but never block on it offline.
  try {
    await apiFetch('/api/categories/seed', {method: 'POST'});
  } catch (seedError) {
    if (!(seedError instanceof ApiError && seedError.isOfflineError)) throw seedError;
  }
}

export async function getCategories(userId: string): Promise<Category[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from categories
       where user_id = ? and deleted_at is null
       order by is_default desc, name asc`,
      [userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToCategory);
  }

  const serverRows = await apiFetch<Category[]>('/api/categories');
  await persistCategoriesLocally(serverRows);
  return serverRows;
}

export async function addCategory(
  category: Omit<Category, 'id' | 'created_at'>,
): Promise<Category> {
  const newCategoryId = generateRowIdentifier();
  const createdAt = FALLBACK_NOW();
  const optimisticRow: Category = {
    id: newCategoryId,
    created_at: createdAt,
    ...category,
  };

  await tryLocalWrite(async db => {
    await db.execute(
      `insert into categories (id, user_id, name, type, color, icon, is_default, created_at, updated_at, deleted_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        newCategoryId, category.user_id, category.name, category.type,
        category.color, category.icon, category.is_default ? 1 : 0,
        createdAt, createdAt,
      ],
    );
  });

  try {
    const serverRow = await apiFetch<Category>('/api/categories', {
      method: 'POST',
      body: {...category, id: newCategoryId},
      idempotencyKey: newCategoryId,
    });
    return serverRow ?? optimisticRow;
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(`delete from categories where id = ?`, [newCategoryId]);
      });
      throw writeError;
    }
    return optimisticRow;
  }
}

export async function updateCategory(
  id: string,
  updates: Partial<Category>,
): Promise<void> {
  await tryLocalWrite(async db => {
    const now = FALLBACK_NOW();
    const setFragments: string[] = ['updated_at = ?'];
    const queryParams: unknown[] = [now];
    if (updates.name !== undefined) { setFragments.push('name = ?'); queryParams.push(updates.name); }
    if (updates.color !== undefined) { setFragments.push('color = ?'); queryParams.push(updates.color); }
    if (updates.icon !== undefined) { setFragments.push('icon = ?'); queryParams.push(updates.icon); }
    if (updates.type !== undefined) { setFragments.push('type = ?'); queryParams.push(updates.type); }
    queryParams.push(id);
    await db.execute(
      `update categories set ${setFragments.join(', ')} where id = ?`,
      queryParams,
    );
  });

  await apiFetch(`/api/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: updates,
    idempotencyKey: `cat-update-${id}-${FALLBACK_NOW()}`,
  });
}

export async function deleteCategory(id: string): Promise<void> {
  const deletionTimestamp = FALLBACK_NOW();
  await tryLocalWrite(async db => {
    await db.execute(
      `update categories set deleted_at = ?, updated_at = ? where id = ?`,
      [deletionTimestamp, deletionTimestamp, id],
    );
  });

  try {
    await apiFetch(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      idempotencyKey: `cat-delete-${id}`,
    });
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(
          `update categories set deleted_at = NULL, updated_at = ? where id = ?`,
          [FALLBACK_NOW(), id],
        );
      });
      throw writeError;
    }
  }
}

// ─── Accounts ──────────────────────────────────────────────────────────────

export async function getAccounts(userId: string): Promise<Account[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from accounts
       where user_id = ? and deleted_at is null
       order by is_default desc, name asc`,
      [userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToAccount);
  }

  const serverRows = await apiFetch<Account[]>('/api/accounts');
  await persistAccountsLocally(serverRows);
  return serverRows;
}

export async function createDefaultAccount(
  userId: string,
  currency = 'XAF',
): Promise<Account> {
  // The server enforces a uniqueness check on (user_id, is_default=true)
  // so we keep this network-first; but mirror the result locally so
  // subsequent `getDefaultAccount` calls don't need a round-trip.
  const serverRow = await apiFetch<Account>('/api/accounts/default', {
    method: 'POST',
    body: {currency},
    idempotencyKey: `acct-default-${userId}`,
  });
  if (serverRow) await persistAccountsLocally([serverRow]);
  return serverRow;
}

export async function getDefaultAccount(userId: string): Promise<Account | null> {
  const localRow = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from accounts
       where user_id = ? and is_default = 1 and deleted_at is null
       limit 1`,
      [userId],
    );
    const row = result.rows?._array?.[0];
    return row ? rowToAccount(row) : null;
  });
  if (localRow) return localRow;
  if (await hasCompletedInitialSync()) return null;

  const serverRow = await apiFetch<Account | null>('/api/accounts/default');
  if (serverRow) await persistAccountsLocally([serverRow]);
  return serverRow;
}

// ─── Transactions ──────────────────────────────────────────────────────────

export async function getTransactions(
  userId: string,
  opts?: {type?: TransactionType; limit?: number; offset?: number},
): Promise<Transaction[]> {
  const requestedLimit = Math.max(1, Math.min(opts?.limit ?? 200, 500));
  const requestedOffset = Math.max(0, opts?.offset ?? 0);

  const localRows = await tryLocalRead(async db => {
    const queryParams: unknown[] = [userId];
    let typeFragment = '';
    if (opts?.type) {
      typeFragment = ' and t.type = ?';
      queryParams.push(opts.type);
    }
    queryParams.push(requestedLimit, requestedOffset);
    const result = await db.execute(
      `select t.*,
              c.id as cat_id, c.name as cat_name, c.color as cat_color,
              c.icon as cat_icon, c.type as cat_type,
              a.id as acct_id, a.name as acct_name, a.type as acct_type,
              a.currency as acct_currency, a.is_default as acct_is_default
         from transactions t
         left join categories c on c.id = t.category_id and c.deleted_at is null
         left join accounts   a on a.id = t.account_id  and a.deleted_at is null
        where t.user_id = ? and t.deleted_at is null${typeFragment}
        order by t.date desc, t.created_at desc, t.id desc
        limit ? offset ?`,
      queryParams,
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToTransaction);
  }

  const serverRows = await apiFetch<Transaction[]>('/api/transactions', {
    query: opts as Record<string, string | number | undefined>,
  });
  await persistTransactionsLocally(serverRows);
  return serverRows;
}

export async function addTransaction(
  transactionInput: Omit<Transaction, 'id' | 'created_at'>,
): Promise<Transaction> {
  const newTransactionId = generateRowIdentifier();
  const createdAt = FALLBACK_NOW();

  // Resolve a local default account when the caller passed an empty
  // string (the AddTransactionScreen falls back to '' when the server
  // hasn't finished bootstrapping). The server still accepts null,
  // but committing null locally makes the row visible to the user.
  let resolvedAccountId: string | null = transactionInput.account_id || null;
  if (!resolvedAccountId) {
    const fallbackAccount = await tryLocalRead(async db => {
      const result = await db.execute(
        `select id from accounts
         where user_id = ? and is_default = 1 and deleted_at is null
         limit 1`,
        [transactionInput.user_id],
      );
      return result.rows?._array?.[0]?.['id'] ?? null;
    });
    if (typeof fallbackAccount === 'string') {
      resolvedAccountId = fallbackAccount;
    }
  }

  const optimisticRow: Transaction = {
    id: newTransactionId,
    created_at: createdAt,
    ...transactionInput,
    account_id: resolvedAccountId ?? '',
  };

  // Pull the joined category for an immediate, complete display.
  const joinedCategory = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from categories where id = ? limit 1`,
      [transactionInput.category_id],
    );
    const row = result.rows?._array?.[0];
    return row ? rowToCategory(row) : null;
  });
  if (joinedCategory) optimisticRow.category = joinedCategory;

  await tryLocalWrite(async db => {
    await db.execute(
      `insert into transactions (
         id, user_id, account_id, category_id, type, amount, currency,
         description, date, is_recurring, recurrence, receipt_url,
         created_at, updated_at, deleted_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        newTransactionId, transactionInput.user_id,
        resolvedAccountId, transactionInput.category_id,
        transactionInput.type, transactionInput.amount,
        transactionInput.currency,
        transactionInput.description ?? null, transactionInput.date,
        transactionInput.is_recurring ? 1 : 0,
        transactionInput.recurrence ?? null,
        transactionInput.receipt_url ?? null,
        createdAt, createdAt,
      ],
    );
  });

  try {
    const serverRow = await apiFetch<Transaction>('/api/transactions', {
      method: 'POST',
      body: {
        ...transactionInput,
        id: newTransactionId,
        account_id: resolvedAccountId ?? undefined,
      },
      idempotencyKey: newTransactionId,
    });
    if (serverRow?.id) {
      await persistTransactionsLocally([serverRow]);
      return serverRow;
    }
    return optimisticRow;
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(`delete from transactions where id = ?`, [newTransactionId]);
      });
      throw writeError;
    }
    return optimisticRow;
  }
}

export async function deleteTransaction(id: string): Promise<void> {
  const deletionTimestamp = FALLBACK_NOW();
  await tryLocalWrite(async db => {
    await db.execute(
      `update transactions set deleted_at = ?, updated_at = ? where id = ?`,
      [deletionTimestamp, deletionTimestamp, id],
    );
  });

  try {
    await apiFetch(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      idempotencyKey: `tx-delete-${id}`,
    });
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(
          `update transactions set deleted_at = NULL, updated_at = ? where id = ?`,
          [FALLBACK_NOW(), id],
        );
      });
      throw writeError;
    }
  }
}

// ─── Budgets ───────────────────────────────────────────────────────────────

export async function getBudgets(userId: string): Promise<Budget[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select b.*,
              c.id as cat_id, c.name as cat_name, c.color as cat_color,
              c.icon as cat_icon, c.type as cat_type
         from budgets b
         left join categories c on c.id = b.category_id and c.deleted_at is null
        where b.user_id = ? and b.deleted_at is null
        order by b.created_at desc`,
      [userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToBudget);
  }

  const serverRows = await apiFetch<Budget[]>('/api/budgets');
  await persistBudgetsLocally(serverRows);
  return serverRows;
}

export async function upsertBudget(
  budget: Omit<Budget, 'id' | 'created_at' | 'spent' | 'percentage'>,
): Promise<void> {
  const targetId = generateRowIdentifier();
  const createdAt = FALLBACK_NOW();

  await tryLocalWrite(async db => {
    // Upsert by (user_id, category_id) — match the server's behaviour.
    if (budget.category_id) {
      await db.execute(
        `delete from budgets where user_id = ? and coalesce(category_id, '') = ?`,
        [budget.user_id, budget.category_id],
      );
    }
    await db.execute(
      `insert into budgets (id, user_id, category_id, amount, period, currency, created_at, updated_at, deleted_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        targetId, budget.user_id, budget.category_id ?? null,
        budget.amount, budget.period, budget.currency,
        createdAt, createdAt,
      ],
    );
  });

  await apiFetch('/api/budgets', {
    method: 'POST',
    body: budget,
    idempotencyKey: `budget-upsert-${budget.user_id}-${budget.category_id ?? 'none'}`,
  });
}

export async function deleteBudget(id: string): Promise<void> {
  const deletionTimestamp = FALLBACK_NOW();
  await tryLocalWrite(async db => {
    await db.execute(
      `update budgets set deleted_at = ?, updated_at = ? where id = ?`,
      [deletionTimestamp, deletionTimestamp, id],
    );
  });

  try {
    await apiFetch(`/api/budgets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      idempotencyKey: `budget-delete-${id}`,
    });
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(
          `update budgets set deleted_at = NULL, updated_at = ? where id = ?`,
          [FALLBACK_NOW(), id],
        );
      });
      throw writeError;
    }
  }
}

export async function getBudgetUsage(userId: string): Promise<Budget[]> {
  // Budget usage = budget rows joined with the sum of expense
  // transactions inside the current period. We compute it locally so
  // the dashboard tile updates the instant a transaction is added.
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select b.*,
              c.id as cat_id, c.name as cat_name, c.color as cat_color,
              c.icon as cat_icon, c.type as cat_type,
              coalesce((
                select sum(t.amount)
                  from transactions t
                 where t.user_id = b.user_id
                   and t.deleted_at is null
                   and t.type = 'expense'
                   and (b.category_id is null or t.category_id = b.category_id)
                   and t.date >= strftime('%Y-%m-01', 'now')
                   and t.date <  date(strftime('%Y-%m-01', 'now'), '+1 month')
              ), 0) as spent
         from budgets b
         left join categories c on c.id = b.category_id and c.deleted_at is null
        where b.user_id = ? and b.deleted_at is null
        order by b.created_at desc`,
      [userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToBudget);
  }

  const serverRows = await apiFetch<Budget[]>('/api/budgets/usage');
  // Persist the underlying budget rows (without the computed `spent`)
  // so subsequent reads benefit from the local cache.
  await persistBudgetsLocally(
    serverRows.map(({spent: _spent, percentage: _percentage, remaining: _remaining, ...rest}) => rest),
  );
  return serverRows;
}

// ─── Savings Goals ─────────────────────────────────────────────────────────

export async function getSavingsGoals(userId: string): Promise<SavingsGoal[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from savings_goals
       where user_id = ? and deleted_at is null
       order by created_at desc`,
      [userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToSavingsGoal);
  }

  const serverRows = await apiFetch<SavingsGoal[]>('/api/savings-goals');
  await persistSavingsGoalsLocally(serverRows);
  return serverRows;
}

export async function upsertSavingsGoal(
  goal: Omit<SavingsGoal, 'id' | 'created_at'> & {id?: string},
): Promise<void> {
  const targetId = goal.id ?? generateRowIdentifier();
  const createdAt = FALLBACK_NOW();

  await tryLocalWrite(async db => {
    await db.execute(
      `insert into savings_goals (
         id, user_id, name, target_amount, current_amount, currency,
         deadline, color, created_at, updated_at, deleted_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       on conflict(id) do update set
         name = excluded.name, target_amount = excluded.target_amount,
         current_amount = excluded.current_amount,
         currency = excluded.currency, deadline = excluded.deadline,
         color = excluded.color, updated_at = excluded.updated_at,
         deleted_at = NULL`,
      [
        targetId, goal.user_id, goal.name, goal.target_amount,
        goal.current_amount, goal.currency, goal.deadline ?? null,
        goal.color, createdAt, createdAt,
      ],
    );
  });

  await apiFetch('/api/savings-goals', {
    method: 'POST',
    body: {...goal, id: targetId},
    idempotencyKey: `savings-${targetId}`,
  });
}

export async function getSavingsGoal(
  goalId: string,
  userId: string,
): Promise<SavingsGoal | null> {
  const localRow = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from savings_goals
       where id = ? and user_id = ? and deleted_at is null
       limit 1`,
      [goalId, userId],
    );
    const row = result.rows?._array?.[0];
    return row ? rowToSavingsGoal(row) : null;
  });
  if (localRow) return localRow;

  // Fall through to the list endpoint and search.
  const serverRows = await apiFetch<SavingsGoal[]>('/api/savings-goals');
  await persistSavingsGoalsLocally(serverRows);
  return serverRows.find(g => g.id === goalId) ?? null;
}

// ── Savings Contributions ──────────────────────────────────────────────────

function rowToSavingsContribution(
  row: Record<string, unknown>,
): SavingsContribution {
  return {
    id:             String(row['id']),
    goal_id:        String(row['goal_id']),
    user_id:        String(row['user_id']),
    amount:         asNumber(row['amount']),
    note:           row['note'] != null ? String(row['note']) : undefined,
    contributed_at: String(row['contributed_at']),
    created_at:     String(row['created_at'] ?? row['updated_at'] ?? ''),
  };
}

async function persistContributionsLocally(
  records: readonly SavingsContribution[],
): Promise<void> {
  if (records.length === 0) return;
  const now = FALLBACK_NOW();
  await tryLocalWrite(async db => {
    await db.executeBatch(
      records.map(record => ({
        query: `insert into savings_contributions
                (id, goal_id, user_id, amount, note, contributed_at,
                 created_at, updated_at, deleted_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                on conflict(id) do update set
                  amount         = excluded.amount,
                  note           = excluded.note,
                  contributed_at = excluded.contributed_at,
                  updated_at     = excluded.updated_at`,
        params: [
          record.id, record.goal_id, record.user_id,
          record.amount, record.note ?? null,
          record.contributed_at,
          record.created_at || now, now,
        ],
      })),
    );
  });
}

export async function getSavingsContributions(
  goalId: string,
  userId: string,
): Promise<SavingsContribution[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from savings_contributions
       where goal_id = ? and user_id = ? and deleted_at is null
       order by contributed_at desc, created_at desc`,
      [goalId, userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && localRows.length > 0) {
    return localRows.map(rowToSavingsContribution);
  }

  const serverRows = await apiFetch<SavingsContribution[]>(
    `/api/savings-goals/${encodeURIComponent(goalId)}/contributions`,
  );
  await persistContributionsLocally(serverRows);
  return serverRows;
}

export async function addSavingsContribution(
  contribution: Omit<SavingsContribution, 'id' | 'created_at'>,
): Promise<SavingsContribution> {
  const newId    = generateRowIdentifier();
  const now      = FALLBACK_NOW();

  const optimisticRow: SavingsContribution = {
    id: newId,
    created_at: now,
    ...contribution,
  };

  // Write the contribution row AND bump goal.current_amount atomically.
  await tryLocalWrite(async db => {
    await db.executeBatch([
      {
        query: `insert into savings_contributions
                (id, goal_id, user_id, amount, note, contributed_at,
                 created_at, updated_at, deleted_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        params: [
          newId, contribution.goal_id, contribution.user_id,
          contribution.amount, contribution.note ?? null,
          contribution.contributed_at, now, now,
        ],
      },
      {
        query: `update savings_goals
                set current_amount = current_amount + ?, updated_at = ?
                where id = ? and user_id = ?`,
        params: [
          contribution.amount, now,
          contribution.goal_id, contribution.user_id,
        ],
      },
    ]);
  });

  try {
    const serverRow = await apiFetch<SavingsContribution>(
      `/api/savings-goals/${encodeURIComponent(contribution.goal_id)}/contributions`,
      {
        method: 'POST',
        body:   {...contribution, id: newId},
        idempotencyKey: newId,
      },
    );
    if (serverRow?.id) {
      await persistContributionsLocally([serverRow]);
      return serverRow;
    }
    return optimisticRow;
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      // Rollback both the contribution insert and the goal amount bump.
      await tryLocalWrite(async db => {
        await db.executeBatch([
          {
            query: `delete from savings_contributions where id = ?`,
            params: [newId],
          },
          {
            query: `update savings_goals
                    set current_amount = current_amount - ?, updated_at = ?
                    where id = ? and user_id = ?`,
            params: [
              contribution.amount, FALLBACK_NOW(),
              contribution.goal_id, contribution.user_id,
            ],
          },
        ]);
      });
      throw writeError;
    }
    return optimisticRow;
  }
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const deletionTimestamp = FALLBACK_NOW();
  await tryLocalWrite(async db => {
    await db.execute(
      `update savings_goals set deleted_at = ?, updated_at = ? where id = ?`,
      [deletionTimestamp, deletionTimestamp, id],
    );
  });

  try {
    await apiFetch(`/api/savings-goals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      idempotencyKey: `savings-delete-${id}`,
    });
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(
          `update savings_goals set deleted_at = NULL, updated_at = ? where id = ?`,
          [FALLBACK_NOW(), id],
        );
      });
      throw writeError;
    }
  }
}

// ─── Investments ───────────────────────────────────────────────────────────

export async function getInvestments(userId: string): Promise<Investment[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from investments
       where user_id = ? and deleted_at is null
       order by date desc, created_at desc`,
      [userId],
    );
    return result.rows?._array ?? [];
  });

  if (localRows && (localRows.length > 0 || (await hasCompletedInitialSync()))) {
    return localRows.map(rowToInvestment);
  }

  const serverRows = await apiFetch<Investment[]>('/api/investments');
  await persistInvestmentsLocally(serverRows);
  return serverRows;
}

export async function addInvestment(
  investmentInput: Omit<Investment, 'id' | 'created_at'>,
): Promise<Investment> {
  const newInvestmentId = generateRowIdentifier();
  const createdAt = FALLBACK_NOW();
  const optimisticRow: Investment = {
    id: newInvestmentId,
    created_at: createdAt,
    ...investmentInput,
  };

  await tryLocalWrite(async db => {
    await db.execute(
      `insert into investments (id, user_id, name, type, amount, currency, date, notes, created_at, updated_at, deleted_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        newInvestmentId, investmentInput.user_id, investmentInput.name,
        investmentInput.type, investmentInput.amount, investmentInput.currency,
        investmentInput.date, investmentInput.notes ?? null,
        createdAt, createdAt,
      ],
    );
  });

  try {
    const serverRow = await apiFetch<Investment>('/api/investments', {
      method: 'POST',
      body: {...investmentInput, id: newInvestmentId},
      idempotencyKey: newInvestmentId,
    });
    return serverRow ?? optimisticRow;
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(`delete from investments where id = ?`, [newInvestmentId]);
      });
      throw writeError;
    }
    return optimisticRow;
  }
}

export async function deleteInvestment(id: string): Promise<void> {
  const deletionTimestamp = FALLBACK_NOW();
  await tryLocalWrite(async db => {
    await db.execute(
      `update investments set deleted_at = ?, updated_at = ? where id = ?`,
      [deletionTimestamp, deletionTimestamp, id],
    );
  });

  try {
    await apiFetch(`/api/investments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      idempotencyKey: `inv-delete-${id}`,
    });
  } catch (writeError) {
    if (isHardValidationError(writeError)) {
      await tryLocalWrite(async db => {
        await db.execute(
          `update investments set deleted_at = NULL, updated_at = ? where id = ?`,
          [FALLBACK_NOW(), id],
        );
      });
      throw writeError;
    }
  }
}

// ─── Stats (computed locally) ──────────────────────────────────────────────
//
// All three stats endpoints are aggregates over the `transactions`
// table — and the local mirror has every transaction the user has
// ever created, including the one they just added 50ms ago. Computing
// these locally means the Dashboard tile and Reports charts update
// instantly without waiting for a server round-trip.

const MONTH_LABELS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export async function getMonthlyStats(
  userId: string,
  year: number,
  month: number,
): Promise<MonthlyStats> {
  const localStats = await tryLocalRead(async db => {
    const result = await db.execute(
      `select
         coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as income,
         coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as expense
       from transactions
       where user_id = ?
         and deleted_at is null
         and substr(date, 1, 7) = ?`,
      [userId, formatYearMonth(year, month)],
    );
    const row = result.rows?._array?.[0] ?? {};
    const incomeAmount = asNumber(row['income']);
    const expenseAmount = asNumber(row['expense']);
    return {
      income:  incomeAmount,
      expense: expenseAmount,
      balance: incomeAmount - expenseAmount,
    };
  });

  if (localStats && (await hasCompletedInitialSync())) {
    return localStats;
  }

  return apiFetch<MonthlyStats>('/api/stats/monthly', {query: {year, month}});
}

export async function getMonthlySeries(
  userId: string,
  months = 6,
): Promise<MonthSeries[]> {
  const requestedCount = Math.max(1, Math.min(months, 24));

  const localSeries = await tryLocalRead(async db => {
    const series: MonthSeries[] = [];
    const now = new Date();
    // Build the bucket list (oldest → newest) before querying so we
    // emit a row for every month even if the user had no activity.
    for (let monthsAgo = requestedCount - 1; monthsAgo >= 0; monthsAgo--) {
      const bucketDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
      const bucketYear = bucketDate.getFullYear();
      const bucketMonth = bucketDate.getMonth() + 1;
      const result = await db.execute(
        `select
           coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as income,
           coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as expense
         from transactions
         where user_id = ?
           and deleted_at is null
           and substr(date, 1, 7) = ?`,
        [userId, formatYearMonth(bucketYear, bucketMonth)],
      );
      const row = result.rows?._array?.[0] ?? {};
      series.push({
        label:   MONTH_LABELS_SHORT[bucketMonth - 1],
        income:  asNumber(row['income']),
        expense: asNumber(row['expense']),
      });
    }
    return series;
  });

  if (localSeries && (await hasCompletedInitialSync())) {
    return localSeries;
  }

  // Server returns {year, month, income, expense}; convert to the
  // mobile shape so the chart component doesn't need to special-case.
  const serverRows = await apiFetch<Array<{year: number; month: number; income: number; expense: number}>>(
    '/api/stats/series',
    {query: {months: requestedCount}},
  );
  return serverRows.map(row => ({
    label:   MONTH_LABELS_SHORT[(row.month - 1) % 12],
    income:  asNumber(row.income),
    expense: asNumber(row.expense),
  }));
}

export async function getCategoryBreakdown(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<CategoryBreakdown[]> {
  const localRows = await tryLocalRead(async db => {
    const result = await db.execute(
      `select c.name, c.color, c.icon, sum(t.amount) as total
         from transactions t
         join categories c on c.id = t.category_id and c.deleted_at is null
        where t.user_id = ?
          and t.deleted_at is null
          and t.type = 'expense'
          and t.date between ? and ?
        group by c.id, c.name, c.color, c.icon
        order by total desc`,
      [userId, startDate, endDate],
    );
    const rawRows = result.rows?._array ?? [];
    return rawRows.map(row => ({
      name:  String(row['name'] ?? ''),
      color: String(row['color'] ?? '#6366F1'),
      icon:  String(row['icon'] ?? 'pricetag-outline'),
      total: asNumber(row['total']),
    }));
  });

  if (localRows && (await hasCompletedInitialSync())) {
    return localRows;
  }

  return apiFetch<CategoryBreakdown[]>('/api/stats/breakdown', {
    query: {start: startDate, end: endDate},
  });
}

// ─── Notification Settings ─────────────────────────────────────────────────

export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings | null> {
  const localRow = await tryLocalRead(async db => {
    const result = await db.execute(
      `select * from notification_settings where user_id = ? limit 1`,
      [userId],
    );
    const row = result.rows?._array?.[0];
    return row ? rowToNotificationSettings(row) : null;
  });
  if (localRow) return localRow;
  if (await hasCompletedInitialSync()) return null;

  const serverRow = await apiFetch<NotificationSettings | null>('/api/notification-settings');
  if (serverRow) await persistNotificationSettingsLocally(serverRow);
  return serverRow;
}

export async function upsertNotificationSettings(
  settings: Omit<NotificationSettings, 'id' | 'created_at'>,
): Promise<void> {
  // Notification settings is a singleton row per user — generate (or
  // reuse) a stable id so the local upsert path matches the server.
  const targetId = await tryLocalRead(async db => {
    const result = await db.execute(
      `select id from notification_settings where user_id = ? limit 1`,
      [settings.user_id],
    );
    const existingId = result.rows?._array?.[0]?.['id'];
    return typeof existingId === 'string' ? existingId : null;
  });
  const effectiveId = targetId ?? generateRowIdentifier();
  const createdAt = FALLBACK_NOW();

  await tryLocalWrite(async db => {
    await db.execute(
      `insert into notification_settings (
         id, user_id, enabled, frequency, custom_interval_days,
         notification_time, day_of_week, day_of_month,
         spending_alerts_enabled, spending_alert_threshold,
         budget_alerts_enabled, savings_alerts_enabled, investment_alerts_enabled,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(user_id) do update set
         enabled                   = excluded.enabled,
         frequency                 = excluded.frequency,
         custom_interval_days      = excluded.custom_interval_days,
         notification_time         = excluded.notification_time,
         day_of_week               = excluded.day_of_week,
         day_of_month              = excluded.day_of_month,
         spending_alerts_enabled   = excluded.spending_alerts_enabled,
         spending_alert_threshold  = excluded.spending_alert_threshold,
         budget_alerts_enabled     = excluded.budget_alerts_enabled,
         savings_alerts_enabled    = excluded.savings_alerts_enabled,
         investment_alerts_enabled = excluded.investment_alerts_enabled,
         updated_at                = excluded.updated_at`,
      [
        effectiveId, settings.user_id, settings.enabled ? 1 : 0,
        settings.frequency, settings.custom_interval_days ?? null,
        settings.notification_time, settings.day_of_week ?? null,
        settings.day_of_month ?? null,
        settings.spending_alerts_enabled   ? 1 : 0,
        settings.spending_alert_threshold  ?? 50000,
        settings.budget_alerts_enabled     ? 1 : 0,
        settings.savings_alerts_enabled    ? 1 : 0,
        settings.investment_alerts_enabled ? 1 : 0,
        createdAt, createdAt,
      ],
    );
  });

  await apiFetch('/api/notification-settings', {
    method: 'POST',
    body: settings,
    idempotencyKey: `notif-${settings.user_id}`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Alert configs DAO
// ═════════════════════════════════════════════════════════════════════════════

function rowToAlertConfig(row: Record<string, unknown>): AlertConfig {
  return {
    id:                String(row.id ?? ''),
    user_id:           String(row.user_id ?? ''),
    alert_type:        String(row.alert_type ?? '') as NotificationAlertType,
    enabled:           asBoolean(row.enabled),
    notification_time: String(row.notification_time ?? '08:00'),
    day_of_week:       row.day_of_week != null ? Number(row.day_of_week) : undefined,
    day_of_month:      row.day_of_month != null ? Number(row.day_of_month) : undefined,
    threshold_value:   row.threshold_value != null ? Number(row.threshold_value) : undefined,
    created_at:        String(row.created_at ?? ''),
  };
}

/**
 * Returns all alert configs for `userId` from the local SQLite mirror.
 * Returns an empty array when the native module is not linked or the
 * table has no rows yet.
 */
export async function getAlertConfigs(userId: string): Promise<AlertConfig[]> {
  const localRows = await tryLocalRead(async db => {
    const queryResult = await db.execute(
      `select * from notification_alert_configs where user_id = ? order by alert_type`,
      [userId],
    );
    return queryResult.rows?._array ?? [];
  });

  if (!localRows || localRows.length === 0) return [];
  return localRows.map(row => rowToAlertConfig(row));
}

/**
 * Writes a single alert config row to the local SQLite mirror.
 * Uses INSERT OR REPLACE so it handles both new and existing rows.
 */
async function persistAlertConfigLocally(
  config: Omit<AlertConfig, 'id' | 'created_at'>,
): Promise<void> {
  const nowIso   = new Date().toISOString();
  const stableId = `alert-${config.user_id}-${config.alert_type}`;

  await tryLocalWrite(async db => {
    await db.execute(
      `insert into notification_alert_configs (
         id, user_id, alert_type, enabled, notification_time,
         day_of_week, day_of_month, threshold_value,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(user_id, alert_type) do update set
         enabled            = excluded.enabled,
         notification_time  = excluded.notification_time,
         day_of_week        = excluded.day_of_week,
         day_of_month       = excluded.day_of_month,
         threshold_value    = excluded.threshold_value,
         updated_at         = excluded.updated_at`,
      [
        stableId,
        config.user_id,
        config.alert_type,
        config.enabled ? 1 : 0,
        config.notification_time,
        config.day_of_week    ?? null,
        config.day_of_month   ?? null,
        config.threshold_value ?? null,
        nowIso,
        nowIso,
      ],
    );
  });
}

/**
 * Saves an alert config to the local SQLite mirror first (immediate),
 * then syncs to the server in the background. Offline writes are
 * tolerated — the local row is always committed.
 *
 * Throws only when the server returns a hard validation error (4xx non-auth).
 */
export async function upsertAlertConfig(
  config: Omit<AlertConfig, 'id' | 'created_at'>,
): Promise<void> {
  await persistAlertConfigLocally(config);

  try {
    await apiFetch('/api/alert-configs/upsert', {
      method: 'POST',
      body: {
        alert_type:        config.alert_type,
        enabled:           config.enabled,
        notification_time: config.notification_time,
        day_of_week:       config.day_of_week    ?? null,
        day_of_month:      config.day_of_month   ?? null,
        threshold_value:   config.threshold_value ?? null,
      },
      idempotencyKey: `alert-${config.user_id}-${config.alert_type}`,
    });
  } catch (networkError) {
    if (networkError instanceof ApiError && isHardValidationError(networkError)) {
      throw networkError;
    }
    // Offline or transient error — local write succeeded; ignore silently.
  }
}
