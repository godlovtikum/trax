// Local SQLite schema — mirrors the Postgres tables that participate in
// sync. Types are denormalised to SQLite's three storage classes:
//
//   • TEXT   — uuids, ISO-8601 timestamps, enums, plain strings, dates
//   • REAL   — money amounts (Postgres `numeric(15,2)` collapses to a
//              JS number on the wire — we accept the float precision
//              loss here in exchange for cheap arithmetic)
//   • INTEGER — booleans (0/1), interval/day-of-week ints
//
// `updated_at` and `deleted_at` mirror the server columns added by
// `4_sync.sql`. Tombstoned rows are kept locally so the sync engine can
// distinguish "deleted on server" from "never existed". They are filtered
// out by every read DAO.
//
// Migrations are append-only — bump LATEST_SCHEMA_VERSION and add a new
// step to MIGRATIONS whenever you change the schema.

export const LATEST_SCHEMA_VERSION = 4;

export interface MigrationStep {
  toVersion: number;
  /** SQL statements executed inside one transaction. */
  statements: readonly string[];
}

export const MIGRATIONS: readonly MigrationStep[] = [
  {
    toVersion: 1,
    statements: [
      // ── meta: version + sync cursor + arbitrary key/value scratch space ──
      `create table if not exists sync_meta (
         key   text primary key,
         value text not null
       )`,

      // ── profiles ─────────────────────────────────────────────────────────
      `create table if not exists profiles (
         id                 text primary key,
         email              text,
         full_name          text,
         primary_currency   text not null default 'XAF',
         secondary_currency text not null default 'USD',
         created_at         text,
         updated_at         text not null
       )`,

      // ── categories ───────────────────────────────────────────────────────
      `create table if not exists categories (
         id          text primary key,
         user_id     text not null,
         name        text not null,
         type        text not null default 'both',
         color       text not null default '#6366F1',
         icon        text not null default 'pricetag-outline',
         is_default  integer not null default 0,
         created_at  text,
         updated_at  text not null,
         deleted_at  text
       )`,
      `create index if not exists categories_user_idx on categories(user_id)`,

      // ── accounts ─────────────────────────────────────────────────────────
      `create table if not exists accounts (
         id          text primary key,
         user_id     text not null,
         name        text not null,
         type        text not null default 'bank',
         currency    text not null default 'XAF',
         is_default  integer not null default 0,
         created_at  text,
         updated_at  text not null,
         deleted_at  text
       )`,
      `create index if not exists accounts_user_idx on accounts(user_id)`,

      // ── transactions ─────────────────────────────────────────────────────
      `create table if not exists transactions (
         id            text primary key,
         user_id       text not null,
         account_id    text,
         category_id   text,
         type          text not null,
         amount        real not null,
         currency      text not null default 'XAF',
         description   text,
         date          text not null,
         is_recurring  integer not null default 0,
         recurrence    text,
         receipt_url   text,
         created_at    text,
         updated_at    text not null,
         deleted_at    text
       )`,
      `create index if not exists transactions_user_date_idx on transactions(user_id, date desc)`,
      `create index if not exists transactions_category_idx  on transactions(category_id)`,

      // ── budgets ──────────────────────────────────────────────────────────
      `create table if not exists budgets (
         id           text primary key,
         user_id      text not null,
         category_id  text,
         amount       real not null,
         period       text not null default 'monthly',
         currency     text not null default 'XAF',
         created_at   text,
         updated_at   text not null,
         deleted_at   text
       )`,
      `create index if not exists budgets_user_idx on budgets(user_id)`,

      // ── savings_goals ────────────────────────────────────────────────────
      `create table if not exists savings_goals (
         id              text primary key,
         user_id         text not null,
         name            text not null,
         target_amount   real not null,
         current_amount  real not null default 0,
         currency        text not null default 'XAF',
         deadline        text,
         color           text not null default '#10B981',
         created_at      text,
         updated_at      text not null,
         deleted_at      text
       )`,
      `create index if not exists savings_goals_user_idx on savings_goals(user_id)`,

      // ── investments ──────────────────────────────────────────────────────
      `create table if not exists investments (
         id          text primary key,
         user_id     text not null,
         name        text not null,
         type        text not null default 'other',
         amount      real not null,
         currency    text not null default 'XAF',
         date        text not null,
         notes       text,
         created_at  text,
         updated_at  text not null,
         deleted_at  text
       )`,
      `create index if not exists investments_user_idx on investments(user_id, date desc)`,

      // ── notification_settings ────────────────────────────────────────────
      `create table if not exists notification_settings (
         id                    text primary key,
         user_id               text not null unique,
         enabled               integer not null default 0,
         frequency             text not null default 'daily',
         custom_interval_days  integer,
         notification_time     text not null default '20:00',
         day_of_week           integer,
         day_of_month          integer,
         spending_alerts_enabled   integer not null default 1,
         spending_alert_threshold  real not null default 50000,
         budget_alerts_enabled     integer not null default 1,
         savings_alerts_enabled    integer not null default 0,
         investment_alerts_enabled integer not null default 0,
         created_at            text,
         updated_at            text not null
       )`,
    ],
  },

  {
    toVersion: 2,
    // Add the alert-type columns to notification_settings for devices
    // that already have schema version 1 (first time upgrading).
    statements: [
      `alter table notification_settings
         add column if not exists spending_alerts_enabled   integer not null default 1`,
      `alter table notification_settings
         add column if not exists spending_alert_threshold  real not null default 50000`,
      `alter table notification_settings
         add column if not exists budget_alerts_enabled     integer not null default 1`,
      `alter table notification_settings
         add column if not exists savings_alerts_enabled    integer not null default 0`,
      `alter table notification_settings
         add column if not exists investment_alerts_enabled integer not null default 0`,
    ],
  },

  {
    toVersion: 3,
    // Per-type smart alert configurations (one row per user per alert_type).
    statements: [
      `create table if not exists notification_alert_configs (
         id                text primary key,
         user_id           text not null,
         alert_type        text not null,
         enabled           integer not null default 0,
         notification_time text not null default '08:00',
         day_of_week       integer,
         day_of_month      integer,
         threshold_value   real,
         created_at        text,
         updated_at        text not null,
         unique(user_id, alert_type)
       )`,
      `create index if not exists alert_configs_user_idx
         on notification_alert_configs(user_id)`,
    ],
  },

  {
    toVersion: 4,
    // Savings goal contribution history — mirrors savings_contributions on
    // the server so the history screen works offline.
    statements: [
      `create table if not exists savings_contributions (
         id              text primary key,
         goal_id         text not null,
         user_id         text not null,
         amount          real not null,
         note            text,
         contributed_at  text not null,
         created_at      text,
         updated_at      text not null,
         deleted_at      text
       )`,
      `create index if not exists contributions_goal_idx
         on savings_contributions(goal_id, user_id, contributed_at desc)`,
      `create index if not exists contributions_user_updated_idx
         on savings_contributions(user_id, updated_at desc)`,
    ],
  },
];

// Tables that participate in `sync_pull`. Order matches the JSONB
// payload's `tables` keys so the sync engine can iterate uniformly.
export const SYNCED_TABLES = [
  'profiles',
  'categories',
  'accounts',
  'transactions',
  'budgets',
  'savings_goals',
  'savings_contributions',
  'investments',
  'notification_settings',
] as const;

export type SyncedTableName = (typeof SYNCED_TABLES)[number];

// Key/value names used in `sync_meta`.
export const SYNC_META_KEYS = {
  schemaVersion: 'schema_version',
  /** ISO-8601 cursor returned by the most recent successful sync_pull. */
  syncCursor:    'sync_cursor',
  /** user_id the local DB was last seeded for — used to clear on logout. */
  ownerUserId:   'owner_user_id',
} as const;
