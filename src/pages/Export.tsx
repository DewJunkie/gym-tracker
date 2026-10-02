import { useState } from 'react';
import { exportDatabaseFile, exportSetsCsv } from '../db/client';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function Export() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const doExport = async (kind: 'db' | 'csv') => {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      if (kind === 'db') {
        const blob = await exportDatabaseFile();
        download(blob, 'gym-tracker.db');
        setDone('Database downloaded as gym-tracker.db — open it with any SQLite tool.');
      } else {
        const csv = await exportSetsCsv();
        download(new Blob([csv], { type: 'text/csv' }), 'gym-tracker-sets.csv');
        setDone('Sets downloaded as gym-tracker-sets.csv.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <h1>Export</h1>
      <p className="muted">
        Your data lives in a real SQLite file on this device. Take it with you any time.
      </p>
      {error && <div className="error">{error}</div>}
      {done && <div className="success">{done}</div>}
      <section className="card">
        <h2>Full database</h2>
        <p className="muted">Portable .db file — gyms, machines, sets, everything.</p>
        <button className="primary" onClick={() => void doExport('db')} disabled={busy !== null}>
          {busy === 'db' ? 'Exporting…' : 'Download gym-tracker.db'}
        </button>
      </section>
      <section className="card">
        <h2>Sets as CSV</h2>
        <p className="muted">One row per set, with gym / exercise / machine columns.</p>
        <button className="primary" onClick={() => void doExport('csv')} disabled={busy !== null}>
          {busy === 'csv' ? 'Exporting…' : 'Download sets CSV'}
        </button>
      </section>
    </div>
  );
}
