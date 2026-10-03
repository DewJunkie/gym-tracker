import { useEffect, useRef, useState } from 'react';
import { recognizeDigits, terminateOcr } from '../ocr/plate';

interface Props {
  onResult: (digits: string) => void;
  onCancel: () => void;
}

/** Downscaled canvas snapshot; number plates don't need full resolution. */
function snapshotToCanvas(
  srcW: number,
  srcH: number,
  draw: (w: number, h: number, ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const scale = Math.min(1, 1280 / Math.max(srcW, srcH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) draw(canvas.width, canvas.height, ctx);
  return canvas;
}

export default function OcrView({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'working'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [digits, setDigits] = useState('');
  const [recognized, setRecognized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => undefined);
          if (!cancelled) setStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Camera unavailable. Check permissions.');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      // Free the (heavy) OCR engine when leaving the flow.
      void terminateOcr();
    };
  }, []);

  const recognizeCanvas = async (canvas: HTMLCanvasElement) => {
    setStatus('working');
    setError(null);
    setRecognized(false);
    try {
      const text = await recognizeDigits(canvas);
      setDigits(text);
      setRecognized(true);
      if (!text) setError('No digits recognized — try a closer, steadier shot.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed');
    } finally {
      setStatus('ready');
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // Snapshot the frame, downscaled — number plates don't need full resolution.
    const canvas = snapshotToCanvas(video.videoWidth, video.videoHeight, (w, h, ctx) =>
      ctx.drawImage(video, 0, 0, w, h),
    );
    await recognizeCanvas(canvas);
  };

  const onUploadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const el = new Image();
        el.onload = () => {
          URL.revokeObjectURL(url);
          resolve(el);
        };
        el.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Could not read that image file.'));
        };
        el.src = url;
      });
      const canvas = snapshotToCanvas(img.naturalWidth, img.naturalHeight, (w, h, ctx) =>
        ctx.drawImage(img, 0, 0, w, h),
      );
      await recognizeCanvas(canvas);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image file.');
    } finally {
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const submit = () => {
    const cleaned = digits.replace(/\D/g, '');
    if (cleaned) onResult(cleaned);
  };

  return (
    <div className="page">
      <h1>Scan number plate</h1>
      <p className="muted">Point the camera at the machine&apos;s number plate, then capture.</p>
      {error ? (
        <div className="card error">{error}</div>
      ) : (
        <video ref={videoRef} className="scanner-video" muted playsInline />
      )}
      {status === 'starting' && !error && <p className="muted">Starting camera…</p>}

      {!recognized ? (
        <>
          <div className="row">
            <button
              className="primary big"
              onClick={() => void capture()}
              disabled={status !== 'ready'}
            >
              {status === 'working' ? 'Reading plate…' : 'Capture & read'}
            </button>
            <button
              className="secondary"
              onClick={() => uploadRef.current?.click()}
              disabled={status === 'working'}
              style={{ alignSelf: 'flex-end' }}
            >
              Upload image
            </button>
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => void onUploadFile(e.target.files?.[0])}
          />
          <p className="muted">Camera is the default; upload reads a plate from an image file.</p>
        </>
      ) : (
        <section className="card">
          <label className="field">
            <span>Machine number</span>
            <input
              value={digits}
              onChange={(e) => setDigits(e.target.value)}
              inputMode="numeric"
              aria-label="Recognized machine number"
            />
          </label>
          <p className="muted">Check the digits — correct them if the read was off.</p>
          <div className="row">
            <button
              className="secondary"
              onClick={() => {
                setRecognized(false);
                setDigits('');
              }}
            >
              Retake
            </button>
            <button className="primary" onClick={submit} disabled={!digits.replace(/\D/g, '')}>
              Find machine
            </button>
          </div>
        </section>
      )}

      <button className="secondary" onClick={onCancel} style={{ marginTop: 12 }}>
        Cancel
      </button>
    </div>
  );
}
