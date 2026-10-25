import assert from 'node:assert/strict';
import test from 'node:test';
import { patientMedicationInfo } from '../src/lib/meds.ts';
import {
  MED_PRESETS,
  doseRules,
  doseSlots,
  glucoseRules,
  isInsulin,
  normalizeTimes,
} from '../spacetimedb/src/medication.ts';

const MIN = 60_000_000n;
const HOUR = 60n * MIN;
const at = iso => BigInt(Date.parse(iso)) * 1000n;
const iso = micros => new Date(Number(micros / 1000n)).toISOString();

test('dose times are normalized, sorted, and de-duplicated', () => {
  assert.equal(normalizeTimes(' 20:30, 8:00,08:00 '), '08:00,20:30');
  assert.throws(() => normalizeTimes(''), /at least one/);
  assert.throws(() => normalizeTimes('25:00'), /24-hour/);
  assert.throws(() => normalizeTimes('8am'), /24-hour/);
  const nine = Array.from({ length: 9 }, (_, i) => `0${i}:00`).join(',');
  assert.throws(() => normalizeTimes(nine), /At most 8/);
});

test('slots convert local clock times to UTC using the prescriber offset', () => {
  // Pacific daylight time: getTimezoneOffset() = 420, so 08:00 local is 15:00 UTC.
  const slots = doseSlots('08:00,21:00', 420, at('2026-10-24T00:00:00Z'), at('2026-10-25T00:00:00Z'));
  assert.deepEqual(slots.map(iso), ['2026-10-24T04:00:00.000Z', '2026-10-24T15:00:00.000Z']);
  const utc = doseSlots('08:00', 0, at('2026-10-24T07:00:00Z'), at('2026-10-24T09:00:00Z'));
  assert.deepEqual(utc.map(iso), ['2026-10-24T08:00:00.000Z']);
});

test('slots cross midnight and stay inside the window', () => {
  const now = at('2026-10-24T23:50:00Z');
  const slots = doseSlots('00:10,23:30', 0, now - HOUR, now + 30n * MIN);
  assert.deepEqual(slots.map(iso), ['2026-10-24T23:30:00.000Z', '2026-10-25T00:10:00.000Z']);
  assert.deepEqual(doseSlots('12:00', 0, now, now - 1n), []);
});

test('glucose rules flag lows and highs but ignore missing readings', () => {
  assert.deepEqual(glucoseRules(0), []);
  assert.deepEqual(glucoseRules(110), []);
  assert.deepEqual(glucoseRules(69), [{ code: 'HYPOGLYCEMIA', priority: 'same_day' }]);
  assert.deepEqual(glucoseRules(70), []);
  assert.deepEqual(glucoseRules(299), []);
  assert.deepEqual(glucoseRules(300), [{ code: 'HYPERGLYCEMIA', priority: 'same_day' }]);
});

test('only missed or skipped insulin raises a follow-up', () => {
  assert.deepEqual(doseRules('insulin_long', 'missed'), [{ code: 'MISSED_INSULIN', priority: 'review_24h' }]);
  assert.deepEqual(doseRules('insulin_rapid', 'skipped').length, 1);
  assert.deepEqual(doseRules('insulin_rapid', 'taken'), []);
  assert.deepEqual(doseRules('oral_diabetes', 'missed'), []);
});

test('presets carry valid schedules and require glucose checks for insulin', () => {
  for (const p of MED_PRESETS) {
    assert.equal(normalizeTimes(p.times), p.times, p.key);
    assert.ok(p.sideEffects.length > 0 && p.contraindications.length > 0, p.key);
    assert.equal(p.requiresGlucose, isInsulin(p.kind), p.key);
  }
});

test('patient medication details combine plain-language uses with prescribed safety information', () => {
  const med = {
    name: 'Metformin',
    sideEffects: 'Nausea\nDiarrhea',
    contraindications: 'Severe kidney impairment',
  };
  const entries = [
    {
      id: 1n,
      slug: 'metformin',
      name: 'Metformin',
      aliases: 'Glucophage',
      kind: 'medication',
      patientSummary: 'A pill that helps lower blood sugar.',
      sourceName: 'MedlinePlus',
      sourceUrl: 'https://medlineplus.gov/',
    },
  ];
  const sections = [
    { id: 1n, entryId: 1n, position: 0, heading: 'Used for', body: 'Type 2 diabetes', patient: true },
    { id: 2n, entryId: 1n, position: 1, heading: 'Common side effects', body: 'Upset stomach', patient: true },
    {
      id: 3n,
      entryId: 1n,
      position: 2,
      heading: 'Contraindications',
      body: 'Reference contraindication',
      patient: false,
    },
  ];

  const info = patientMedicationInfo(med, entries, sections);
  assert.equal(info.entry?.slug, 'metformin');
  assert.equal(info.patientSummary, 'A pill that helps lower blood sugar.');
  assert.deepEqual(info.uses, ['Type 2 diabetes']);
  assert.deepEqual(info.sideEffects, ['Nausea', 'Diarrhea']);
  assert.deepEqual(info.contraindications, ['Severe kidney impairment']);
});

test('patient medication details use curated fallbacks when medication safety fields are blank', () => {
  const med = { name: 'Glucophage', sideEffects: '', contraindications: '' };
  const entries = [
    {
      id: 2n,
      slug: 'metformin',
      name: 'Metformin',
      aliases: 'Glucophage',
      kind: 'medication',
      patientSummary: '',
      sourceName: '',
      sourceUrl: '',
    },
  ];
  const sections = [
    { id: 4n, entryId: 2n, position: 0, heading: 'Used for', body: 'Type 2 diabetes', patient: true },
    { id: 5n, entryId: 2n, position: 1, heading: 'Common side effects', body: 'Nausea\nDiarrhea', patient: true },
    {
      id: 6n,
      entryId: 2n,
      position: 2,
      heading: 'Contraindications',
      body: 'Severe kidney impairment',
      patient: false,
    },
  ];

  const info = patientMedicationInfo(med, entries, sections);
  assert.deepEqual(info.uses, ['Type 2 diabetes']);
  assert.deepEqual(info.sideEffects, ['Nausea', 'Diarrhea']);
  assert.deepEqual(info.contraindications, ['Severe kidney impairment']);
});
