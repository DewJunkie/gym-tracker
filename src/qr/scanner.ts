/**
 * QR scanning: prefer the native BarcodeDetector API, fall back to
 * @zxing/browser when the browser doesn't support it.
 */

// Minimal typing — BarcodeDetector isn't in TS's default DOM lib yet.
interface NativeBarcode {
  rawValue: string;
}
interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<NativeBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => NativeBarcodeDetector;
  }
}

export interface ScanHandle {
  stop: () => void;
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
