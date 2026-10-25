// Appointments: shared catalogue (server module) plus the pure client-side date math
// for the day / week / month views. Re-exported here for one import path.

import type { Timestamp } from 'spacetimedb';
import { tsMs } from './format';

export {
  APPT_DURATIONS,
  APPT_KINDS,
  APPT_KIND_LABEL,
  APPT_MODES,
  APPT_MODE_LABEL,
  APPT_STATUSES,
  APPT_STATUS_LABEL,
  isApptKind,
  isApptMode,
  isApptStatus,
  overlaps,
  type ApptKind,
  type ApptMode,
  type ApptStatus,
} from '../../spacetimedb/src/appointments';

/** Local day key, YYYY-MM-DD, so grouping matches the wall clock the patient sees. */
export function dayKey(t: Timestamp): string {
  const d = new Date(tsMs(t));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midnight of the given Date, as a Date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Sunday of the week the given date falls in. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/** Calendar grid for one month: leading Sundays from the previous month, 6 rows. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** '10:30 AM' style start time. */
export function apptTime(t: Timestamp): string {
  return new Date(tsMs(t)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** End time from start + duration, for the '10:30 – 11:00 AM' range. */
export function apptEnd(t: Timestamp, durationMin: number): string {
  return new Date(tsMs(t) + durationMin * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** 'Tue, Oct 27' style date label. */
export function dayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Same-day label, the way a person would say it: Today / Tomorrow / Tue, Oct 27. */
export function relativeDayLabel(d: Date, today: Date): string {
  const one = startOfDay(d).getTime() === startOfDay(today).getTime();
  if (one) return 'Today';
  const tmr = new Date(startOfDay(today));
  tmr.setDate(tmr.getDate() + 1);
  if (startOfDay(d).getTime() === tmr.getTime()) return 'Tomorrow';
  return dayLabel(d);
}

/** Value for an <input type="datetime-local"> from a timestamp, in local time. */
export function toLocalInput(t: Timestamp): string {
  return dateToLocalInput(new Date(tsMs(t)));
}

function dateToLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Timestamp (micros as bigint) from a datetime-local input value. */
export function fromLocalInput(value: string): bigint {
  const ms = new Date(value).getTime();
  return BigInt(Math.round(ms * 1000));
}

/** Default booking time: the next half-hour boundary at least 45 minutes out. */
export function nextSlot(now = new Date()): string {
  const d = new Date(now.getTime() + 45 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return dateToLocalInput(d);
}
