/**
 * Main-thread database client.
 *
 * All SQLite work happens in db.worker.ts (OPFS access handles are
 * worker-only). This module wraps the worker in a promise-based RPC layer
 * and exposes a small typed data-access API used by the UI.
 */
import type {
  EnrichedSet,
  ExerciseType,
  Gym,
  Machine,
  MachineImage,
  MachineImageKind,
  SetEntry,
  Variation,
} from './types';
import { DB_FILE_NAME } from './constants';

type SqlParam = string | number | Uint8Array | null;
type Row = Record<string, string | number | Uint8Array | null>;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingCall>();
let readyPromise: Promise<void> | null = null;

function ensureWorker(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve, reject) => {
      // Safety net: if the worker never reports back (hung WASM load,
      // stuck OPFS open, …), fail visibly instead of spinning forever.
      const timer = window.setTimeout(() => {
        worker?.terminate();
        worker = null;
        readyPromise = null;
        reject(
          new Error(
            'Database worker timed out after 30s. Open DevTools (F12) → Console ' +
              'for the underlying error, then reload the page.',
          ),
        );
      }, 30_000);
      const done = (fn: () => void) => {
        window.clearTimeout(timer);
        fn();
      };
      worker = new Worker(new URL('./db.worker.ts', import.meta.url), {
        type: 'module',
      });
      const onMessage = (event: MessageEvent) => {
        // Discriminated by presence of `type`: lifecycle messages carry it,
        // RPC responses carry `id`.
        const data = event.data as
          | { type: 'ready' }
          | { type: 'init-error'; error: string }
          | { id: number; ok: boolean; rows?: Row[]; changes?: number; error?: string };
        if ('type' in data) {
          if (data.type === 'ready') {
            worker?.removeEventListener('message', onMessage);
            done(() => resolve());
          } else {
            done(() => reject(new Error(`DB worker init failed: ${data.error}`)));
          }
          return;
        }
        const call = pending.get(data.id);
        if (!call) return;
        pending.delete(data.id);
        if (data.ok) call.resolve(data);
        else call.reject(new Error(data.error ?? 'DB worker error'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (e) => {
        done(() =>
          reject(e.error instanceof Error ? e.error : new Error('DB worker crashed')),
        );
      });
    });
    // A rejected init (timeout, crash, …) shouldn't poison later calls:
    // the next dbReady() starts a fresh worker.
    readyPromise.catch(() => {
      readyPromise = null;
    });
  }
  return readyPromise;
}

async function rpc<T extends { id: number }>(
  kind: 'query' | 'run',
  sql: string,
  params: SqlParam[] = [],
): Promise<T> {
  await ensureWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    worker?.postMessage({ id, kind, sql, params });
  });
}

type QueryResponse = { id: number; ok: boolean; rows: Row[] };
type RunResponse = { id: number; ok: boolean; changes: number };

async function query(sql: string, params: SqlParam[] = []): Promise<Row[]> {
  const res = await rpc<QueryResponse>('query', sql, params);
  return res.rows;
}

async function run(sql: string, params: SqlParam[] = []): Promise<number> {
  const res = await rpc<RunResponse>('run', sql, params);
  return res.changes;
}

export function dbReady(): Promise<void> {
  return ensureWorker();
}

// --- row mappers -----------------------------------------------------------

function toGym(r: Row): Gym {
  return {
    id: r.id as string,
    name: r.name as string,
    coarse_lat: r.coarse_lat as number | null,
    coarse_lng: r.coarse_lng as number | null,
    notes: r.notes as string | null,
    updated_at: r.updated_at as string,
  };
}

function toExerciseType(r: Row): ExerciseType {
  return { id: r.id as string, name: r.name as string, updated_at: r.updated_at as string };
}

function toVariation(r: Row): Variation {
  let attributes: Record<string, string> = {};
  const raw = r.attributes_json as string | null;
  if (raw) {
    try {
      attributes = JSON.parse(raw) as Record<string, string>;
    } catch {
      attributes = {};
    }
  }
  return {
    id: r.id as string,
    exercise_type_id: r.exercise_type_id as string,
    name: r.name as string,
    attributes,
    updated_at: r.updated_at as string,
  };
}

function toMachine(r: Row): Machine {
  return {
    id: r.id as string,
    gym_id: r.gym_id as string,
    kind: (r.kind as string) === 'pseudo' ? 'pseudo' : 'physical',
    qr_payload: r.qr_payload as string | null,
    machine_number: r.machine_number as string | null,
    default_exercise_type_id: r.default_exercise_type_id as string | null,
    label: r.label as string | null,
    updated_at: r.updated_at as string,
  };
}

function toSet(r: Row): SetEntry {
  return {
    id: r.id as string,
    machine_id: r.machine_id as string,
    exercise_type_id: r.exercise_type_id as string,
    variation_id: r.variation_id as string | null,
    performed_at: r.performed_at as string,
    reps: r.reps as number,
    weight_raw: r.weight_raw as number,
    rpe: r.rpe as number | null,
    notes: r.notes as string | null,
    updated_at: r.updated_at as string,
  };
}

function toMachineImage(r: Row): MachineImage {
  return {
    id: r.id as string,
    machine_id: r.machine_id as string,
    kind: r.kind as MachineImageKind,
    image_blob: r.image_blob as Uint8Array,
    mime_type: r.mime_type as string,
    captured_at: r.captured_at as string,
    notes: r.notes as string | null,
  };
}

function toEnrichedSet(r: Row): EnrichedSet {
  return {
    ...toSet(r),
    machine_label: r.machine_label as string | null,
    machine_number: r.machine_number as string | null,
    exercise_name: r.exercise_name as string | null,
    variation_name: r.variation_name as string | null,
    gym_name: r.gym_name as string | null,
  };
}

// --- gyms ------------------------------------------------------------------

export async function listGyms(): Promise<Gym[]> {
  return (await query('SELECT * FROM gyms ORDER BY name')).map(toGym);
}

export async function createGym(name: string): Promise<Gym> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    'INSERT INTO gyms (id, name, coarse_lat, coarse_lng, notes, updated_at) VALUES (?, ?, NULL, NULL, NULL, ?)',
    [id, name, now],
  );
  return { id, name, coarse_lat: null, coarse_lng: null, notes: null, updated_at: now };
}

// --- exercise types ----------------------------------------------------------

export async function listExerciseTypes(): Promise<ExerciseType[]> {
  return (await query('SELECT * FROM exercise_types ORDER BY name')).map(toExerciseType);
}

export async function createExerciseType(name: string): Promise<ExerciseType> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run('INSERT INTO exercise_types (id, name, updated_at) VALUES (?, ?, ?)', [id, name, now]);
  return { id, name, updated_at: now };
}

// --- variations --------------------------------------------------------------

export async function listVariations(exerciseTypeId: string): Promise<Variation[]> {
  return (
    await query('SELECT * FROM variations WHERE exercise_type_id = ? ORDER BY name', [
      exerciseTypeId,
    ])
  ).map(toVariation);
}

export interface NewVariation {
  exercise_type_id: string;
  name: string;
  attributes?: Record<string, string>;
}

export async function createVariation(input: NewVariation): Promise<Variation> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const attrs = input.attributes ?? {};
  // Drop empty attribute values so the JSON stays clean.
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v.trim()) clean[k] = v.trim();
  }
  await run(
    'INSERT INTO variations (id, exercise_type_id, name, attributes_json, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, input.exercise_type_id, input.name.trim(), JSON.stringify(clean), now],
  );
  return { id, exercise_type_id: input.exercise_type_id, name: input.name.trim(), attributes: clean, updated_at: now };
}

// --- machines ----------------------------------------------------------------

export async function listMachines(gymId: string): Promise<Machine[]> {
  return (
    await query('SELECT * FROM machines WHERE gym_id = ? ORDER BY machine_number, label', [gymId])
  ).map(toMachine);
}

/** Pseudo-machines ("Free weights", "Cable station") for the no-scan flow. */
export async function listPseudoMachines(gymId: string): Promise<Machine[]> {
  return (
    await query(`SELECT * FROM machines WHERE gym_id = ? AND kind = 'pseudo' ORDER BY label`, [
      gymId,
    ])
  ).map(toMachine);
}

export async function getMachine(id: string): Promise<Machine | null> {
  const rows = await query('SELECT * FROM machines WHERE id = ?', [id]);
  return rows.length ? toMachine(rows[0]) : null;
}

export async function findMachineByQr(gymId: string, qrPayload: string): Promise<Machine | null> {
  const rows = await query('SELECT * FROM machines WHERE gym_id = ? AND qr_payload = ?', [
    gymId,
    qrPayload,
  ]);
  return rows.length ? toMachine(rows[0]) : null;
}

export async function findMachineByNumber(
  gymId: string,
  machineNumber: string,
): Promise<Machine | null> {
  const rows = await query('SELECT * FROM machines WHERE gym_id = ? AND machine_number = ?', [
    gymId,
    machineNumber.trim(),
  ]);
  return rows.length ? toMachine(rows[0]) : null;
}

export interface NewMachine {
  gym_id: string;
  kind?: 'physical' | 'pseudo';
  qr_payload?: string | null;
  machine_number?: string | null;
  default_exercise_type_id?: string | null;
  label?: string | null;
}

export async function createMachine(input: NewMachine): Promise<Machine> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO machines (id, gym_id, kind, qr_payload, machine_number, default_exercise_type_id, label, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.gym_id,
      input.kind ?? 'physical',
      input.qr_payload ?? null,
      input.machine_number?.trim() || null,
      input.default_exercise_type_id ?? null,
      input.label?.trim() || null,
      now,
    ],
  );
  const created = await getMachine(id);
  if (!created) throw new Error('Failed to read back created machine');
  return created;
}

// --- machine images ------------------------------------------------------------

export async function listMachineImages(machineId: string): Promise<MachineImage[]> {
  return (
    await query('SELECT * FROM machine_images WHERE machine_id = ? ORDER BY captured_at', [
      machineId,
    ])
  ).map(toMachineImage);
}

export interface NewMachineImage {
  machine_id: string;
  kind: MachineImageKind;
  image_blob: Uint8Array;
  mime_type: string;
  notes?: string | null;
}

export async function addMachineImage(input: NewMachineImage): Promise<MachineImage> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO machine_images (id, machine_id, kind, image_blob, mime_type, captured_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.machine_id,
      input.kind,
      input.image_blob,
      input.mime_type,
      now,
      input.notes?.trim() || null,
    ],
  );
  return {
    id,
    machine_id: input.machine_id,
    kind: input.kind,
    image_blob: input.image_blob,
    mime_type: input.mime_type,
    captured_at: now,
    notes: input.notes?.trim() || null,
  };
}

export async function deleteMachineImage(id: string): Promise<void> {
  await run('DELETE FROM machine_images WHERE id = ?', [id]);
}

// --- sets --------------------------------------------------------------------

export interface NewSet {
  machine_id: string;
  exercise_type_id: string;
  variation_id?: string | null;
  reps: number;
  weight_raw: number;
  rpe?: number | null;
  notes?: string | null;
}

export async function logSet(input: NewSet): Promise<SetEntry> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO sets (id, machine_id, exercise_type_id, variation_id, performed_at, reps, weight_raw, rpe, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.machine_id,
      input.exercise_type_id,
      input.variation_id ?? null,
      now,
      input.reps,
      input.weight_raw,
      input.rpe ?? null,
      input.notes?.trim() || null,
      now,
    ],
  );
  return {
    id,
    machine_id: input.machine_id,
    exercise_type_id: input.exercise_type_id,
    variation_id: input.variation_id ?? null,
    performed_at: now,
    reps: input.reps,
    weight_raw: input.weight_raw,
    rpe: input.rpe ?? null,
    notes: input.notes?.trim() || null,
    updated_at: now,
  };
}

/** Sets from the most recent calendar day with activity on this machine. */
export async function getLastSessionSets(machineId: string): Promise<EnrichedSet[]> {
  const rows = await query(
    `SELECT s.*, v.name AS variation_name
     FROM sets s
     LEFT JOIN variations v ON v.id = s.variation_id
     WHERE s.machine_id = ?
       AND date(s.performed_at) = (SELECT date(MAX(performed_at)) FROM sets WHERE machine_id = ?)
     ORDER BY s.performed_at`,
    [machineId, machineId],
  );
  return rows.map((r) => ({
    ...toSet(r),
    machine_label: null,
    machine_number: null,
    exercise_name: null,
    variation_name: r.variation_name as string | null,
    gym_name: null,
  }));
}

export async function getMachineHistory(machineId: string): Promise<EnrichedSet[]> {
  const rows = await query(
    `SELECT s.*, v.name AS variation_name
     FROM sets s
     LEFT JOIN variations v ON v.id = s.variation_id
     WHERE s.machine_id = ? ORDER BY s.performed_at DESC`,
    [machineId],
  );
  return rows.map((r) => ({
    ...toSet(r),
    machine_label: null,
    machine_number: null,
    exercise_name: null,
    variation_name: r.variation_name as string | null,
    gym_name: null,
  }));
}

const ENRICHED_SELECT = `s.*, m.label AS machine_label, m.machine_number, et.name AS exercise_name,
       v.name AS variation_name, g.name AS gym_name
       FROM sets s
       JOIN machines m ON m.id = s.machine_id
       JOIN exercise_types et ON et.id = s.exercise_type_id
       LEFT JOIN variations v ON v.id = s.variation_id
       JOIN gyms g ON g.id = m.gym_id`;

export async function getExerciseHistory(exerciseTypeId: string): Promise<EnrichedSet[]> {
  return (
    await query(
      `SELECT ${ENRICHED_SELECT}
       WHERE s.exercise_type_id = ?
       ORDER BY s.performed_at DESC`,
      [exerciseTypeId],
    )
  ).map(toEnrichedSet);
}

export async function getAllSetsEnriched(): Promise<EnrichedSet[]> {
  return (await query(`SELECT ${ENRICHED_SELECT} ORDER BY s.performed_at DESC`, [])).map(
    toEnrichedSet,
  );
}

// --- export ------------------------------------------------------------------

/**
 * Download the live SQLite database file straight out of OPFS.
 * Safe to call at UI-idle: every worker op is awaited, and committed
 * transactions are flushed to the file by the VFS (rollback-journal mode),
 * so the file is self-consistent when nothing is in flight.
 */
export async function exportDatabaseFile(): Promise<Blob> {
  await dbReady();
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DB_FILE_NAME);
  return await handle.getFile();
}

export async function exportSetsCsv(): Promise<string> {
  const sets = await getAllSetsEnriched();
  const header = [
    'performed_at',
    'gym',
    'exercise',
    'variation',
    'machine_number',
    'machine_label',
    'reps',
    'weight_raw',
    'rpe',
    'notes',
  ];
  const esc = (v: string | number | null): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = sets.map((s) =>
    [
      s.performed_at,
      s.gym_name,
      s.exercise_name,
      s.variation_name,
      s.machine_number,
      s.machine_label,
      s.reps,
      s.weight_raw,
      s.rpe,
      s.notes,
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

// --- QR payload parsing --------------------------------------------------------
// STUB: real parser lands once Duane brings sample QR codes from the gym.
// For now: if the payload is a URL, take the last non-empty path segment;
// otherwise treat the whole payload as the machine identifier.

export function parseQrPayload(payload: string): string {
  const trimmed = payload.trim();
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    const machineParam =
      url.searchParams.get('machine') ??
      url.searchParams.get('machineId') ??
      url.searchParams.get('id');
    return machineParam ?? (segments.length ? segments[segments.length - 1] : trimmed);
  } catch {
    return trimmed;
  }
}
