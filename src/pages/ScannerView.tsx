import { useEffect, useRef, useState } from 'react';
import { decodeQrFromImage, startQrScan, type ScanHandle } from '../qr/scanner';

interface Props {
  onScan: (payload: string) => void;
  onCancel: () => void;
}

export default function ScannerView({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<ScanHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [decoding, setDecoding] = useState(false);

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
      <div className="row">
        <button
          className="secondary"
          onClick={() => {
            handleRef.current?.stop();
            onCancel();
          }}
        >
          Cancel
        </button>
        <button
          className="secondary"
          onClick={() => uploadRef.current?.click()}
          disabled={decoding}
        >
          {decoding ? 'Reading image…' : 'Upload image'}
        </button>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void onUploadFile(e.target.files?.[0])}
      />
      <p className="muted">Camera is the default; upload reads a QR code from an image file.</p>
    </div>
  );

  async function onUploadFile(file: File | undefined) {
    if (!file) return;
    setDecoding(true);
    setError(null);
    try {
      const payload = await decodeQrFromImage(file);
      handleRef.current?.stop();
      onScan(payload);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not read a QR code from that image.',
      );
    } finally {
      setDecoding(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }
}
