import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMachineImage,
  createExerciseType,
  createVariation,
  deleteMachineImage,
  getLastSessionSets,
  getMachine,
  getMostRecentExerciseForMachine,
  listExerciseTypes,
  listMachineImages,
  listVariations,
  logSet,
} from '../db/client';
import type {
  EnrichedSet,
  ExerciseType,
  Machine,
  MachineImage,
  MachineImageKind,
  Variation,
} from '../db/types';
import { MACHINE_IMAGE_KINDS } from '../db/types';
import { downscaleToJpeg, imageObjectUrl } from '../photos/downscale';

interface Props {
  machineId: string;
  onBack: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function kindLabel(kind: MachineImageKind): string {
  return MACHINE_IMAGE_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function PhotoThumb({ photo, onDelete }: { photo: MachineImage; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = imageObjectUrl(photo.image_blob, photo.mime_type);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return (
    <div className="photothumb">
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={kindLabel(photo.kind)} />
        </a>
      )}
      <span className="muted">{kindLabel(photo.kind)}</span>
      <button className="link" onClick={onDelete} aria-label={`Delete ${kindLabel(photo.kind)} photo`}>
        ×
      </button>
    </div>
  );
}

const GRIP_WIDTHS = ['', 'narrow', 'close', 'medium', 'wide'];
const GRIP_ORIENTATIONS = ['', 'pronated', 'supinated', 'neutral'];

export default function MachineView({ machineId, onBack }: Props) {
  const [machine, setMachine] = useState<Machine | null>(null);
  const [exerciseTypes, setExerciseTypes] = useState<ExerciseType[]>([]);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [lastSets, setLastSets] = useState<EnrichedSet[]>([]);
  const [photos, setPhotos] = useState<MachineImage[]>([]);

  // Exercise selection is an explicit per-session step, decoupled from the
  // machine: the picker starts at the machine's default exercise, else the
  // most recently logged exercise here, else empty (user picks/adds).
  const [exerciseId, setExerciseId] = useState('');
  const [newExercise, setNewExercise] = useState('');
  // Variation selection.
  const [variationId, setVariationId] = useState('');
  const [showNewVariation, setShowNewVariation] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [gripWidth, setGripWidth] = useState('');
  const [gripOrientation, setGripOrientation] = useState('');

  const [reps, setReps] = useState('10');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Photos.
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoKind, setPhotoKind] = useState<MachineImageKind>('qr_plate');
  const [uploading, setUploading] = useState(false);

  // Load the session summary for an exercise (or across all exercises when
  // none is selected) and pre-fill weight from its most recent set.
  const loadSession = useCallback(
    async (exId?: string) => {
      const sets = await getLastSessionSets(machineId, exId ?? null);
      setLastSets(sets);
      if (sets.length > 0) setWeight(String(sets[sets.length - 1].weight_raw));
    },
    [machineId],
  );

  // Initial load: machine, exercise types, photos, then resolve the starting
  // exercise (default → most recently logged here → none) and its session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getMachine(machineId);
        if (cancelled) return;
        setMachine(m);
        const [types, imgs] = await Promise.all([
          listExerciseTypes(),
          listMachineImages(machineId),
        ]);
        if (cancelled) return;
        setExerciseTypes(types);
        setPhotos(imgs);
        // NOTE: photoKind is intentionally NOT reset here. It classifies the
        // *pending* photo the user is about to attach; resetting it on every
        // data load would wipe the user's choice. The default is set once
        // per machine in the effect below.
        let initial: string | null = m?.default_exercise_type_id ?? null;
        if (!initial) initial = await getMostRecentExerciseForMachine(machineId);
        if (cancelled) return;
        const exId = initial ?? '';
        setExerciseId(exId);
        await loadSession(exId || undefined);
      } catch (e: unknown) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load machine');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [machineId, loadSession]);

  // Default the photo classifier when the machine (or its kind) changes.
  // Afterwards the user's choice sticks across data refreshes.
  const machineKind = machine?.kind;
  useEffect(() => {
    if (machineKind) setPhotoKind(machineKind === 'pseudo' ? 'name' : 'qr_plate');
  }, [machineId, machineKind]);

  // Load variations whenever the selected exercise changes.
  useEffect(() => {
    if (!exerciseId) {
      setVariations([]);
      return;
    }
    listVariations(exerciseId)
      .then((v) => {
        setVariations(v);
        setVariationId((prev) => (v.some((x) => x.id === prev) ? prev : ''));
      })
      .catch(() => setVariations([]));
  }, [exerciseId]);

  // Switching exercises is one tap: reload that exercise's session summary,
  // pre-fill its weight, and reset the variation choice.
  const onExerciseChange = (id: string) => {
    setExerciseId(id);
    setNewExercise('');
    setVariationId('');
    setShowNewVariation(false);
    setNewVarName('');
    loadSession(id || undefined).catch(() =>
      setError('Failed to load session for that exercise'),
    );
  };

  const submit = async () => {
    setError(null);
    let exId = exerciseId;
    const trimmedNew = newExercise.trim();
    if (trimmedNew) {
      const created = await createExerciseType(trimmedNew);
      exId = created.id;
      setExerciseTypes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewExercise('');
      setExerciseId(exId);
    }
    if (!exId) {
      setError('Pick an exercise first.');
      return;
    }
    let varId: string | null = variationId || null;
    if (showNewVariation) {
      if (!newVarName.trim()) {
        setError('Give the new variation a name.');
        return;
      }
      const created = await createVariation({
        exercise_type_id: exId,
        name: newVarName,
        attributes: { grip_width: gripWidth, grip_orientation: gripOrientation },
      });
      varId = created.id;
      setVariations((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setVariationId(varId);
      setShowNewVariation(false);
      setNewVarName('');
      setGripWidth('');
      setGripOrientation('');
    }
    const repsNum = parseInt(reps, 10);
    const weightNum = parseFloat(weight);
    const rpeNum = rpe.trim() === '' ? null : parseFloat(rpe);
    if (!Number.isFinite(repsNum) || repsNum <= 0 || !Number.isFinite(weightNum) || weightNum < 0) {
      setError('Enter valid reps and weight.');
      return;
    }
    if (rpeNum !== null && (!Number.isFinite(rpeNum) || rpeNum < 1 || rpeNum > 10)) {
      setError('RPE must be between 1 and 10.');
      return;
    }
    setSaving(true);
    try {
      await logSet({
        machine_id: machineId,
        exercise_type_id: exId,
        variation_id: varId,
        reps: repsNum,
        weight_raw: weightNum,
        rpe: rpeNum,
      });
      setRpe('');
      // Reload the session for the exercise just logged; the user's exercise
      // selection is left alone (no snap-back to the machine default).
      await loadSession(exId || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log set');
    } finally {
      setSaving(false);
    }
  };

  const onPhotoFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { bytes, mimeType } = await downscaleToJpeg(file);
      await addMachineImage({ machine_id: machineId, kind: photoKind, image_blob: bytes, mime_type: mimeType });
      setPhotos(await listMachineImages(machineId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach photo');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (id: string) => {
    await deleteMachineImage(id);
    setPhotos(await listMachineImages(machineId));
  };

  const selectedExerciseName = exerciseId
    ? (exerciseTypes.find((t) => t.id === exerciseId)?.name ?? 'Unknown exercise')
    : null;
  const exerciseName =
    selectedExerciseName ??
    (machine?.kind === 'pseudo' ? 'Pick an exercise below' : 'Unknown exercise');

  return (
    <div className="page">
      <button className="link" onClick={onBack}>
        ← Back
      </button>
      {machine ? (
        <>
          <h1>{machine.label ?? `Machine ${machine.machine_number ?? ''}`}</h1>
          <p className="muted">
            {exerciseName}
            {machine.kind === 'physical' && machine.machine_number
              ? ` · #${machine.machine_number}`
              : ''}
            {machine.kind === 'pseudo' ? ' · no-scan station' : ''}
          </p>

          <section className="card">
            <h2>Log a set</h2>
            <label className="field">
              <span>Exercise</span>
              <select
                value={exerciseId}
                onChange={(e) => onExerciseChange(e.target.value)}
                aria-label="Exercise"
              >
                <option value="">— pick —</option>
                {exerciseTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Or new exercise</span>
              <input
                value={newExercise}
                onChange={(e) => setNewExercise(e.target.value)}
                placeholder="e.g. Dumbbell Bench Press"
              />
            </label>
            {exerciseId && (
              <label className="field">
                <span>Variation (optional)</span>
                <select
                  value={showNewVariation ? '__new' : variationId}
                  onChange={(e) => {
                    if (e.target.value === '__new') setShowNewVariation(true);
                    else {
                      setShowNewVariation(false);
                      setVariationId(e.target.value);
                    }
                  }}
                >
                  <option value="">— none —</option>
                  {variations.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                  <option value="__new">＋ New variation…</option>
                </select>
              </label>
            )}
            {showNewVariation && (
              <div className="card" style={{ marginTop: 8 }}>
                <label className="field">
                  <span>Variation name</span>
                  <input
                    value={newVarName}
                    onChange={(e) => setNewVarName(e.target.value)}
                    placeholder="e.g. Close-grip supinated"
                  />
                </label>
                <div className="row">
                  <label className="field">
                    <span>Grip width</span>
                    <select value={gripWidth} onChange={(e) => setGripWidth(e.target.value)}>
                      {GRIP_WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {w || '—'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Grip orientation</span>
                    <select
                      value={gripOrientation}
                      onChange={(e) => setGripOrientation(e.target.value)}
                    >
                      {GRIP_ORIENTATIONS.map((o) => (
                        <option key={o} value={o}>
                          {o || '—'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
            <div className="row3">
              <label className="field">
                <span>Reps</span>
                <input
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  inputMode="numeric"
                  aria-label="Reps"
                />
              </label>
              <label className="field">
                <span>Weight</span>
                <input
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  inputMode="decimal"
                  placeholder="lbs"
                  aria-label="Weight"
                />
              </label>
              <label className="field">
                <span>RPE</span>
                <input
                  value={rpe}
                  onChange={(e) => setRpe(e.target.value)}
                  inputMode="decimal"
                  placeholder="1–10"
                  aria-label="RPE"
                />
              </label>
            </div>
            {error && <div className="error">{error}</div>}
            <button className="primary" onClick={() => void submit()} disabled={saving}>
              {saving ? 'Logging…' : 'Log set'}
            </button>
            {/* STUB: equivalent-weight hint. Ratio learning lands in the next step. */}
            <p className="hint">
              Equivalent on reference machine: — <span className="muted">(coming soon)</span>
            </p>
          </section>

          <section className="card">
            <h2>
              Last session
              {selectedExerciseName ? ` — ${selectedExerciseName}` : ''}
            </h2>
            {lastSets.length === 0 ? (
              <p className="muted">
                {selectedExerciseName
                  ? `No ${selectedExerciseName} sets logged on this machine yet.`
                  : 'No sets logged on this machine yet.'}
              </p>
            ) : (
              <>
                <p className="muted">{formatDate(lastSets[0].performed_at)}</p>
                <ul className="setlist">
                  {lastSets.map((s) => (
                    <li key={s.id}>
                      <span>
                        {s.reps} reps × {s.weight_raw} lbs
                        {s.variation_name ? ` · ${s.variation_name}` : ''}
                        {!exerciseId && s.exercise_name
                          ? ` · ${s.exercise_name}`
                          : ''}
                      </span>
                      <span className="muted">{s.rpe != null ? `RPE ${s.rpe}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <h2>Photos</h2>
            {photos.length === 0 ? (
              <p className="muted">No photos yet — snap the plate, badges, or muscle diagram.</p>
            ) : (
              <div className="photogrid">
                {photos.map((p) => (
                  <PhotoThumb key={p.id} photo={p} onDelete={() => void removePhoto(p.id)} />
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Photo type</span>
                <select
                  value={photoKind}
                  onChange={(e) => setPhotoKind(e.target.value as MachineImageKind)}
                >
                  {MACHINE_IMAGE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{ alignSelf: 'flex-end' }}
              >
                {uploading ? 'Adding…' : 'Add photo'}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => void onPhotoFile(e.target.files?.[0])}
            />
            <p className="muted">Uses the camera on phones, file picker on desktop.</p>
          </section>
        </>
      ) : (
        <p className="muted">Loading machine…</p>
      )}
    </div>
  );
}
