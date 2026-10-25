// The schedule tab compiles appointments, medicine dose times, and planned
// workouts into one day plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayBlocks,
  dayTaskCounts,
  doneExerciseForDate,
  doseBlocksForDay,
  plannedExerciseForDate,
} from '../src/lib/schedule.ts';

const HOUR = 3_600_000;
const DAY_START = Date.UTC(2026, 9, 25); // Sun Oct 25 2026, UTC
const DAY_END = DAY_START + 24 * HOUR;
const micros = ms => BigInt(ms) * 1000n;

const med = (id, times, tzOffsetMin = 0) => ({
  id: BigInt(id),
  patientId: 1n,
  name: `Med${id}`,
  dose: '500 mg',
  schedule: '',
  createdAt: { microsSinceUnixEpoch: 0n },
  kind: 'other',
  route: 'oral',
  instructions: '',
  sideEffects: '',
  contraindications: '',
  scheduleTimes: times,
  tzOffsetMin,
  remindersOn: true,
  requiresGlucose: false,
});

const doseRow = (medicationId, ms, status) => ({
  id: 1n,
  slotKey: `${medicationId}:${micros(ms)}`,
  medicationId: BigInt(medicationId),
  patientId: 1n,
  scheduledFor: { microsSinceUnixEpoch: micros(ms) },
  status,
  glucoseMgDl: 0,
  note: '',
  loggedAt: undefined,
  loggedBy: '',
});

test('dose slots land on the med schedule times inside the day', () => {
  const blocks = doseBlocksForDay([med(7, '08:00,20:00')], [], DAY_START, DAY_END);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(b => (b.timeMs - DAY_START) / HOUR), [8, 20]);
  assert.ok(blocks.every(b => b.status === 'scheduled'));
});

test('a materialised dose row supplies the live status', () => {
  const rows = [doseRow(7, DAY_START + 8 * HOUR, 'taken')];
  const blocks = doseBlocksForDay([med(7, '08:00,20:00')], rows, DAY_START, DAY_END);
  assert.equal(blocks[0].status, 'taken');
  assert.equal(blocks[1].status, 'scheduled');
});

test('as-needed medicines produce no slots', () => {
  assert.equal(doseBlocksForDay([med(9, '')], [], DAY_START, DAY_END).length, 0);
});

test('appointments and doses interleave earliest first', () => {
  const appt = {
    id: 5n,
    patientId: 1n,
    title: 'CBT session',
    kind: 'therapy',
    whenAt: { microsSinceUnixEpoch: micros(DAY_START + 10 * HOUR) },
    durationMin: 50,
    mode: 'video',
    location: '',
    notes: '',
    status: 'booked',
    createdBy: 'Nurse Vera',
    createdAt: { microsSinceUnixEpoch: 0n },
  };
  const blocks = buildDayBlocks([appt], [med(7, '08:00,20:00')], [], DAY_START, DAY_END);
  assert.deepEqual(blocks.map(b => b.kind), ['dose', 'appt', 'dose']);
  assert.equal(blocks[1].endMs - blocks[1].timeMs, 50 * 60_000);
});

test('planned workouts match the weekday, Monday-first', () => {
  const sunday = new Date(2026, 9, 25); // JS getDay() = 0 -> Monday-first index 6
  const monday = new Date(2026, 9, 26);
  const plan = day => ({ id: 1n, patientId: 1n, status: 'planned', activity: 'Walk', minutes: 30, intensity: 'light', day, note: '', source: 'form', createdBy: '', createdAt: { microsSinceUnixEpoch: 0n } });
  assert.deepEqual(plannedExerciseForDate([plan(6), plan(0)], sunday).map(e => e.day), [6]);
  assert.deepEqual(plannedExerciseForDate([plan(6), plan(0)], monday).map(e => e.day), [0]);
});

test('done workouts count only when logged that day', () => {
  const done = ms => ({ id: 2n, patientId: 1n, status: 'done', activity: 'Run', minutes: 20, intensity: 'moderate', day: 0, note: '', source: 'form', createdBy: '', createdAt: { microsSinceUnixEpoch: micros(ms) } });
  const inside = doneExerciseForDate([done(DAY_START + 5 * HOUR), done(DAY_START - HOUR)], DAY_START, DAY_END);
  assert.equal(inside.length, 1);
});

test('week-strip task counts combine doses and planned workouts', () => {
  const sunday = new Date(2026, 9, 25);
  const plan = { id: 3n, patientId: 1n, status: 'planned', activity: 'Yoga', minutes: 45, intensity: 'light', day: 6, note: '', source: 'form', createdBy: '', createdAt: { microsSinceUnixEpoch: 0n } };
  const counts = dayTaskCounts([med(7, '08:00,20:00'), med(8, '12:00')], [], [plan], sunday, DAY_START, DAY_END);
  assert.deepEqual(counts, { doses: 3, workouts: 1 });
});
