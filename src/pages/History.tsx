import { useEffect, useMemo, useState } from 'react';
import { getAllSetsEnriched } from '../db/client';
import type { EnrichedSet } from '../db/types';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

interface ExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  sets: EnrichedSet[];
}

interface Session {
  day: string;
  label: string;
  gyms: string[];
  totalSets: number;
  groups: ExerciseGroup[];
}

function buildSessions(sets: EnrichedSet[]): Session[] {
  const days = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const key = dayKey(s.performed_at);
    const list = days.get(key);
    if (list) list.push(s);
    else days.set(key, [s]);
  }
  // getAllSetsEnriched returns newest-first, so insertion order is newest day first.
  return [...days.entries()].map(([day, daySets]) => {
    const groups = new Map<string, ExerciseGroup>();
    for (const s of daySets) {
      const g = groups.get(s.exercise_type_id);
      if (g) g.sets.push(s);
      else
        groups.set(s.exercise_type_id, {
          exerciseId: s.exercise_type_id,
          exerciseName: s.exercise_name ?? 'Unknown exercise',
          sets: [s],
        });
    }
    const gyms = [...new Set(daySets.map((s) => s.gym_name).filter((x): x is string => !!x))];
    return {
      day,
      label: formatDay(daySets[0].performed_at),
      gyms,
      totalSets: daySets.length,
      groups: [...groups.values()],
    };
  });
}

function matches(s: EnrichedSet, q: string): boolean {
  const hay = [s.exercise_name, s.machine_label, s.machine_number, s.variation_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function SetLine({ s }: { s: EnrichedSet }) {
  const where = [s.machine_label, s.machine_number ? `#${s.machine_number}` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <li>
      <span>
        {s.reps} reps × {s.weight_raw} lbs
        {s.variation_name ? ` · ${s.variation_name}` : ''}
        {where ? <span className="muted"> · {where}</span> : null}
      </span>
      <span className="muted">{s.rpe != null ? `RPE ${s.rpe}` : ''}</span>
    </li>
  );
}

export default function History() {
  const [sets, setSets] = useState<EnrichedSet[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllSetsEnriched()
      .then(setSets)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load feed'));
  }, []);

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? sets.filter((s) => matches(s, q)) : sets;
    return buildSessions(filtered);
  }, [sets, query]);

  return (
    <div className="page">
      <h1>History</h1>
      <p className="muted">Your recent workouts, newest first.</p>

      <div className="card" style={{ marginBottom: 4 }}>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Exercise, machine, or variation…"
            inputMode="search"
            aria-label="Search workouts"
          />
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {sessions.length === 0 ? (
        <p className="muted">
          {query.trim() ? 'No workouts match your search.' : 'No workouts logged yet.'}
        </p>
      ) : (
        sessions.map((session) => (
          <section className="card" key={session.day}>
            <h2>{session.label}</h2>
            <p className="muted" style={{ marginTop: -4 }}>
              {session.gyms.join(' · ')}
              {session.gyms.length > 0 ? ' · ' : ''}
              {session.totalSets} set{session.totalSets === 1 ? '' : 's'}
            </p>
            {session.groups.map((g) => (
              <div key={g.exerciseId} style={{ marginTop: 12 }}>
                <div className="session-exercise">{g.exerciseName}</div>
                <ul className="setlist">
                  {g.sets.map((s) => (
                    <SetLine key={s.id} s={s} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
