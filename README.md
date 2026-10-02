# Gym Tracker PWA

Local-first gym workout tracker. React + TypeScript + Vite. SQLite runs in the
browser via wa-sqlite (WebAssembly), persisted to the Origin Private File
System. No backend, no network calls at runtime.

## Run it

```bash
cd ~/workspace/goals/gym-tracker-pwa/app
npm install     # first time only
npm run dev     # local dev server (http://localhost:5173)
npm run build   # production build -> dist/ (also validates TypeScript)
```

To try the PWA (installable + offline), serve `dist/` over HTTPS or localhost,
e.g. `npx serve dist`.

`npm run dev` / `npm run build` first run `scripts/fetch-ocr-assets.mjs`
(`predev`/`prebuild`), which stages the Tesseract OCR assets into `public/`
(worker script, LSTM core wasm, English traineddata — downloaded once from
jsDelivr, then cached). Everything under `public/` is precached by the service
worker, so OCR works fully offline.

## How the database works

All SQLite work happens in `src/db/db.worker.ts`, a dedicated Web Worker:

- It loads the async wa-sqlite build, registers
  `OriginPrivateFileSystemVFS` (from wa-sqlite's own examples) as the default
  VFS, and opens `gym-tracker.db` as a real file in OPFS. The VFS must live in
  a worker because OPFS synchronous access handles are worker-only — this
  mirrors wa-sqlite's own demo architecture.
- The main thread (`src/db/client.ts`) talks to the worker over a tiny
  promise-based RPC (`query` / `run` with bound parameters, request IDs).
  `Uint8Array` params/columns are supported for image BLOBs (structured
  clone across the worker boundary).

Schema is versioned (`schema_version` table; migrations in `db.worker.ts` are
idempotent, so a v1 database upgrades in place):

- v1: `gyms`, `exercise_types`, `machines`, `sets`, `machine_ratios`.
- v2: `machines.kind` (`physical`|`pseudo`) + `exercise_type_id` renamed to
  `default_exercise_type_id`; new `variations` table
  (`id, exercise_type_id, name, attributes_json`); `sets.variation_id`
  nullable; new `machine_images` table
  (`id, machine_id, kind, image_blob BLOB, mime_type, captured_at, notes`).

All tables use UUID primary keys and `updated_at` timestamps (sync-friendly
for a future backend).

Seed data (first run): one gym ("My Gym"), Lat Pulldown + Chest Press types,
three mock machines (lat pulldown #12/#27, chest press #5 with `MOCK-QR-*`
payloads), pseudo-machines "Free weights" and "Cable station", three example
lat-pulldown variations (wide-grip pronated, close-grip supinated, neutral
medium-grip), and a few historical sets.

## Features

- **Machine identification**: scan QR (native BarcodeDetector, ZXing fallback),
  scan a number plate with on-device OCR (Tesseract.js, lazy-loaded, digits
  whitelist + single-word segmentation), or type the machine number. Machines
  are scoped per gym; unknown machines get a quick-registration flow with the
  scanned/OCR'd identifier pre-filled.
- **Pseudo-machines**: "Free weights" / "Cable station" are selectable from
  the home screen — no scanning. Every set logs against a machine, physical
  or pseudo.
- **Set logging**: reps, raw stack weight, RPE per set; last-session view per
  machine; optional per-set **variation** (pick existing or create with
  grip-width/orientation attributes). Variations show in history and CSV.
- **Classified machine photos**: attach QR/number-plate, name-plate,
  manufacturer, or muscle-diagram photos per machine. Captured via camera
  (`capture="environment"`, file-picker fallback), downscaled to JPEG ≤1600px
  before storing as BLOBs, so the single-file DB export keeps working. Muscle
  diagrams double as future training data for muscle-group extraction.
- **History**: by machine or by exercise type (raw weights; normalized view
  arrives with ratio learning).
- **Export**: portable `gym-tracker.db` download straight from OPFS, plus sets
  CSV (now includes a variation column).

## What's stubbed / next

- **Equivalent-weight hint**: placeholder line in the machine view. Ratio
  learning over `machine_ratios` comes next (later scoped per variation).
- **QR payload parser** (`parseQrPayload` in `src/db/client.ts`): minimal
  heuristic until real QR samples from the gym arrive.
- **Reference-machine selection UX** and **RPE scale** still open per
  requirements.
- Export reads the live `gym-tracker.db` from OPFS at UI-idle; committed
  transactions are flushed by the VFS so the file is self-consistent.
- The OCR engine path and the OPFS worker path are build-verified but have
  not been runtime-tested on a real device yet — first phone run should
  confirm DB init/persistence and a successful plate read.
