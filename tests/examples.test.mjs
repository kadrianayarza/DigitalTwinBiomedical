import assert from 'node:assert/strict';
import test from 'node:test';
import { EXAMPLE_CHECK_INS } from '../spacetimedb/src/examples.ts';
import { symptomRules } from '../spacetimedb/src/clinical.ts';

const SIDES = {
  'Kadrian Ayarza': 'right',
  'Isak Smith': 'left',
  'Jesus Allejandro': 'right',
  'Tom Becker': 'left',
  'Mei Lin Wu': 'right',
  'Elena Novak': 'right',
};

const asEntry = ex => ({
  region: ex.region,
  severity: ex.severity,
  swelling: !!ex.swelling,
  warmth: !!ex.warmth,
  redness: !!ex.redness,
  shortnessOfBreath: false,
  chestPain: false,
  bodyTempC: ex.bodyTempC ?? 0,
});

test('every seeded patient has at least three example check-ins', () => {
  assert.deepEqual(Object.keys(EXAMPLE_CHECK_INS).sort(), Object.keys(SIDES).sort());
  for (const list of Object.values(EXAMPLE_CHECK_INS)) assert.ok(list.length >= 3);
});

test('example check-ins stay below every symptom rule, since seeding raises no alerts', () => {
  for (const [name, list] of Object.entries(EXAMPLE_CHECK_INS)) {
    const oldestFirst = [...list].sort((a, b) => b.minutesAgo - a.minutesAgo);
    oldestFirst.forEach((ex, i) => {
      const previous = i > 0 ? asEntry(oldestFirst[i - 1]) : undefined;
      assert.deepEqual(symptomRules(SIDES[name], asEntry(ex), previous), [], `${name} ${ex.region}`);
    });
  }
});

test('example check-ins use valid severities and points', () => {
  for (const ex of Object.values(EXAMPLE_CHECK_INS).flat()) {
    assert.ok(Number.isInteger(ex.severity) && ex.severity >= 0 && ex.severity <= 10);
    assert.ok(ex.point.every(Number.isFinite) && ex.point[1] >= 0 && ex.point[1] < 1.8);
    assert.ok(ex.minutesAgo > 0);
  }
});
