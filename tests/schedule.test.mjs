import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPT_DURATIONS,
  APPT_KINDS,
  APPT_KIND_LABEL,
  APPT_MODES,
  APPT_MODE_LABEL,
  APPT_STATUSES,
  APPT_STATUS_LABEL,
  APPT_LOCATION_MAX,
  APPT_NOTES_MAX,
  APPT_TITLE_MAX,
  demoWhen,
  isApptKind,
  isApptMode,
  isApptStatus,
  overlaps,
} from '../spacetimedb/src/appointments.ts';
import { EXAMPLE_APPOINTMENTS } from '../spacetimedb/src/examples.ts';
import { TABS, TAB_IDS, applyGoal, defaultLayout } from '../spacetimedb/src/layout.ts';

const MIN = 60_000_000n;

const ROSTER = [
  'Kadrian Ayarza',
  'Isak Smith',
  'Jesus Allejandro',
  'Tom Becker',
  'Mei Lin Wu',
  'Elena Novak',
  'Maria Delgado',
  'Daniel Cho',
  'Priya Nair',
];

test('the appointment catalogue is short, labeled, and validated', () => {
  assert.equal(APPT_KINDS.length, 6);
  assert.equal(APPT_MODES.length, 3);
  assert.equal(APPT_STATUSES.length, 3);
  for (const k of APPT_KINDS) assert.ok(APPT_KIND_LABEL[k], k);
  for (const m of APPT_MODES) assert.ok(APPT_MODE_LABEL[m], m);
  for (const s of APPT_STATUSES) assert.ok(APPT_STATUS_LABEL[s], s);
  assert.deepEqual(APPT_DURATIONS, [15, 30, 45, 50, 60, 90]);
  assert.equal(isApptKind('follow_up'), true);
  assert.equal(isApptKind('bogus'), false);
  assert.equal(isApptMode('video'), true);
  assert.equal(isApptMode('zoom'), false);
  assert.equal(isApptStatus('cancelled'), true);
  assert.equal(isApptStatus('bogus'), false);
  assert.ok(APPT_TITLE_MAX > 0 && APPT_LOCATION_MAX > 0 && APPT_NOTES_MAX > 0);
});

test('overlaps catches shared time but allows back-to-back bookings', () => {
  const t = 1_000_000_000_000_000n;
  // Back-to-back: 10:00-10:30 then 10:30-11:00 is fine.
  assert.equal(overlaps(t, 30, t + 30n * MIN, 30), false);
  // One minute inside is a conflict.
  assert.equal(overlaps(t, 30, t + 29n * MIN, 30), true);
  // Containment either way round.
  assert.equal(overlaps(t, 60, t + 10n * MIN, 15), true);
  assert.equal(overlaps(t + 10n * MIN, 15, t, 60), true);
  // Far apart is fine.
  assert.equal(overlaps(t, 30, t + 24n * 60n * MIN, 30), false);
});

test('demoWhen lands on the requested clock time in the demo timezone', () => {
  // Day 20000 at 10:20 UTC; with a +420-minute demo timezone the local clock reads 17:20.
  const DAY = 86_400_000_000n;
  const now = 20_000n * DAY + 10n * 3_600_000_000n + 20n * MIN;
  const tz = 420;
  // Same local day at 8:30 local: 8h50m behind the current 17:20 local.
  const sameDay = demoWhen(0, 8, 30, now, tz);
  assert.equal(sameDay, now - (17n * 60n + 20n - (8n * 60n + 30n)) * MIN);
  // Tomorrow at 8:30 local is 24h later minus the same 8h50m: 15h10m ahead.
  const tomorrow = demoWhen(1, 8, 30, now, tz);
  assert.equal(tomorrow, now + (24n * 60n - (17n * 60n + 20n - (8n * 60n + 30n))) * MIN);
  // A past visit five local days back at 9:00 local: 5 days and 8h20m behind now,
  // so it falls between 4 and 6 days back.
  const past = demoWhen(-5, 9, 0, now, tz);
  assert.ok(past < now - 4n * DAY && past > now - 6n * DAY);
  // All results stay on exact minute boundaries.
  assert.equal(demoWhen(3, 14, 45, now, tz) % MIN, 0n);
});

test('every roster patient has a believable appointment history', () => {
  assert.deepEqual(Object.keys(EXAMPLE_APPOINTMENTS).sort(), [...ROSTER].sort());
  for (const [name, list] of Object.entries(EXAMPLE_APPOINTMENTS)) {
    assert.ok(list.length >= 2, `${name} has at least two appointments`);
    assert.ok(list.some(a => a.status === 'booked'), `${name} has something booked`);
    for (const a of list) {
      assert.ok(isApptKind(a.kind), `${name} kind ${a.kind}`);
      assert.ok(isApptMode(a.mode), `${name} mode ${a.mode}`);
      assert.ok(isApptStatus(a.status), `${name} status ${a.status}`);
      assert.ok(APPT_DURATIONS.includes(a.durationMin), `${name} duration ${a.durationMin}`);
      assert.ok(a.title.trim() && a.title.length <= APPT_TITLE_MAX, `${name} title`);
      assert.ok(a.location.trim() && a.location.length <= APPT_LOCATION_MAX, `${name} location`);
      assert.ok(!a.notes || a.notes.length <= APPT_NOTES_MAX, `${name} notes`);
      assert.ok(a.hour >= 0 && a.hour < 24 && a.minute >= 0 && a.minute < 60, `${name} clock`);
      // Booked rows must be safely in the future whenever the demo runs.
      if (a.status === 'booked') assert.ok(a.days >= 1, `${name} booked day ${a.days}`);
      // Past rows carry completed status, so the day view reads as history.
      if (a.days < 0) assert.equal(a.status, 'done', `${name} past row is done`);
    }
  }
});

test('no two booked seeds overlap for the same patient', () => {
  // Day 20000 at 10:20 UTC with the demo timezone, as in the demoWhen test.
  const now = 20_000n * 86_400_000_000n + 10n * 3_600_000_000n + 20n * MIN;
  for (const [name, list] of Object.entries(EXAMPLE_APPOINTMENTS)) {
    const booked = list
      .filter(a => a.status === 'booked')
      .map(a => ({ when: demoWhen(a.days, a.hour, a.minute, now, 420), dur: a.durationMin, title: a.title }));
    for (let i = 0; i < booked.length; i++) {
      for (let j = i + 1; j < booked.length; j++) {
        assert.equal(
          overlaps(booked[i].when, booked[i].dur, booked[j].when, booked[j].dur),
          false,
          `${name}: ${booked[i].title} vs ${booked[j].title}`
        );
      }
    }
  }
});

test('the schedule tab exists for both audiences and is reachable from the goal', () => {
  assert.ok(TAB_IDS.includes('schedule'));
  const meta = TABS.find(t => t.id === 'schedule');
  assert.ok(meta);
  assert.equal(meta.patient, true);
  assert.equal(meta.nurse, true);
  const layout = applyGoal(defaultLayout(), 'I want to keep track of my appointments and visits');
  const schedule = layout.tabs.find(t => t.id === 'schedule');
  assert.equal(schedule.on, true);
  assert.equal(schedule.priority, 'high');
  assert.equal(layout.tabs[0].id, 'schedule');
});
