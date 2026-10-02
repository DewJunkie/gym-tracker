/**
 * Build-time asset fetcher for offline OCR.
 *
 * Copies the Tesseract.js worker script + the LSTM core variants (wasm.js
 * glue + .wasm binary) into public/tesseract/, and downloads the English
 * traineddata (tessdata_fast, small + fast) into public/tessdata/.
 *
 * Everything under public/ is copied verbatim to dist/ and precached by the
 * service worker (see vite.config.ts), so OCR works fully offline on gym
 * wifi. Only the LSTM core variants are needed because the app creates its
 * worker with OEM.LSTM_ONLY — tesseract.js's own getCore() only ever picks
 * among the *-lstm files in that mode.
 *
 * Idempotent: skips files that already exist.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const tessDir = join(pub, 'tesseract');
const dataDir = join(pub, 'tessdata');

mkdirSync(tessDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

function ensureCopy(src, dest) {
  if (existsSync(dest)) {
    console.log(`[ocr-assets] skip (exists): ${dest}`);
    return;
  }
  copyFileSync(join(root, src), dest);
  console.log(`[ocr-assets] copied: ${dest}`);
}

// Worker script (self-contained bundle).
ensureCopy('node_modules/tesseract.js/dist/worker.min.js', join(tessDir, 'worker.min.js'));

// LSTM core variants: glue + wasm must sit side-by-side — the Emscripten glue
// resolves its .wasm relative to its own script URL.
for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  const base = `tesseract-core-${variant}`;
  ensureCopy(`node_modules/tesseract.js-core/${base}.wasm.js`, join(tessDir, `${base}.wasm.js`));
  ensureCopy(`node_modules/tesseract.js-core/${base}.wasm`, join(tessDir, `${base}.wasm`));
}

// English traineddata (tessdata_fast = integer "fast" models, ~4MB).
const trained = join(dataDir, 'eng.traineddata');
if (existsSync(trained)) {
  console.log(`[ocr-assets] skip (exists): ${trained}`);
} else {
  const url = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/eng.traineddata';
  console.log(`[ocr-assets] downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(
      `[ocr-assets] WARNING: download failed (HTTP ${res.status}). ` +
        'OCR will not work until eng.traineddata is present; re-run the build online.',
    );
  } else {
    writeFileSync(trained, Buffer.from(await res.arrayBuffer()));
    console.log(`[ocr-assets] downloaded: ${trained}`);
  }
}
