// Shared domain types for the gym tracker.

export interface Gym {
  id: string;
  name: string;
  coarse_lat: number | null;
  coarse_lng: number | null;
  notes: string | null;
  updated_at: string;
}

export interface ExerciseType {
  id: string;
  name: string;
  updated_at: string;
}

/** A named variant of an exercise, e.g. "Close-grip supinated" lat pulldown. */
export interface Variation {
  id: string;
  exercise_type_id: string;
  name: string;
  /** Free-form attributes, e.g. {grip_width: "close", grip_orientation: "supinated"}. */
  attributes: Record<string, string>;
  updated_at: string;
}

export type MachineKind = 'physical' | 'pseudo';

export interface Machine {
  id: string;
  gym_id: string;
  kind: MachineKind;
  qr_payload: string | null;
  machine_number: string | null;
  default_exercise_type_id: string | null;
  label: string | null;
  updated_at: string;
}

/** A logged set. Named SetEntry to avoid clashing with the global Set. */
export interface SetEntry {
  id: string;
  machine_id: string;
  exercise_type_id: string;
  variation_id: string | null;
  performed_at: string; // ISO timestamp
  reps: number;
  weight_raw: number;
  rpe: number | null;
  notes: string | null;
  updated_at: string;
}

export interface MachineRatio {
  exercise_type_id: string;
  from_machine_id: string;
  to_machine_id: string;
  ratio: number;
  sample_count: number;
  updated_at: string;
}

export type MachineImageKind = 'qr_plate' | 'name' | 'manufacturer' | 'muscle_diagram';

export const MACHINE_IMAGE_KINDS: Array<{ value: MachineImageKind; label: string }> = [
  { value: 'qr_plate', label: 'QR code / number plate' },
  { value: 'name', label: 'Name plate' },
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'muscle_diagram', label: 'Muscle-group diagram' },
];

export interface MachineImage {
  id: string;
  machine_id: string;
  kind: MachineImageKind;
  /** Downscaled JPEG bytes. */
  image_blob: Uint8Array;
  mime_type: string;
  captured_at: string;
  notes: string | null;
}

/** A set joined with its machine/exercise/gym/variation for history + CSV export. */
export interface EnrichedSet extends SetEntry {
  machine_label: string | null;
  machine_number: string | null;
  exercise_name: string | null;
  variation_name: string | null;
  gym_name: string | null;
}
