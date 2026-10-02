/**
 * Machine-number-plate OCR via Tesseract.js.
 *
 * Lazy by design: `tesseract.js` is dynamically imported only when this
 * module's functions are first called, so the (large) OCR code stays out of
 * the main bundle. The engine assets — worker script, LSTM core, and English
 * traineddata — live under public/tesseract/ and public/tessdata/ (see
 * scripts/fetch-ocr-assets.mjs) and are precached by the service worker, so
 * recognition works fully offline.
 *
 * Tuned for number plates: LSTM-only engine, single-word page segmentation,
 * digits whitelist.
 */
import type { Worker as TesseractWorker } from 'tesseract.js';

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Dynamic import keeps tesseract.js out of the main bundle.
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${base}/tesseract/worker.min.js`,
        langPath: `${base}/tessdata`,
        corePath: `${base}/tesseract`,
        gzip: false,
        logger: () => {
          /* progress is surfaced by the caller UI */
        },
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: PSM.SINGLE_WORD,
      });
      return worker;
    })();
    // Don't cache a rejected init — a later retry should start fresh.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Recognize a canvas snapshot of a number plate; returns digits only. */
export async function recognizeDigits(image: HTMLCanvasElement): Promise<string> {
  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(image);
  return text.replace(/\D/g, '');
}

/** Free the OCR worker (call when leaving the OCR flow). */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const pending = workerPromise;
    workerPromise = null;
    const worker = await pending.catch(() => null);
    await worker?.terminate().catch(() => undefined);
  }
}
