import { useEffect, useRef, useState } from 'react';
import { recognizeDigits, terminateOcr } from '../ocr/plate';

interface Props {
  onResult: (digits: string) => void;
  onCancel: () => void;
}

export default function OcrView({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
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

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setStatus('working');
    setError(null);
    setRecognized(false);
    try {
      // Snapshot the frame, downscaled — number plates don't need full resolution.
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
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
        <button
          className="primary big"
          onClick={() => void capture()}
          disabled={status !== 'ready'}
        >
          {status === 'working' ? 'Reading plate…' : 'Capture & read'}
        </button>
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
