// Appointments shared by reducers, seeds, the client, and tests.
// One table serves the patient's own schedule and the nurse's day planning; the
// kinds are deliberately few and the durations a fixed menu, so booking stays quick.

export const APPT_KINDS = ['follow_up', 'therapy', 'lab', 'imaging', 'check_up', 'consult'] as const;
export type ApptKind = (typeof APPT_KINDS)[number];

export const APPT_KIND_LABEL: Record<ApptKind, string> = {
  follow_up: 'Follow-up',
  therapy: 'Therapy',
  lab: 'Lab work',
  imaging: 'Imaging',
  check_up: 'Check-up',
  consult: 'Consult',
};

export const APPT_MODES = ['in_person', 'video', 'phone'] as const;
export type ApptMode = (typeof APPT_MODES)[number];

export const APPT_MODE_LABEL: Record<ApptMode, string> = {
  in_person: 'In person',
  video: 'Video',
  phone: 'Phone',
};

export const APPT_STATUSES = ['booked', 'done', 'cancelled'] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];

export const APPT_STATUS_LABEL: Record<ApptStatus, string> = {
  booked: 'Booked',
  done: 'Completed',
  cancelled: 'Cancelled',
};

/** Fixed duration menu in minutes, so the booking sheet stays a one-tap choice. */
export const APPT_DURATIONS = [15, 30, 45, 50, 60, 90] as const;

export const APPT_TITLE_MAX = 120;
export const APPT_LOCATION_MAX = 200;
export const APPT_NOTES_MAX = 500;

export function isApptKind(v: string): v is ApptKind {
  return (APPT_KINDS as readonly string[]).includes(v);
}

export function isApptMode(v: string): v is ApptMode {
  return (APPT_MODES as readonly string[]).includes(v);
}

export function isApptStatus(v: string): v is ApptStatus {
  return (APPT_STATUSES as readonly string[]).includes(v);
}

/** True when two appointments share any time (half-open ranges; back-to-back is fine). */
export function overlaps(whenA: bigint, durA: number, whenB: bigint, durB: number): boolean {
  return whenA < whenB + BigInt(durB) * 60_000_000n && whenB < whenA + BigInt(durA) * 60_000_000n;
}

const DAY_MICROS = 86_400_000_000n;
const MINUTE_MICROS = 60_000_000n;

/**
 * Timestamp for `hour:minute` on the day `daysFromNow` (0 = today), expressed in the
 * demo timezone. Days can be negative, so seeds can carry a believable past: done
 * visits land behind now and booked ones ahead of it whatever time the demo runs.
 */
export function demoWhen(
  daysFromNow: number,
  hour: number,
  minute: number,
  nowMicros: bigint,
  tzOffsetMin: number
): bigint {
  const tz = BigInt(tzOffsetMin) * MINUTE_MICROS;
  const local = nowMicros + tz;
  const localDayStart = local - (local % DAY_MICROS);
  return (
    localDayStart +
    BigInt(daysFromNow) * DAY_MICROS +
    BigInt(hour) * 3_600_000_000n +
    BigInt(minute) * MINUTE_MICROS -
    tz
  );
}
