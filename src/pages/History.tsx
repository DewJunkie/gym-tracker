import { useEffect, useState } from 'react';
import {
  getExerciseHistory,
  getMachineHistory,
  listExerciseTypes,
  listMachines,
} from '../db/client';
import type { EnrichedSet, ExerciseType, Machine, SetEntry } from '../db/types';

interface Props {
  gymId: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SetRow({ s, showMachine }: { s: SetEntry | EnrichedSet; showMachine?: boolean }) {
  const machine =
    showMachine && 'machine_label' in s
      ? ` · ${s.machine_label ?? ''}${s.machine_number ? ` #${s.machine_number}` : ''}`
      : '';
  const variation =
    'variation_name' in s && s.variation_name ? ` · ${s.variation_name}` : '';
  return (
    <li>
      <span>
        {formatDateTime(s.performed_at)} — {s.reps} reps × {s.weight_raw} lbs{machine}
        {variation}
      </span>
      <span className="muted">{s.rpe != null ? `RPE ${s.rpe}` : ''}</span>
    </li>
  );
}

export default function History({ gymId }: Props) {
  const [tab, setTab] = useState<'machine' | 'exercise'>('machine');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [types, setTypes] = useState<ExerciseType[]>([]);
  const [machineId, setMachineId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [machineSets, setMachineSets] = useState<EnrichedSet[]>([]);
  const [typeSets, setTypeSets] = useState<EnrichedSet[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listMachines(gymId), listExerciseTypes()])
      .then(([m, t]) => {
        setMachines(m);
        setTypes(t);
        if (m.length > 0) setMachineId((prev) => prev || m[0].id);
        if (t.length > 0) setTypeId((prev) => prev || t[0].id);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [gymId]);

  useEffect(() => {
    if (tab === 'machine' && machineId) {
      getMachineHistory(machineId)
        .then(setMachineSets)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
    }
  }, [tab, machineId]);

  useEffect(() => {
    if (tab === 'exercise' && typeId) {
      getExerciseHistory(typeId)
        .then(setTypeSets)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
    }
  }, [tab, typeId]);

  return (
    <div className="page">
      <h1>History</h1>
      <div className="tabs">
        <button className={tab === 'machine' ? 'active' : ''} onClick={() => setTab('machine')}>
          By machine
        </button>
        <button className={tab === 'exercise' ? 'active' : ''} onClick={() => setTab('exercise')}>
          By exercise
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {tab === 'machine' ? (
        <section className="card">
          <label className="field">
            <span>Machine</span>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? `Machine ${m.machine_number ?? '?'}`}
                </option>
              ))}
            </select>
          </label>
          <ul className="setlist">
            {machineSets.map((s) => (
              <SetRow key={s.id} s={s} />
            ))}
            {machineSets.length === 0 && <p className="muted">No sets yet.</p>}
          </ul>
        </section>
      ) : (
        <section className="card">
          <label className="field">
            <span>Exercise</span>
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Weights shown raw per machine — normalized view arrives with ratio learning.
          </p>
          <ul className="setlist">
            {typeSets.map((s) => (
              <SetRow key={s.id} s={s} showMachine />
            ))}
            {typeSets.length === 0 && <p className="muted">No sets yet.</p>}
          </ul>
        </section>
      )}
    </div>
  );
}
