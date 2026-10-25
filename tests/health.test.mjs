import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_HEALTH,
  DEVICE_KINDS,
  METRIC,
  healthDigest,
  healthRules,
  pairedDeviceHistory,
} from '../spacetimedb/src/health.ts';
import { EXAMPLE_CHECK_INS } from '../spacetimedb/src/examples.ts';

const NOW = 1_800_000_000_000_000; // micros
const MIN = 60_000_000;
const DAY = 1440 * MIN;

/** Deterministic stand-in for ctx.random(). */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const points = samples => samples.map(s => ({ metric: s.metric, value: s.value, label: s.label, at: NOW - s.minutesAgo * MIN }));
const codes = (pts, now = NOW) => healthRules(pts, now).map(h => h.code).sort();

test('every seeded patient has a wearable profile', () => {
  assert.deepEqual(Object.keys(DEMO_HEALTH).sort(), Object.keys(EXAMPLE_CHECK_INS).sort());
});

test('demo histories only use catalog metrics, inside their valid ranges', () => {
  for (const [name, profile] of Object.entries(DEMO_HEALTH)) {
    const samples = profile.history(seeded());
    assert.ok(samples.length > 300, `${name} has a month of data`);
    for (const s of samples) {
      const m = METRIC[s.metric];
      assert.ok(m, `${name}: unknown metric ${s.metric}`);
      assert.ok(s.value >= m.min && s.value <= m.max, `${name}: ${s.metric}=${s.value} out of range`);
      assert.ok(s.minutesAgo >= 0, `${name}: ${s.metric} is in the future`);
    }
    for (const d of profile.devices) assert.ok(DEVICE_KINDS[d.kind], `${name}: unknown device ${d.kind}`);
  }
});

test('seeded histories start without wearable alerts', () => {
  for (const [name, profile] of Object.entries(DEMO_HEALTH)) {
    for (const seed of [1, 7, 42, 99]) {
      assert.deepEqual(codes(points(profile.history(seeded(seed)))), [], `${name} (seed ${seed})`);
    }
  }
});

test("logging a heavier weight for the heart failure patient raises the weight-gain alert", () => {
  const history = points(DEMO_HEALTH['Jesus Allejandro'].history(seeded()));
  const withToday = [...history, { metric: 'weight', value: 95.0, label: '', at: NOW }];
  assert.deepEqual(codes(withToday), ['WEIGHT_GAIN']);
});

test('weight rule: 0.9 kg in a day or 2.3 kg in a week, stale readings ignored', () => {
  const w = (daysAgo, value) => ({ metric: 'weight', value, label: '', at: NOW - daysAgo * DAY });
  assert.deepEqual(codes([w(1, 80), w(0, 80.9)]), ['WEIGHT_GAIN']);
  assert.deepEqual(codes([w(1, 80), w(0, 80.5)]), []);
  assert.deepEqual(codes([w(6, 80), w(3, 81), w(1, 81.9), w(0, 82.4)]), ['WEIGHT_GAIN']);
  assert.deepEqual(codes([w(4, 80), w(3, 82.5)]), [], 'readings older than two days do not alert');
});

test('resting heart rate rise, low watch SpO2, irregular rhythm and glucose rules', () => {
  const rhr = [9, 8, 7, 6, 5, 4, 3, 2, 1].map(d => ({ metric: 'resting_heart_rate', value: 62, label: '', at: NOW - d * DAY }));
  assert.deepEqual(codes([...rhr, { metric: 'resting_heart_rate', value: 73, label: '', at: NOW }]), ['RESTING_HR_RISE']);
  assert.deepEqual(codes([...rhr, { metric: 'resting_heart_rate', value: 68, label: '', at: NOW }]), []);
  assert.deepEqual(codes([{ metric: 'blood_oxygen', value: 88, label: '', at: NOW - 60 * MIN }]), ['WEARABLE_LOW_SPO2']);
  assert.deepEqual(codes([{ metric: 'irregular_rhythm', value: 1, label: '', at: NOW - 3 * 60 * MIN }]), ['IRREGULAR_RHYTHM']);
  assert.deepEqual(codes([{ metric: 'irregular_rhythm', value: 1, label: '', at: NOW - 3 * DAY }]), []);
  assert.deepEqual(codes([{ metric: 'blood_glucose', value: 320, label: '', at: NOW }]), ['GLUCOSE_OUT_OF_RANGE']);
  assert.deepEqual(codes([{ metric: 'blood_glucose', value: 62, label: '', at: NOW }]), ['GLUCOSE_OUT_OF_RANGE']);
});

test('a paired demo device only reports what it can measure', () => {
  for (const kind of Object.keys(DEVICE_KINDS)) {
    const samples = pairedDeviceHistory(kind, 'Test', seeded());
    assert.ok(samples.length > 0, kind);
    for (const s of samples) assert.ok(DEVICE_KINDS[kind].metrics.includes(s.metric), `${kind} emitted ${s.metric}`);
  }
});

test('the triage digest lists a week of daily values and missed doses', () => {
  const digest = healthDigest(points(DEMO_HEALTH['Jesus Allejandro'].history(seeded())), NOW);
  assert.equal(digest.daily.weight_kg.length, 7);
  assert.ok(digest.daily.weight_kg.at(-1) > digest.daily.weight_kg[0]);
  assert.ok(digest.medication_doses_missed.includes('Furosemide 40 mg'));
});
