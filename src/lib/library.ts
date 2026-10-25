import type { HexTone } from '../components/ui';
import type { LibraryEntry } from '../module_bindings/types';
import {
  FDA_SECTION_PREFIX,
  FLAG_LABEL,
  FLAG_PATIENT_LABEL,
  HISTORY_CATEGORIES,
  HISTORY_LABEL,
  LIB_KINDS,
  LIB_KIND_LABEL,
  isCritical,
  labFlag,
  matchEntry,
  rangeText,
  slugify,
} from '../../spacetimedb/src/library.ts';

export {
  FDA_SECTION_PREFIX,
  FLAG_LABEL,
  FLAG_PATIENT_LABEL,
  HISTORY_CATEGORIES,
  HISTORY_LABEL,
  LIB_KINDS,
  LIB_KIND_LABEL,
  isCritical,
  labFlag,
  matchEntry,
  rangeText,
  slugify,
};

/** Hex tone for a lab flag. */
export const FLAG_TONE: Record<string, HexTone> = {
  normal: 'ok',
  low: 'watch',
  high: 'watch',
  critical_low: 'alarm',
  critical_high: 'alarm',
};

const KIND_ORDER: Record<string, number> = { medication: 0, lab: 1, condition: 2, device: 3 };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Search library entries by name, alias, category, or summary text. */
export function searchLibrary(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const q = norm(query);
  const pool = q
    ? entries.filter(e =>
        [e.name, e.aliases, e.category, e.summary, e.patientSummary].some(t => norm(t).includes(q))
      )
    : [...entries];
  return pool.sort(
    (a, b) =>
      (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name)
  );
}

/** Related slugs of an entry, resolved to entries that exist. */
export function relatedEntries(
  data: { libraryEntries: readonly LibraryEntry[] },
  entry: LibraryEntry
): LibraryEntry[] {
  return entry.related
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(slug => data.libraryEntries.find(e => e.slug === slug))
    .filter((e): e is LibraryEntry => !!e);
}
