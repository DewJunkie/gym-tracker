import { useState } from 'react';
import type { Gym, Machine } from '../db/types';

interface Props {
  gyms: Gym[];
  gymId: string | null;
  onSelectGym: (id: string) => void;
  onAddGym: (name: string) => Promise<void>;
  onScan: () => void;
  onOcr: () => void;
  onMachineNumber: (num: string) => void;
  pseudoMachines: Machine[];
  onOpenMachine: (machineId: string) => void;
}

export default function Home({
  gyms,
  gymId,
  onSelectGym,
  onAddGym,
  onScan,
  onOcr,
  onMachineNumber,
  pseudoMachines,
  onOpenMachine,
}: Props) {
  const [number, setNumber] = useState('');
  const [newGym, setNewGym] = useState('');
  const [adding, setAdding] = useState(false);

  const submitNumber = () => {
    if (number.trim()) onMachineNumber(number.trim());
  };

  const submitGym = async () => {
    const name = newGym.trim();
    if (!name) return;
    setAdding(true);
    try {
      await onAddGym(name);
      setNewGym('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="page">
      <h1>Gym Tracker</h1>
      <p className="muted">Walk up to a machine, scan it, log your sets.</p>

      <section className="card">
        <label className="field">
          <span>Gym</span>
          <select value={gymId ?? ''} onChange={(e) => onSelectGym(e.target.value)}>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <input
            value={newGym}
            onChange={(e) => setNewGym(e.target.value)}
            placeholder="New gym name"
            aria-label="New gym name"
          />
          <button onClick={() => void submitGym()} disabled={adding || !newGym.trim()}>
            Add
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <button className="primary big" onClick={onScan} style={{ flex: 1 }}>
            Scan QR code
          </button>
          <button className="secondary big" onClick={onOcr} style={{ flex: 1 }}>
            Scan number plate
          </button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Machine number"
            inputMode="numeric"
            aria-label="Machine number"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNumber();
            }}
          />
          <button onClick={submitNumber} disabled={!number.trim()}>
            Go
          </button>
        </div>
      </section>

      {pseudoMachines.length > 0 && (
        <section className="card">
          <h2>Start without scanning</h2>
          <p className="muted">Free weights, cables — pick one, then choose your exercise.</p>
          <ul className="setlist">
            {pseudoMachines.map((m) => (
              <li key={m.id}>
                <button className="linklike" onClick={() => onOpenMachine(m.id)}>
                  {m.label ?? 'Unlabeled'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
