import { useEffect, useState } from 'react';
import {
  createExerciseType,
  createMachine,
  listExerciseTypes,
  listMachines,
} from '../db/client';
import type { ExerciseType, Machine } from '../db/types';

interface Props {
  gymId: string;
  prefill?: { qrPayload?: string; machineNumber?: string };
  onOpenMachine: (machineId: string) => void;
}

export default function Registry({ gymId, prefill, onOpenMachine }: Props) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [types, setTypes] = useState<ExerciseType[]>([]);
  const [kind, setKind] = useState<'physical' | 'pseudo'>('physical');
  const [number, setNumber] = useState(prefill?.machineNumber ?? '');
  const [qr, setQr] = useState(prefill?.qrPayload ?? '');
  const [label, setLabel] = useState('');
  const [typeId, setTypeId] = useState('');
  const [newType, setNewType] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [m, t] = await Promise.all([listMachines(gymId), listExerciseTypes()]);
    setMachines(m);
    setTypes(t);
  };

  useEffect(() => {
    refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Failed to load machines'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // Update prefill when arriving from a scan/lookup miss.
  useEffect(() => {
    if (prefill?.machineNumber) setNumber(prefill.machineNumber);
    if (prefill?.qrPayload) setQr(prefill.qrPayload);
  }, [prefill]);

  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name ?? '—';

  const submit = async () => {
    setError(null);
    let defaultExerciseTypeId = typeId;
    const trimmedNewType = newType.trim();
    if (trimmedNewType) {
      const created = await createExerciseType(trimmedNewType);
      defaultExerciseTypeId = created.id;
    }
    if (kind === 'physical' && !number.trim() && !qr.trim() && !label.trim()) {
      setError('Give the machine a number, QR payload, or label.');
      return;
    }
    if (kind === 'pseudo' && !label.trim()) {
      setError('Give the station a label, e.g. "Free weights".');
      return;
    }
    setSaving(true);
    try {
      const m = await createMachine({
        gym_id: gymId,
        kind,
        machine_number: kind === 'physical' ? number.trim() || null : null,
        qr_payload: kind === 'physical' ? qr.trim() || null : null,
        default_exercise_type_id: defaultExerciseTypeId || null,
        label: label.trim() || null,
      });
      setNumber('');
      setQr('');
      setLabel('');
      setNewType('');
      setTypeId('');
      await refresh();
      onOpenMachine(m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register machine');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <h1>Machines</h1>
      <p className="muted">Everything registered at this gym.</p>

      <section className="card">
        <ul className="setlist">
          {machines.map((m) => (
            <li key={m.id}>
              <button className="linklike" onClick={() => onOpenMachine(m.id)}>
                {m.label ?? `Machine ${m.machine_number ?? '?'}`}
              </button>
              <span className="muted">
                {m.kind === 'pseudo' ? 'station · ' : ''}
                {m.machine_number ? `#${m.machine_number} · ` : ''}
                {typeName(m.default_exercise_type_id)}
              </span>
            </li>
          ))}
          {machines.length === 0 && <p className="muted">No machines yet.</p>}
        </ul>
      </section>

      <section className="card">
        <h2>Register a machine</h2>
        {prefill && (
          <p className="muted">
            This machine isn&apos;t registered yet — add it below to start logging.
          </p>
        )}
        <label className="field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'physical' | 'pseudo')}>
            <option value="physical">Physical machine</option>
            <option value="pseudo">Station (free weights, cables…)</option>
          </select>
        </label>
        {kind === 'physical' && (
          <>
            <label className="field">
              <span>Machine number</span>
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="e.g. 12"
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>QR payload (optional)</span>
              <input
                value={qr}
                onChange={(e) => setQr(e.target.value)}
                placeholder="scanned code"
              />
            </label>
          </>
        )}
        <label className="field">
          <span>Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Lat Pulldown A"
          />
        </label>
        <label className="field">
          <span>Exercise type</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">— pick or create below —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Or new exercise type</span>
          <input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="e.g. Seated Row"
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Registering…' : 'Register machine'}
        </button>
      </section>
    </div>
  );
}
