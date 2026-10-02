import { useEffect, useRef, useState } from 'react';
import { listMachines } from '../db/client';
import type { Gym, Machine } from '../db/types';

interface Props {
  gyms: Gym[];
  gymId: string | null;
  onSelectGym: (id: string) => void;
  onAddGym: (name: string) => Promise<void>;
  onRenameGym: (id: string, name: string) => Promise<void>;
  onScan: () => void;
  onOcr: () => void;
  onMachineNumber: (num: string) => void;
  pseudoMachines: Machine[];
  onOpenMachine: (machineId: string) => void;
}

function machineLabel(m: Machine): string {
  const num = m.machine_number ? `#${m.machine_number}` : null;
  const name = m.label ?? (m.kind === 'pseudo' ? 'Station' : 'Unlabeled');
  return [num, name].filter(Boolean).join(' — ');
}

/** Searchable combobox: type a number or name, pick a machine, or fall back
 *  to exact-number lookup (which routes unknown numbers to registration). */
function MachineCombobox({
  machines,
  onPick,
  onFallback,
}: {
  machines: Machine[];
  onPick: (machineId: string) => void;
  onFallback: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = text.trim().toLowerCase();
  const matches = q
    ? machines
        .filter(
          (m) =>
            (m.machine_number ?? '').toLowerCase().includes(q) ||
            (m.label ?? '').toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (m: Machine) => {
    setOpen(false);
    setText('');
    setHighlight(0);
    onPick(m.id);
  };

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (open && matches[highlight]) {
      choose(matches[highlight]);
      return;
    }
    const exact = machines.find(
      (m) => (m.machine_number ?? '').toLowerCase() === trimmed.toLowerCase(),
    );
    if (exact) {
      choose(exact);
      return;
    }
    setOpen(false);
    setHighlight(0);
    onFallback(trimmed);
  };

  return (
    <div className="row" style={{ marginTop: 12 }}>
      <div ref={boxRef} className="combo" style={{ position: 'relative', flex: 1 }}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && matches.length > 0) {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
            } else if (e.key === 'ArrowUp' && matches.length > 0) {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
            } else if (e.key === 'Enter') {
              commit();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Machine number or name"
          inputMode="search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="machine-combo-list"
          aria-activedescendant={
            matches[highlight] ? `machine-opt-${matches[highlight].id}` : undefined
          }
          aria-label="Find a machine by number or name"
        />
        {open && matches.length > 0 && (
          <ul id="machine-combo-list" role="listbox" className="combo-list">
            {matches.map((m, i) => (
              <li
                key={m.id}
                id={`machine-opt-${m.id}`}
                role="option"
                aria-selected={i === highlight}
                className={i === highlight ? 'highlight' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
              >
                {machineLabel(m)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={commit} disabled={!text.trim()} aria-label="Go to machine">
        Go
      </button>
    </div>
  );
}

export default function Home({
  gyms,
  gymId,
  onSelectGym,
  onAddGym,
  onRenameGym,
  onScan,
  onOcr,
  onMachineNumber,
  pseudoMachines,
  onOpenMachine,
}: Props) {
  const [newGym, setNewGym] = useState('');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gymId) {
      setMachines([]);
      return;
    }
    listMachines(gymId)
      .then(setMachines)
      .catch(() => setMachines([]));
  }, [gymId]);

  const currentGym = gyms.find((g) => g.id === gymId);

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

  const saveRename = async () => {
    if (!gymId || !renameText.trim()) return;
    try {
      await onRenameGym(gymId, renameText.trim());
      setRenaming(false);
      setRenameText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename gym');
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
        {currentGym && (
          <div style={{ marginTop: 8 }}>
            {renaming ? (
              <div className="row">
                <input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  aria-label="Gym name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveRename();
                  }}
                />
                <button onClick={() => void saveRename()}>Save</button>
                <button
                  className="link"
                  onClick={() => {
                    setRenaming(false);
                    setRenameText('');
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="link"
                onClick={() => {
                  setRenameText(currentGym.name);
                  setRenaming(true);
                }}
              >
                Rename this gym
              </button>
            )}
          </div>
        )}
        {error && <div className="error">{error}</div>}
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
        <MachineCombobox
          machines={machines}
          onPick={onOpenMachine}
          onFallback={onMachineNumber}
        />
        <p className="muted" style={{ marginBottom: 0 }}>
          Type a number or name — unknown numbers go to registration.
        </p>
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
