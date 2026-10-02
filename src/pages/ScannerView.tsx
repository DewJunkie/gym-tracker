import { useEffect, useRef, useState } from 'react';
import { startQrScan, type ScanHandle } from '../qr/scanner';

interface Props {
  onScan: (payload: string) => void;
  onCancel: () => void;
}

export default function ScannerView({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<ScanHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUsingFallback(!('BarcodeDetector' in window));
    if (videoRef.current) {
      startQrScan(
        videoRef.current,
        (payload) => {
          if (!cancelled) {
            handleRef.current?.stop();
            onScan(payload);
          }
        },
        (err) => {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : 'Camera unavailable. Check permissions.',
            );
          }
        },
      )
        .then((h) => {
          handleRef.current = h;
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setError(
              e instanceof Error ? e.message : 'Camera unavailable. Check permissions.',
            );
          }
        });
    }
    return () => {
      cancelled = true;
      handleRef.current?.stop();
    };
    // onScan is stable enough for the scan session; re-scan by remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <h1>Scan QR code</h1>
      <p className="muted">
        {usingFallback ? 'Using fallback scanner…' : 'Point the camera at the machine\u2019s QR code.'}
      </p>
      {error ? (
        <div className="card error">{error}</div>
      ) : (
        <video ref={videoRef} className="scanner-video" muted playsInline />
      )}
      <button
        className="secondary"
        onClick={() => {
          handleRef.current?.stop();
          onCancel();
        }}
      >
        Cancel
      </button>
    </div>
  );
}
