// Lazy SQLite connection. We open a single named database per app
// install and run pending migrations on first access. The native module
// (`@op-engineering/op-sqlite`) is loaded dynamically so a missing
// install fails *only* when sync is actually invoked — the rest of the
// app keeps working against the original AsyncStorage cache.

import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  SYNC_META_KEYS,
} from "./schema";

const DATABASE_NAME = "trax.local.v1.sqlite";

// Minimal subset of the op-sqlite surface we depend on. Declared
// locally so we don't import the package at module-eval time (which
// would throw on devices that haven't been rebuilt yet).
export interface LocalDatabase {
  execute(query: string, params?: readonly unknown[]): Promise<{
    rows?: { _array: Array<Record<string, unknown>> };
    rowsAffected?: number;
  }>;
  executeBatch(commands: ReadonlyArray<{ query: string; params?: readonly unknown[] }>): Promise<unknown>;
  close(): Promise<void>;
}

interface OpSqliteModule {
  open(options: { name: string; location?: string }): LocalDatabase;
}

let cachedDatabase: LocalDatabase | null = null;
let openPromise: Promise<LocalDatabase> | null = null;

function loadOpSqliteModule(): OpSqliteModule {
  // Dynamic require — keeps the app launchable on builds that haven't
  // been rebuilt with the native module linked yet.
  let mod: OpSqliteModule | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("@op-engineering/op-sqlite") as OpSqliteModule;
  } catch (loadError) {
    // Re-throw with a clear, actionable message.
    throw new Error(
      "[trax/db] @op-engineering/op-sqlite is not installed in this build. " +
      "Run `npm install` and rebuild the native app (cd android && ./gradlew clean assembleRelease).",
    );
  }
  if (!mod || typeof mod.open !== "function") {
    throw new Error("[trax/db] @op-engineering/op-sqlite has no `open` export");
  }
  return mod;
}

/** Returns the (opened, migrated) local database. Safe to call repeatedly. */
export async function getLocalDatabase(): Promise<LocalDatabase> {
  if (cachedDatabase) return cachedDatabase;
  if (openPromise) return openPromise;

  openPromise = (async (): Promise<LocalDatabase> => {
    const opSqlite = loadOpSqliteModule();
    const db = opSqlite.open({ name: DATABASE_NAME });

    await runMigrations(db);
    cachedDatabase = db;
    return db;
  })();

  try {
    return await openPromise;
  } finally {
    openPromise = null;
  }
}

async function runMigrations(db: LocalDatabase): Promise<void> {
  // Bootstrap sync_meta table first — every migration after T1 assumes
  // it exists, and we read the version from it below.
  await db.execute(
    `create table if not exists sync_meta (key text primary key, value text not null)`,
  );

  const versionRow = await db.execute(
    `select value from sync_meta where key = ?`,
    [SYNC_META_KEYS.schemaVersion],
  );
  const currentVersion = readVersion(versionRow);

  for (const step of MIGRATIONS) {
    if (step.toVersion <= currentVersion) continue;

    // Run each statement individually so we can swallow "duplicate column
    // name" errors from ALTER TABLE statements that are redundant on fresh
    // installs (schema step 1 already creates those columns, but step 2
    // tries to add them again for devices that upgraded from v1).
    for (const statement of step.statements) {
      try {
        await db.execute(statement);
      } catch (statementError) {
        const isAlterTable = statement.trim().toLowerCase().startsWith("alter table");
        const isDuplicateColumn =
          statementError instanceof Error &&
          statementError.message.toLowerCase().includes("duplicate column");
        if (isAlterTable && isDuplicateColumn) {
          // Column was already created in an earlier migration step — safe to skip.
          continue;
        }
        throw statementError;
      }
    }

    // Stamp the new version only after all statements succeed.
    await db.execute(
      `insert into sync_meta(key, value) values (?, ?)
         on conflict(key) do update set value = excluded.value`,
      [SYNC_META_KEYS.schemaVersion, String(step.toVersion)],
    );
  }

  // If the database was created fresh (no version row) but no migrations
  // ran (shouldn't happen in practice), still stamp the latest version
  // so future bumps behave predictably.
  if (currentVersion === 0 && MIGRATIONS.length === 0) {
    await db.execute(
      `insert into sync_meta(key, value) values (?, ?)
         on conflict(key) do update set value = excluded.value`,
      [SYNC_META_KEYS.schemaVersion, String(LATEST_SCHEMA_VERSION)],
    );
  }
}

function readVersion(result: {
  rows?: { _array: Array<Record<string, unknown>> };
}): number {
  const firstRow = result.rows?._array?.[0];
  if (!firstRow) return 0;
  const raw = firstRow["value"];
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

// ─── meta key/value helpers ────────────────────────────────────────────────

export async function readSyncMeta(key: string): Promise<string | null> {
  const db = await getLocalDatabase();
  const result = await db.execute(`select value from sync_meta where key = ?`, [key]);
  const firstRow = result.rows?._array?.[0];
  if (!firstRow) return null;
  const raw = firstRow["value"];
  return typeof raw === "string" ? raw : null;
}

export async function writeSyncMeta(key: string, value: string): Promise<void> {
  const db = await getLocalDatabase();
  await db.execute(
    `insert into sync_meta(key, value) values (?, ?)
       on conflict(key) do update set value = excluded.value`,
    [key, value],
  );
}

export async function deleteSyncMeta(key: string): Promise<void> {
  const db = await getLocalDatabase();
  await db.execute(`delete from sync_meta where key = ?`, [key]);
}

// ─── lifecycle ─────────────────────────────────────────────────────────────

/** Closes and forgets the cached connection (used on logout / reset). */
export async function closeLocalDatabase(): Promise<void> {
  if (!cachedDatabase) return;
  try {
    await cachedDatabase.close();
  } catch (closeError) {
    if (__DEV__) console.warn("[trax/db] close failed:", closeError);
  }
  cachedDatabase = null;
}

/** Drops every synced row + cursor — call after logout. Schema is kept. */
export async function clearLocalUserData(): Promise<void> {
  const db = await getLocalDatabase();
  await db.executeBatch([
    { query: `delete from profiles` },
    { query: `delete from categories` },
    { query: `delete from accounts` },
    { query: `delete from transactions` },
    { query: `delete from budgets` },
    { query: `delete from savings_goals` },
    { query: `delete from savings_contributions` },
    { query: `delete from investments` },
    { query: `delete from notification_settings` },
    { query: `delete from notification_alert_configs` },
    {
      query: `delete from sync_meta where key in (?, ?)`,
      params: [SYNC_META_KEYS.syncCursor, SYNC_META_KEYS.ownerUserId],
    },
  ]);
}
