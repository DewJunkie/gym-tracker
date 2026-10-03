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
  whitelist + single-word segmentation), or use the searchable machine box on
  the home screen (filters the gym's machines by number or name; exact number
  + Go keeps the old jump/registration behavior). Machines are scoped per gym;
  unknown machines get a quick-registration flow with the scanned/OCR'd
  identifier pre-filled.
- **Pseudo-machines**: "Free weights" / "Cable station" are selectable from
  the home screen — no scanning. Every set logs against a machine, physical
  or pseudo.
- **Set logging**: reps, raw stack weight, RPE per set. Machine and exercise
  are independent per logging session: after opening a machine you pick the
  exercise (defaults to the machine's default, else the last exercise logged
  there), then an optional per-set **variation** (pick existing or create with
  grip-width/orientation attributes). The last-session view and weight
  pre-fill follow the selected exercise; with none selected they span the
  machine's most recent session across exercises. Variations show in history
  and CSV.
- **Classified machine photos**: attach QR/number-plate, name-plate,
  manufacturer, muscle-diagram, or overview photos per machine. Captured via
  camera (`capture="environment"`, file-picker fallback), downscaled to JPEG
  ≤1600px before storing as BLOBs, so the single-file DB export keeps working.
  Muscle diagrams double as future training data for muscle-group extraction.
- **Editing**: machines (label, number, kind, default exercise, gym), exercise
  types (rename), and gyms (rename) can be edited from the Machines tab and
  home screen.
- **History feed**: chronological workout feed grouped by calendar day (newest
  first) with date, gym, and per-exercise set groups (reps × weight, RPE,
  variation, machine); searchable by exercise, machine, or variation.
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
- The OPFS worker path is runtime-verified in headless Chromium (boot, 8-way
  concurrent read/write burst, export); the OCR engine path is build-verified
  but not yet runtime-tested on a real device — first phone run should confirm
  a successful plate read.

## Deploy to GitHub Pages

The app is fully static, so GitHub Pages hosts it for free:

1. Create an empty repo on GitHub (any name, e.g. `gym-tracker`).
2. Push the contents of this directory as the repo root:
   ```
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
3. In the repo: Settings → Pages → Source: **GitHub Actions**.
4. The included workflow (`.github/workflows/deploy.yml`) builds on every
   push to `main` and publishes `dist/`. It sets `PAGES_BASE` from the repo
   name automatically, so asset URLs, the service worker, and the offline
   OCR assets all resolve under `https://<you>.github.io/<repo>/` with no
   manual config. (Exception: a `<you>.github.io` user-site repo is served
   from `/` — clear the `PAGES_BASE` env line in that case.)
5. Open the Pages URL on your phone and "Add to Home Screen" to install the
   PWA. First launch downloads ~26MB of precached OCR assets; afterwards the
   plate scanner works fully offline.
