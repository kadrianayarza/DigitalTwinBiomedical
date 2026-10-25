import type { LibraryEntry, LibrarySection, Medication } from '../module_bindings/types';
import type { HexTone } from '../components/ui';
import { GLUCOSE_HIGH_MGDL, GLUCOSE_LOW_MGDL, doseSlots } from '../../spacetimedb/src/medication.ts';
import { matchEntry } from './library.ts';

export {
  GLUCOSE_HIGH_MGDL,
  GLUCOSE_LOW_MGDL,
  MED_KINDS,
  MED_KIND_LABEL,
  MED_PRESETS,
  MED_ROUTES,
  isInsulin,
  normalizeTimes,
  type MedPreset,
} from '../../spacetimedb/src/medication.ts';

export const DOSE_LABEL: Record<string, string> = {
  due: 'Due',
  taken: 'Taken',
  skipped: 'Skipped',
  missed: 'Missed',
};

export const DOSE_TONE: Record<string, HexTone> = {
  due: 'info',
  taken: 'ok',
  skipped: 'watch',
  missed: 'alarm',
};

/** Scheduled dose times (epoch ms) from now through the next `hours`. */
export function upcomingSlots(m: Medication, hours: number, now = Date.now()): number[] {
  const from = BigInt(now) * 1000n;
  const to = from + BigInt(hours) * 3_600_000_000n;
  return doseSlots(m.scheduleTimes, m.tzOffsetMin, from, to).map(us => Number(us / 1000n));
}

export function glucoseTone(mgdl: number): HexTone {
  if (!(mgdl > 0)) return 'off';
  if (mgdl < GLUCOSE_LOW_MGDL || mgdl >= GLUCOSE_HIGH_MGDL) return 'alarm';
  if (mgdl > 180) return 'watch';
  return 'ok';
}

/** "21:00" -> "9:00 PM" in the viewer's locale. */
export function hhmmLabel(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Date#getTimezoneOffset minutes -> "UTC−7". */
export function utcLabel(offsetMin: number) {
  const total = -offsetMin;
  const sign = total < 0 ? '−' : '+';
  const h = Math.floor(Math.abs(total) / 60);
  const m = Math.abs(total) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export const splitLines = (s: string) => s.split('\n').filter(Boolean);

/** Patient-safe, medication-specific details with curated library fallbacks. */
export function patientMedicationInfo(
  med: Medication,
  entries: readonly LibraryEntry[],
  sections: readonly LibrarySection[]
) {
  const entry = matchEntry(entries, med.name, 'medication');
  const entrySections = entry
    ? sections
        .filter(s => s.entryId === entry.id)
        .sort((a, b) => a.position - b.position)
    : [];
  const section = (heading: string) =>
    entrySections.find(s => s.heading.toLowerCase() === heading.toLowerCase());

  return {
    entry,
    patientSummary: entry?.patientSummary ?? '',
    uses: splitLines(section('Used for')?.body ?? ''),
    sideEffects: splitLines(med.sideEffects || section('Common side effects')?.body || ''),
    contraindications: splitLines(med.contraindications || section('Contraindications')?.body || ''),
  };
}
