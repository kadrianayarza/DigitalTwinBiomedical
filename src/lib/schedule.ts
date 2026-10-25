// One day plan per patient: appointments interleaved with scheduled medicine doses,
// plus the workouts planned for that weekday. Pure helpers; ScheduleCard renders
// them and the tests import them directly.

import type { Appointment, ExerciseEntry, MedDose, Medication } from '../module_bindings/types';
import { doseSlots } from '../../spacetimedb/src/medication.ts';

export type DoseBlock = {
  kind: 'dose';
  timeMs: number;
  med: Medication;
  /** Live dose-row status (due | taken | skipped | missed), or 'scheduled' when the row has not materialised yet. */
  status: string;
};

export type ApptBlock = {
  kind: 'appt';
  timeMs: number;
  endMs: number;
  appt: Appointment;
};

export type DayBlock = DoseBlock | ApptBlock;

const MICROS = 1000n;

/** Dose slots inside [fromMs, toMs], cross-referenced with materialised dose rows. */
export function doseBlocksForDay(
  meds: readonly Medication[],
  doses: readonly MedDose[],
  fromMs: number,
  toMs: number
): DoseBlock[] {
  const from = BigInt(Math.round(fromMs)) * MICROS;
  const to = BigInt(Math.round(toMs)) * MICROS;
  const statusBySlot = new Map<string, string>();
  for (const d of doses) statusBySlot.set(`${d.medicationId}:${d.scheduledFor.microsSinceUnixEpoch}`, d.status);
  const out: DoseBlock[] = [];
  for (const med of meds) {
    if (!med.scheduleTimes.trim()) continue; // as-needed medicines have no fixed slots
    for (const slot of doseSlots(med.scheduleTimes, med.tzOffsetMin, from, to)) {
      out.push({
        kind: 'dose',
        timeMs: Number(slot / MICROS),
        med,
        status: statusBySlot.get(`${med.id}:${slot}`) ?? 'scheduled',
      });
    }
  }
  return out;
}

/** Appointments and dose slots for one day, earliest first. */
export function buildDayBlocks(
  appts: readonly Appointment[],
  meds: readonly Medication[],
  doses: readonly MedDose[],
  fromMs: number,
  toMs: number
): DayBlock[] {
  const blocks: DayBlock[] = [
    ...appts.map(appt => ({
      kind: 'appt' as const,
      timeMs: Number(appt.whenAt.microsSinceUnixEpoch / MICROS),
      endMs: Number(appt.whenAt.microsSinceUnixEpoch / MICROS) + appt.durationMin * 60_000,
      appt,
    })),
    ...doseBlocksForDay(meds, doses, fromMs, toMs),
  ];
  return blocks.sort((a, b) => a.timeMs - b.timeMs);
}

/** Planned weekly workouts landing on this date (planned days are Monday-first 0-6). */
export function plannedExerciseForDate(entries: readonly ExerciseEntry[], date: Date): ExerciseEntry[] {
  const weekdayMonFirst = (date.getDay() + 6) % 7;
  return entries.filter(e => e.status === 'planned' && e.day === weekdayMonFirst);
}

/** Workouts logged inside [fromMs, toMs), shown as done. */
export function doneExerciseForDate(
  entries: readonly ExerciseEntry[],
  fromMs: number,
  toMs: number
): ExerciseEntry[] {
  return entries.filter(e => {
    if (e.status !== 'done') return false;
    const ms = Number(e.createdAt.microsSinceUnixEpoch / MICROS);
    return ms >= fromMs && ms < toMs;
  });
}

/** Compact per-day counts for the week strip. */
export function dayTaskCounts(
  meds: readonly Medication[],
  doses: readonly MedDose[],
  exercise: readonly ExerciseEntry[],
  date: Date,
  fromMs: number,
  toMs: number
): { doses: number; workouts: number } {
  return {
    doses: doseBlocksForDay(meds, doses, fromMs, toMs).length,
    workouts: plannedExerciseForDate(exercise, date).length,
  };
}
