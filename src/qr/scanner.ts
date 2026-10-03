/**
 * QR scanning: prefer the native BarcodeDetector API, fall back to
 * @zxing/browser when the browser doesn't support it.
 */

// Minimal typing — BarcodeDetector isn't in TS's default DOM lib yet.
interface NativeBarcode {
  rawValue: string;
}
interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<NativeBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => NativeBarcodeDetector;
  }
}

export interface ScanHandle {
  stop: () => void;
}

/**
 * Decode a QR code from an uploaded image file (camera fallback for testing
 * or when the camera can't be used). Tries the native BarcodeDetector on a
 * canvas first, then the ZXing image decoder. Throws a human-readable error
 * when no QR code is found.
 */
export async function decodeQrFromImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read that image file.');
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);

    if (window.BarcodeDetector) {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(canvas);
        if (codes.length > 0 && codes[0].rawValue) return codes[0].rawValue;
      } catch {
        // Fall through to ZXing.
      }
    }

    // ZXing fallback: decode from an <img> element.
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not read that image file.'));
        el.src = url;
      });
      const result = await new BrowserQRCodeReader()
        .decodeFromImageElement(img)
        .catch(() => null);
      const text = result?.getText();
      if (text) return text;
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    bitmap.close();
  }
  throw new Error('No QR code found in that image — try a clearer shot.');
}

function stopTracks(video: HTMLVideoElement) {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/**
 * Scan for a QR code using `video` as the viewfinder and call `onResult`
 * with the first decoded payload. Returns a handle to stop scanning.
 * The caller renders the <video> with muted + playsInline for iOS.
 */
export async function startQrScan(
  video: HTMLVideoElement,
  onResult: (payload: string) => void,
  onError?: (err: unknown) => void,
): Promise<ScanHandle> {
  let stopped = false;
  let raf = 0;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stopTracks(video);
  };

  if (window.BarcodeDetector) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch (e) {
      onError?.(e);
      throw e;
    }
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return { stop };
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0 && codes[0].rawValue) {
          onResult(codes[0].rawValue);
          return;
        }
      } catch {
        // transient detection errors are fine; keep scanning
      }
      if (!stopped) raf = requestAnimationFrame(() => void tick());
    };
    void tick();
  } else {
    // Fallback: ZXing manages its own camera stream via the video element.
    // Dynamic import keeps it out of the main bundle.
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    if (stopped) return { stop };
    const reader = new BrowserQRCodeReader();
    try {
      const result = await reader.decodeOnceFromVideoDevice(undefined, video);
      if (!stopped) onResult(result.getText());
    } catch (e) {
      if (!stopped) onError?.(e);
    } finally {
      stopTracks(video);
    }
  }

  return { stop };
}
