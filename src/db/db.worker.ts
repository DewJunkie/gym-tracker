/**
 * DB worker: owns the entire SQLite stack.
 *
 * Why a worker? wa-sqlite's OriginPrivateFileSystemVFS uses synchronous
 * OPFS access handles, which are only available inside a Web Worker
 * (see wa-sqlite's own test/OPFSWorker.js + the upstream demo-worker.js:
 * the whole SQLite instance lives in the worker and the main thread talks
 * to it over message passing).
 *
 * The database is a real file ("gym-tracker.db") in the origin private
 * file system, so exporting a portable .db is just reading that file.
 *
 * Schema is versioned (schema_version table). v1 is the original scaffold
 * schema; v2 adds machine kinds/pseudo-machines, per-set variations, and
 * classified machine photos. Migrations are idempotent so an existing v1
 * database upgrades in place without losing data.
 */

import * as SQLite from 'wa-sqlite';
import SQLiteFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
import wasmUrl from 'wa-sqlite/dist/wa-sqlite-async.wasm?url';
import { DB_FILE_NAME } from './constants';

type SQLiteAPI = ReturnType<typeof SQLite.Factory>;
type Param = string | number | null | Uint8Array;
type Row = Record<string, string | number | Uint8Array | null>;

export interface DbRequest {
  id: number;
  kind: 'query' | 'run';
  sql: string;
  params: Param[];
}

export interface DbResponse {
  id: number;
  ok: boolean;
  rows?: Row[];
  changes?: number;
  error?: string;
}

const LATEST_SCHEMA_VERSION = 2;

/** v1: the original scaffold schema. */
const SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS gyms (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     coarse_lat REAL,
     coarse_lng REAL,
     notes TEXT,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS exercise_types (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS machines (
     id TEXT PRIMARY KEY,
     gym_id TEXT NOT NULL REFERENCES gyms(id),
     qr_payload TEXT,
     machine_number TEXT,
     exercise_type_id TEXT REFERENCES exercise_types(id),
     label TEXT,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_machines_gym ON machines(gym_id)`,
  `CREATE TABLE IF NOT EXISTS sets (
     id TEXT PRIMARY KEY,
     machine_id TEXT NOT NULL REFERENCES machines(id),
     exercise_type_id TEXT NOT NULL REFERENCES exercise_types(id),
     performed_at TEXT NOT NULL,
     reps INTEGER NOT NULL,
     weight_raw REAL NOT NULL,
     rpe REAL,
     notes TEXT,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sets_machine ON sets(machine_id, performed_at)`,
  `CREATE TABLE IF NOT EXISTS machine_ratios (
     exercise_type_id TEXT NOT NULL REFERENCES exercise_types(id),
     from_machine_id TEXT NOT NULL REFERENCES machines(id),
     to_machine_id TEXT NOT NULL REFERENCES machines(id),
     ratio REAL NOT NULL,
     sample_count INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (exercise_type_id, from_machine_id, to_machine_id)
   )`,
];

/** v2: brand-new tables (idempotent). */
const SCHEMA_V2_TABLES = [
  `CREATE TABLE IF NOT EXISTS variations (
     id TEXT PRIMARY KEY,
     exercise_type_id TEXT NOT NULL REFERENCES exercise_types(id),
     name TEXT NOT NULL,
     attributes_json TEXT,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS machine_images (
     id TEXT PRIMARY KEY,
     machine_id TEXT NOT NULL REFERENCES machines(id),
     kind TEXT NOT NULL,
     image_blob BLOB NOT NULL,
     mime_type TEXT NOT NULL,
     captured_at TEXT NOT NULL,
     notes TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_images_machine ON machine_images(machine_id)`,
];

let sqlite3: SQLiteAPI;
let db: number;

function bindParams(stmt: number, params: Param[]): void {
  params.forEach((p, i) => {
    const idx = i + 1;
    if (p === null) {
      sqlite3.bind_null(stmt, idx);
    } else if (p instanceof Uint8Array) {
      sqlite3.bind_blob(stmt, idx, p);
    } else if (typeof p === 'number') {
      if (Number.isInteger(p)) sqlite3.bind_int(stmt, idx, p);
      else sqlite3.bind_double(stmt, idx, p);
    } else {
      sqlite3.bind_text(stmt, idx, p);
    }
  });
}

async function query(sql: string, params: Param[]): Promise<Row[]> {
  const rows: Row[] = [];
  // sqlite3.statements() finalizes automatically; do NOT call finalize here.
  for await (const stmt of sqlite3.statements(db, sql)) {
    bindParams(stmt, params);
    const nCols = sqlite3.column_count(stmt);
    const names: string[] = [];
    for (let i = 0; i < nCols; i++) names.push(sqlite3.column_name(stmt, i));
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      const row: Row = {};
      for (let i = 0; i < nCols; i++) {
        const t = sqlite3.column_type(stmt, i);
        row[names[i]] =
          t === SQLite.SQLITE_NULL
            ? null
            : t === SQLite.SQLITE_INTEGER
              ? sqlite3.column_int(stmt, i)
              : t === SQLite.SQLITE_FLOAT
                ? sqlite3.column_double(stmt, i)
                : t === SQLite.SQLITE_BLOB
                  ? sqlite3.column_blob(stmt, i)
                  : sqlite3.column_text(stmt, i);
      }
      rows.push(row);
    }
  }
  return rows;
}

async function run(sql: string, params: Param[]): Promise<number> {
  for await (const stmt of sqlite3.statements(db, sql)) {
    bindParams(stmt, params);
    await sqlite3.step(stmt);
  }
  return sqlite3.changes(db);
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await query(`SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?`, [
    table,
    column,
  ]);
  return ((rows[0]?.c as number) ?? 0) > 0;
}

async function getSchemaVersion(): Promise<number> {
  const tables = await query(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`,
    [],
  );
  if (((tables[0]?.c as number) ?? 0) === 0) return 0;
  const rows = await query('SELECT MAX(version) AS v FROM schema_version', []);
  return (rows[0]?.v as number) ?? 0;
}

/** Idempotent: every gym gets its pseudo-machines ("Free weights", "Cable station"). */
async function ensurePseudoMachines(): Promise<void> {
  const now = new Date().toISOString();
  const gyms = await query('SELECT id FROM gyms', []);
  for (const g of gyms) {
    const gymId = g.id as string;
    for (const label of ['Free weights', 'Cable station']) {
      const existing = await query(
        `SELECT id FROM machines WHERE gym_id = ? AND kind = 'pseudo' AND label = ?`,
        [gymId, label],
      );
      if (existing.length === 0) {
        await run(
          `INSERT INTO machines (id, gym_id, kind, qr_payload, machine_number, default_exercise_type_id, label, updated_at)
           VALUES (?, ?, 'pseudo', NULL, NULL, NULL, ?, ?)`,
          [crypto.randomUUID(), gymId, label, now],
        );
      }
    }
  }
}

/** Idempotent: seed example lat-pulldown variations once the type exists. */
async function ensureLatPulldownVariations(): Promise<void> {
  const now = new Date().toISOString();
  const types = await query(`SELECT id FROM exercise_types WHERE name = 'Lat Pulldown'`, []);
  if (types.length === 0) return;
  const typeId = types[0].id as string;
  const existing = await query('SELECT COUNT(*) AS c FROM variations WHERE exercise_type_id = ?', [
    typeId,
  ]);
  if (((existing[0]?.c as number) ?? 0) > 0) return;
  const seeds: Array<[string, Record<string, string>]> = [
    ['Wide-grip pronated', { grip_width: 'wide', grip_orientation: 'pronated' }],
    ['Close-grip supinated', { grip_width: 'close', grip_orientation: 'supinated' }],
    ['Neutral medium-grip', { grip_width: 'medium', grip_orientation: 'neutral' }],
  ];
  for (const [name, attrs] of seeds) {
    await run(
      'INSERT INTO variations (id, exercise_type_id, name, attributes_json, updated_at) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), typeId, name, JSON.stringify(attrs), now],
    );
  }
}

async function migrate(): Promise<void> {
  await sqlite3.exec(db, 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const version = await getSchemaVersion();

  if (version < 1) {
    for (const stmt of SCHEMA_V1) {
      await sqlite3.exec(db, stmt);
    }
    await run('INSERT INTO schema_version (version) VALUES (1)', []);
  }

  if (version < LATEST_SCHEMA_VERSION) {
    // machines.kind — 'physical' for everything that predates the column.
    if (!(await hasColumn('machines', 'kind'))) {
      await sqlite3.exec(
        db,
        `ALTER TABLE machines ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical'`,
      );
    }
    // machines.exercise_type_id -> default_exercise_type_id (keeps existing data).
    if (await hasColumn('machines', 'exercise_type_id')) {
      await sqlite3.exec(
        db,
        'ALTER TABLE machines RENAME COLUMN exercise_type_id TO default_exercise_type_id',
      );
    } else if (!(await hasColumn('machines', 'default_exercise_type_id'))) {
      await sqlite3.exec(
        db,
        'ALTER TABLE machines ADD COLUMN default_exercise_type_id TEXT REFERENCES exercise_types(id)',
      );
    }
    for (const stmt of SCHEMA_V2_TABLES) {
      await sqlite3.exec(db, stmt);
    }
    if (!(await hasColumn('sets', 'variation_id'))) {
      await sqlite3.exec(
        db,
        'ALTER TABLE sets ADD COLUMN variation_id TEXT REFERENCES variations(id)',
      );
    }
    // Backfill v2 seed data for databases created by the v1 scaffold.
    await ensurePseudoMachines();
    await ensureLatPulldownVariations();
    await run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [
      LATEST_SCHEMA_VERSION,
    ]);
  }
}

async function seedIfEmpty(): Promise<void> {
  const rows = await query('SELECT COUNT(*) AS c FROM gyms', []);
  if ((rows[0]?.c as number) > 0) return;

  const now = new Date().toISOString();
  const gymId = crypto.randomUUID();
  const latId = crypto.randomUUID();
  const chestId = crypto.randomUUID();
  const mLatA = crypto.randomUUID();
  const mLatB = crypto.randomUUID();
  const mChest = crypto.randomUUID();

  await run(
    'INSERT INTO gyms (id, name, coarse_lat, coarse_lng, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [gymId, 'My Gym', null, null, 'Seeded gym — rename me in a later pass', now],
  );
  await run('INSERT INTO exercise_types (id, name, updated_at) VALUES (?, ?, ?)', [
    latId,
    'Lat Pulldown',
    now,
  ]);
  await run('INSERT INTO exercise_types (id, name, updated_at) VALUES (?, ?, ?)', [
    chestId,
    'Chest Press',
    now,
  ]);

  const insertMachine =
    `INSERT INTO machines (id, gym_id, kind, qr_payload, machine_number, default_exercise_type_id, label, updated_at)
     VALUES (?, ?, 'physical', ?, ?, ?, ?, ?)`;
  await run(insertMachine, [mLatA, gymId, 'MOCK-QR-LAT-12', '12', latId, 'Lat Pulldown A', now]);
  await run(insertMachine, [mLatB, gymId, 'MOCK-QR-LAT-27', '27', latId, 'Lat Pulldown B', now]);
  await run(insertMachine, [mChest, gymId, 'MOCK-QR-CHEST-5', '5', chestId, 'Chest Press', now]);

  await ensurePseudoMachines();
  await ensureLatPulldownVariations();

  // A little history so the machine + history views aren't empty on first run.
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const insertSet =
    'INSERT INTO sets (id, machine_id, exercise_type_id, variation_id, performed_at, reps, weight_raw, rpe, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  await run(insertSet, [crypto.randomUUID(), mLatA, latId, null, yesterday, 10, 150, 7, null, now]);
  await run(insertSet, [crypto.randomUUID(), mLatA, latId, null, yesterday, 10, 150, 8, null, now]);
  await run(insertSet, [crypto.randomUUID(), mLatA, latId, null, yesterday, 8, 160, 9, null, now]);
  await run(insertSet, [crypto.randomUUID(), mChest, chestId, null, yesterday, 12, 90, 7, null, now]);
  await run(insertSet, [crypto.randomUUID(), mChest, chestId, null, yesterday, 10, 100, 8, null, now]);
}

async function main(): Promise<void> {
  // Explicit locateFile: Vite bundles the ESM glue into the worker chunk,
  // so the default relative WASM lookup would fail.
  const module = await SQLiteFactory({
    locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
  });
  sqlite3 = SQLite.Factory(module);

  // OPFS-backed VFS, registered as the default filesystem. The example VFS
  // class is untyped JS; cast to the declared VFS parameter type.
  const vfs = new OriginPrivateFileSystemVFS();
  sqlite3.vfs_register(vfs as unknown as Parameters<SQLiteAPI['vfs_register']>[0], true);

  db = await sqlite3.open_v2(DB_FILE_NAME);

  await migrate();
  await seedIfEmpty();

  addEventListener('message', async (event: MessageEvent<DbRequest>) => {
    const { id, kind, sql, params } = event.data;
    const respond = (r: Omit<DbResponse, 'id'>) => postMessage({ id, ...r });
    try {
      if (kind === 'query') {
        respond({ ok: true, rows: await query(sql, params) });
      } else {
        respond({ ok: true, changes: await run(sql, params) });
      }
    } catch (e) {
      respond({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  postMessage({ type: 'ready' });
}

main().catch((e: unknown) => {
  postMessage({ type: 'init-error', error: e instanceof Error ? e.message : String(e) });
});
