import { useMemo, useState } from 'react';
import type { Appointment } from '../module_bindings/types';
import { appointmentsFor, dosesFor, exerciseFor, medicationsFor, useData } from '../lib/data';
import { buildDayBlocks, dayTaskCounts, doneExerciseForDate, doseBlocksForDay, plannedExerciseForDate } from '../lib/schedule';
import { DOSE_LABEL } from '../lib/meds';
import { jumpToTab } from '../lib/navigate';
import {
  APPT_KIND_LABEL,
  APPT_MODE_LABEL,
  APPT_STATUS_LABEL,
  apptTime,
  dayKey,
  dayLabel,
  monthGrid,
  relativeDayLabel,
  startOfDay,
  startOfWeek,
  type ApptKind,
  type ApptMode,
  type ApptStatus,
} from '../lib/appointments';
import { Panel } from './ui';
import { AppointmentSheet } from './AppointmentSheet';

type View = 'day' | 'week' | 'month';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dose slots that have no dose row yet are 'scheduled'; the rest come from the row. */
const DOSE_STATUS_LABEL: Record<string, string> = { scheduled: 'Scheduled', ...DOSE_LABEL };

/** "2:30 PM" in the viewer's locale. */
const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const DAY_MS = 86_400_000;

/**
 * One patient's whole day plan: appointments interleaved with medicine dose times,
 * plus the workouts planned for that weekday. A day timeline, a week strip, and a
 * month grid are drilled from the same cursor so nothing hides behind navigation.
 * Appointment rows open their own sheet; dose and workout rows jump to the feature
 * that owns them. Shared by the patient view and the nurse chart.
 */
export function ScheduleCard({
  patientId,
  patientName,
  mode,
}: {
  patientId: bigint;
  patientName: string;
  mode: 'patient' | 'nurse';
}) {
  const data = useData();
  const rows = useMemo(() => appointmentsFor(data, patientId), [data, patientId]);
  const meds = useMemo(() => medicationsFor(data, patientId), [data, patientId]);
  const doses = useMemo(() => dosesFor(data, patientId), [data, patientId]);
  const exercise = useMemo(() => exerciseFor(data, patientId), [data, patientId]);
  const [view, setView] = useState<View>('day');
  const [cursor, setCursor] = useState(() => new Date());
  const [sheet, setSheet] = useState<{ existing?: Appointment } | null>(null);
  const today = startOfDay(new Date());

  // Grouped by local day key; lookup is by the same key the grid cells produce.
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of rows) {
      const k = dayKey(a.whenAt);
      const list = map.get(k);
      if (list) list.push(a);
      else map.set(k, [a]);
    }
    return map;
  }, [rows]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return rows.filter(a => a.status === 'booked' && Number(a.whenAt.microsSinceUnixEpoch / 1000n) >= now);
  }, [rows]);

  // The header answers "what is next" across both appointments and medicine times.
  const nextDose = useMemo(() => {
    const now = Date.now();
    return doseBlocksForDay(meds, doses, now, now + 48 * 3_600_000)
      .filter(b => b.status === 'scheduled' || b.status === 'due')
      .sort((a, b) => a.timeMs - b.timeMs)[0];
  }, [meds, doses]);

  const nextApptMs = upcoming[0] ? Number(upcoming[0].whenAt.microsSinceUnixEpoch / 1000n) : Infinity;
  const nextDoseMs = nextDose?.timeMs ?? Infinity;
  const code =
    nextApptMs === Infinity && nextDoseMs === Infinity
      ? 'Nothing ahead'
      : nextDoseMs < nextApptMs
        ? `Next: ${relativeDayLabel(new Date(nextDoseMs), today)} ${timeLabel(nextDoseMs)} · ${nextDose!.med.name}`
        : `Next: ${relativeDayLabel(new Date(nextApptMs), today)} ${apptTime(upcoming[0]!.whenAt)}`;

  const step = (dir: number) => {
    const d = new Date(cursor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  const pickDay = (d: Date) => {
    setCursor(startOfDay(d));
    setView('day');
  };

  const cursorDay = startOfDay(cursor);
  const cursorKey = dayKeyOf(cursorDay);
  const dayRows = byDay.get(cursorKey) ?? [];
  const dayFromMs = cursorDay.getTime();
  const dayToMs = dayFromMs + DAY_MS;

  // The compiled day plan: appointments and medicine times in one timeline, and
  // the workouts that fit anywhere in the day.
  const blocks = useMemo(
    () => buildDayBlocks(dayRows, meds, doses, dayFromMs, dayToMs),
    [dayRows, meds, doses, dayFromMs, dayToMs]
  );
  const plannedToday = useMemo(() => plannedExerciseForDate(exercise, cursorDay), [exercise, cursorDay]);
  const doneToday = useMemo(() => doneExerciseForDate(exercise, dayFromMs, dayToMs), [exercise, dayFromMs, dayToMs]);

  const weekStart = startOfWeek(cursor);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const monthTitle = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const grid = monthGrid(cursor.getFullYear(), cursor.getMonth());

  return (
    <Panel title="Schedule" code={code} className="sched" collapsible>
      <p className="muted small">
        {mode === 'patient'
          ? 'Your day at a glance: visits, medicine times, and workouts. Tap an appointment to reschedule or cancel it.'
          : `${patientName.split(' ')[0]}'s day: visits, medicine times, and workouts. Booking checks for overlaps, so the schedule stays coordinated.`}
      </p>

      <div className="sched__bar">
        <div className="seg" role="tablist" aria-label="Schedule view">
          {VIEWS.map(v => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'seg__btn seg__btn--on' : 'seg__btn'}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setSheet({})}>
          Book appointment
        </button>
      </div>

      <div className="sched__nav">
        <button type="button" className="btn btn--ghost sched__arrow" aria-label="Previous" onClick={() => step(-1)}>
          ‹
        </button>
        <span className="sched__where">
          {view === 'day' && dayHeader(cursorDay, today)}
          {view === 'week' && `Week of ${dayLabel(weekDays[0])}`}
          {view === 'month' && monthTitle}
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setCursor(new Date())}
          disabled={cursorKey === dayKeyOf(today)}
        >
          Today
        </button>
        <button type="button" className="btn btn--ghost sched__arrow" aria-label="Next" onClick={() => step(1)}>
          ›
        </button>
      </div>

      {view === 'day' && (
        <>
          <ul className="sched__list">
            {blocks.length === 0 && plannedToday.length === 0 && doneToday.length === 0 ? (
              <li className="sched__empty muted small">Nothing scheduled for this day.</li>
            ) : (
              blocks.map(b =>
                b.kind === 'appt' ? (
                  <li key={`a${b.appt.id}`}>
                    <button type="button" className="sched__row" onClick={() => setSheet({ existing: b.appt })}>
                      <span className="sched__time mono">
                        {timeLabel(b.timeMs)}
                        <span className="muted"> – {timeLabel(b.endMs)}</span>
                      </span>
                      <span className="sched__main">
                        <span className="sched__title">
                          {b.appt.title}
                          {b.appt.status !== 'booked' && (
                            <span className={`tag sched__status sched__status--${b.appt.status}`}>
                              {APPT_STATUS_LABEL[b.appt.status as ApptStatus] ?? b.appt.status}
                            </span>
                          )}
                        </span>
                        <span className="muted small">
                          {APPT_KIND_LABEL[b.appt.kind as ApptKind] ?? b.appt.kind} ·{' '}
                          {APPT_MODE_LABEL[b.appt.mode as ApptMode] ?? b.appt.mode}
                          {b.appt.location ? ` · ${b.appt.location}` : ''}
                        </span>
                        {b.appt.notes && <span className="muted small">{b.appt.notes}</span>}
                      </span>
                    </button>
                  </li>
                ) : (
                  <li key={`d${b.med.id}-${b.timeMs}`}>
                    <button
                      type="button"
                      className="sched__row sched__row--dose"
                      onClick={() => jumpToTab('medications')}
                      title="Open medicines"
                    >
                      <span className="sched__time mono">{timeLabel(b.timeMs)}</span>
                      <span className="sched__main">
                        <span className="sched__title">
                          {b.med.name} · {b.med.dose}
                          <span className={`tag sched__status sched__status--${b.status}`}>
                            {DOSE_STATUS_LABEL[b.status] ?? b.status}
                          </span>
                        </span>
                        <span className="muted small">
                          Medicine{b.med.requiresGlucose ? ' · check glucose first' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              )
            )}
          </ul>
          {(plannedToday.length > 0 || doneToday.length > 0) && (
            <div className="sched__anytime">
              <div className="sched__anytimehead muted small">Anytime today</div>
              {plannedToday.map(e => (
                <button
                  key={`p${e.id}`}
                  type="button"
                  className="sched__row sched__row--plan"
                  onClick={() => jumpToTab('exercise')}
                  title="Open exercise"
                >
                  <span className="sched__main">
                    <span className="sched__title">
                      {e.activity} · {e.minutes} min
                      <span className="tag sched__status sched__status--planned">Planned</span>
                    </span>
                    <span className="muted small">{e.intensity} · planned workout</span>
                  </span>
                </button>
              ))}
              {doneToday.map(e => (
                <div key={`x${e.id}`} className="sched__row sched__row--done">
                  <span className="sched__main">
                    <span className="sched__title">
                      {e.activity} · {e.minutes} min
                      <span className="tag sched__status sched__status--taken">Done</span>
                    </span>
                    <span className="muted small">Logged workout</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'week' && (
        <div className="sched__week">
          {weekDays.map(d => {
            const list = byDay.get(dayKeyOf(d)) ?? [];
            const dayStart = startOfDay(d).getTime();
            const tasks = dayTaskCounts(meds, doses, exercise, d, dayStart, dayStart + DAY_MS);
            return (
              <button
                key={dayKeyOf(d)}
                type="button"
                className={`sched__cell ${dayKeyOf(d) === dayKeyOf(today) ? 'sched__cell--today' : ''}`}
                onClick={() => pickDay(d)}
              >
                <span className="sched__cellhead">
                  <span className="muted small">{WEEKDAYS[d.getDay()]}</span>
                  <strong>{d.getDate()}</strong>
                </span>
                {list.slice(0, 3).map(a => (
                  <span key={String(a.id)} className={`sched__mini sched__mini--${a.status}`}>
                    {apptTime(a.whenAt)} {a.title}
                  </span>
                ))}
                {list.length > 3 && <span className="sched__more muted small">+{list.length - 3} more</span>}
                {(tasks.doses > 0 || tasks.workouts > 0) && (
                  <span className="sched__tasks muted small">
                    {[
                      tasks.doses > 0 ? `${tasks.doses} dose${tasks.doses === 1 ? '' : 's'}` : '',
                      tasks.workouts > 0 ? `${tasks.workouts} workout${tasks.workouts === 1 ? '' : 's'}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {view === 'month' && (
        <div className="sched__month">
          {WEEKDAYS.map(w => (
            <span key={w} className="sched__weekday muted small">
              {w}
            </span>
          ))}
          {grid.map(d => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const list = byDay.get(dayKeyOf(d)) ?? [];
            const isToday = dayKeyOf(d) === dayKeyOf(today);
            return (
              <button
                key={dayKeyOf(d)}
                type="button"
                className={`sched__mday ${inMonth ? '' : 'sched__mday--out'} ${isToday ? 'sched__mday--today' : ''}`}
                onClick={() => pickDay(d)}
              >
                <span className="sched__mnum">{d.getDate()}</span>
                <span className="sched__dots">
                  {list.slice(0, 4).map(a => (
                    <span key={String(a.id)} className={`sched__dot sched__dot--${a.status}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {sheet && (
        <AppointmentSheet
          patientId={patientId}
          patientName={patientName}
          mode={mode}
          existing={sheet.existing}
          onClose={() => setSheet(null)}
        />
      )}
    </Panel>
  );
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Day header: 'Today · Sun, Oct 25' when the words add something, the plain date otherwise. */
function dayHeader(d: Date, today: Date): string {
  const rel = relativeDayLabel(d, today);
  return rel === dayLabel(d) ? rel : `${rel} · ${dayLabel(d)}`;
}
