import assert from 'node:assert/strict';
import test from 'node:test';
import { SCENARIOS, simulateVitals, vitalRules } from '../spacetimedb/src/clinical.ts';

const steady = () => 0;
const run = (scenario, ticks = 60) =>
  Array.from({ length: ticks }, (_, i) => simulateVitals(scenario, i + 1, steady));
const codes = window => vitalRules(window).map(h => h.code).sort();

test('a stable patient stays inside normal adult ranges and raises no alerts', () => {
  const window = run('normal');
  for (const v of window) {
    assert.ok(v.hr >= 60 && v.hr <= 100);
    assert.ok(v.systolic >= 90 && v.systolic < 140);
    assert.ok(v.diastolic >= 60 && v.diastolic < 90);
    assert.ok(v.respRate >= 12 && v.respRate <= 20);
    assert.ok(v.spo2 >= 95 && v.spo2 <= 100);
    assert.ok(v.tempC >= 36.1 && v.tempC < 37.5);
  }
  assert.deepEqual(codes(window), []);
});

test('each demo scenario trips the rules it is meant to show', () => {
  assert.deepEqual(codes(run('dvt')), ['TACHYCARDIA', 'TACHYPNEA']);
  assert.deepEqual(codes(run('infection')), ['FEVER']);
  assert.deepEqual(codes(run('fluid')), ['TACHYPNEA']);
});

test('unknown or legacy scenarios fall back to stable vitals', () => {
  assert.deepEqual(codes(run('stalled')), []);
  assert.ok(!SCENARIOS.includes('stalled'));
});

test('rules cover the standard vital-sign limits', () => {
  const base = { hr: 75, systolic: 120, diastolic: 80, respRate: 15, spo2: 97, tempC: 36.8 };
  const five = v => Array.from({ length: 5 }, () => ({ ...base, ...v }));
  assert.deepEqual(codes(five({ spo2: 90 })), ['LOW_SPO2']);
  assert.equal(vitalRules(five({ spo2: 90 }))[0].priority, 'emergency');
  assert.deepEqual(codes(five({ systolic: 85 })), ['HYPOTENSION']);
  assert.deepEqual(codes(five({ systolic: 185 })), ['HYPERTENSION']);
  assert.deepEqual(codes(five({ tempC: 38.2 })), ['FEVER']);
  assert.deepEqual(codes(five({ spo2: 90 }).slice(1)), [], 'fewer than five samples never alert');
});
