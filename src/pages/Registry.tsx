import { useEffect, useState } from 'react';
import {
  createExerciseType,
  createMachine,
  listExerciseTypes,
  listGyms,
  listMachines,
  updateExerciseType,
  updateMachine,
} from '../db/client';
import type { ExerciseType, Gym, Machine } from '../db/types';

interface Props {
  gymId: string;
  prefill?: { qrPayload?: string; machineNumber?: string };
  onOpenMachine: (machineId: string) => void;
}

interface MachineForm {
  kind: 'physical' | 'pseudo';
  gymId: string;
  number: string;
  qr: string;
  label: string;
  typeId: string;
}

const blankForm = (gymId: string): MachineForm => ({
  kind: 'physical',
  gymId,
  number: '',
  qr: '',
  label: '',
  typeId: '',
});

function formFromMachine(m: Machine): MachineForm {
  return {
    kind: m.kind,
    gymId: m.gym_id,
    number: m.machine_number ?? '',
    qr: m.qr_payload ?? '',
    label: m.label ?? '',
    typeId: m.default_exercise_type_id ?? '',
  };
}

export default function Registry({ gymId, prefill, onOpenMachine }: Props) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [types, setTypes] = useState<ExerciseType[]>([]);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Register form.
  const [form, setForm] = useState<MachineForm>(() => ({
    ...blankForm(gymId),
    number: prefill?.machineNumber ?? '',
    qr: prefill?.qrPayload ?? '',
  }));
  const [newType, setNewType] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit form.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MachineForm>(() => blankForm(gymId));
  const [editNewType, setEditNewType] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Exercise-type rename.
  const [renamingTypeId, setRenamingTypeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const refresh = async () => {
    const [m, t, g] = await Promise.all([
      listMachines(gymId),
      listExerciseTypes(),
      listGyms(),
    ]);
    setMachines(m);
    setTypes(t);
    setGyms(g);
  };

  useEffect(() => {
    refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Failed to load machines'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // Update prefill when arriving from a scan/lookup miss.
  useEffect(() => {
    if (prefill?.machineNumber) setForm((f) => ({ ...f, number: prefill.machineNumber ?? '' }));
    if (prefill?.qrPayload) setForm((f) => ({ ...f, qr: prefill.qrPayload ?? '' }));
  }, [prefill]);

  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name ?? '—';
  const gymName = (id: string) => gyms.find((g) => g.id === id)?.name ?? '—';

  const resolveTypeId = async (
    typeId: string,
    newTypeName: string,
    addType: (t: ExerciseType) => void,
  ): Promise<string | null> => {
    const trimmed = newTypeName.trim();
    if (trimmed) {
      const created = await createExerciseType(trimmed);
      addType(created);
      return created.id;
    }
    return typeId || null;
  };

  const submit = async () => {
    setError(null);
    if (form.kind === 'physical' && !form.number.trim() && !form.qr.trim() && !form.label.trim()) {
      setError('Give the machine a number, QR payload, or label.');
      return;
    }
    if (form.kind === 'pseudo' && !form.label.trim()) {
      setError('Give the station a label, e.g. "Free weights".');
      return;
    }
    setSaving(true);
    try {
      const defaultExerciseTypeId = await resolveTypeId(form.typeId, newType, (t) =>
        setTypes((prev) => [...prev, t].sort((a, b) => a.name.localeCompare(b.name))),
      );
      const m = await createMachine({
        gym_id: form.gymId,
        kind: form.kind,
        machine_number: form.kind === 'physical' ? form.number.trim() || null : null,
        qr_payload: form.kind === 'physical' ? form.qr.trim() || null : null,
        default_exercise_type_id: defaultExerciseTypeId,
        label: form.label.trim() || null,
      });
      setForm({ ...blankForm(gymId) });
      setNewType('');
      await refresh();
      onOpenMachine(m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register machine');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (m: Machine) => {
    setEditingId(m.id);
    setEditForm(formFromMachine(m));
    setEditNewType('');
    setError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setError(null);
    if (editForm.kind === 'physical' && !editForm.number.trim() && !editForm.qr.trim() && !editForm.label.trim()) {
      setError('Give the machine a number, QR payload, or label.');
      return;
    }
    if (editForm.kind === 'pseudo' && !editForm.label.trim()) {
      setError('Give the station a label, e.g. "Free weights".');
      return;
    }
    setEditSaving(true);
    try {
      const defaultExerciseTypeId = await resolveTypeId(editForm.typeId, editNewType, (t) =>
        setTypes((prev) => [...prev, t].sort((a, b) => a.name.localeCompare(b.name))),
      );
      await updateMachine(editingId, {
        gym_id: editForm.gymId,
        kind: editForm.kind,
        machine_number: editForm.kind === 'physical' ? editForm.number.trim() || null : null,
        qr_payload: editForm.kind === 'physical' ? editForm.qr.trim() || null : null,
        default_exercise_type_id: defaultExerciseTypeId,
        label: editForm.label.trim() || null,
      });
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update machine');
    } finally {
      setEditSaving(false);
    }
  };

  const saveRename = async () => {
    if (!renamingTypeId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setError('Exercise name cannot be empty.');
      return;
    }
    try {
      const updated = await updateExerciseType(renamingTypeId, trimmed);
      setTypes((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t)).sort((a, b) => a.name.localeCompare(b.name)),
      );
      setRenamingTypeId(null);
      setRenameValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename exercise');
    }
  };

  const machineFormFields = (
    f: MachineForm,
    setF: (patch: Partial<MachineForm>) => void,
    newTypeValue: string,
    setNewTypeValue: (v: string) => void,
  ) => (
    <>
      <label className="field">
        <span>Kind</span>
        <select value={f.kind} onChange={(e) => setF({ kind: e.target.value as 'physical' | 'pseudo' })}>
          <option value="physical">Physical machine</option>
          <option value="pseudo">Station (free weights, cables…)</option>
        </select>
      </label>
      <label className="field">
        <span>Gym</span>
        <select value={f.gymId} onChange={(e) => setF({ gymId: e.target.value })}>
          {gyms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {f.kind === 'physical' && (
        <>
          <label className="field">
            <span>Machine number</span>
            <input
              value={f.number}
              onChange={(e) => setF({ number: e.target.value })}
              placeholder="e.g. 12"
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>QR payload (optional)</span>
            <input
              value={f.qr}
              onChange={(e) => setF({ qr: e.target.value })}
              placeholder="scanned code"
            />
          </label>
        </>
      )}
      <label className="field">
        <span>Label</span>
        <input
          value={f.label}
          onChange={(e) => setF({ label: e.target.value })}
          placeholder="e.g. Lat Pulldown A"
        />
      </label>
      <label className="field">
        <span>Exercise type</span>
        <select value={f.typeId} onChange={(e) => setF({ typeId: e.target.value })}>
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
          value={newTypeValue}
          onChange={(e) => setNewTypeValue(e.target.value)}
          placeholder="e.g. Seated Row"
        />
      </label>
    </>
  );

  return (
    <div className="page">
      <h1>Machines</h1>
      <p className="muted">Everything registered at this gym.</p>

      <section className="card">
        <ul className="setlist">
          {machines.map((m) => (
            <li key={m.id}>
              <div style={{ flex: 1 }}>
                <button className="linklike" onClick={() => onOpenMachine(m.id)}>
                  {m.label ?? `Machine ${m.machine_number ?? '?'}`}
                </button>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {m.kind === 'pseudo' ? 'station · ' : ''}
                  {m.machine_number ? `#${m.machine_number} · ` : ''}
                  {typeName(m.default_exercise_type_id)}
                  {m.gym_id !== gymId ? ` · ${gymName(m.gym_id)}` : ''}
                </div>
                {editingId === m.id && (
                  <div className="card" style={{ marginTop: 8 }}>
                    {machineFormFields(
                      editForm,
                      (patch) => setEditForm((f) => ({ ...f, ...patch })),
                      editNewType,
                      setEditNewType,
                    )}
                    {error && <div className="error">{error}</div>}
                    <div className="row">
                      <button
                        className="primary"
                        style={{ flex: 1 }}
                        onClick={() => void saveEdit()}
                        disabled={editSaving}
                      >
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="secondary" style={{ marginTop: 0, width: 'auto' }} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {editingId !== m.id && (
                <button className="link" onClick={() => startEdit(m)} aria-label={`Edit ${m.label ?? 'machine'}`}>
                  Edit
                </button>
              )}
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
        {machineFormFields(
          form,
          (patch) => setForm((f) => ({ ...f, ...patch })),
          newType,
          setNewType,
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Registering…' : 'Register machine'}
        </button>
      </section>

      <section className="card">
        <h2>Exercise types</h2>
        <ul className="setlist">
          {types.map((t) => (
            <li key={t.id}>
              {renamingTypeId === t.id ? (
                <div className="row" style={{ flex: 1 }}>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    aria-label="Exercise name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename();
                    }}
                  />
                  <button onClick={() => void saveRename()}>Save</button>
                  <button
                    className="link"
                    onClick={() => {
                      setRenamingTypeId(null);
                      setRenameValue('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span>{t.name}</span>
                  <button
                    className="link"
                    onClick={() => {
                      setRenamingTypeId(t.id);
                      setRenameValue(t.name);
                    }}
                    aria-label={`Rename ${t.name}`}
                  >
                    Rename
                  </button>
                </>
              )}
            </li>
          ))}
          {types.length === 0 && <p className="muted">No exercise types yet.</p>}
        </ul>
      </section>
    </div>
  );
}
