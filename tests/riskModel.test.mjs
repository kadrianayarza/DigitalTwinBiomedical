import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as MODEL from '../spacetimedb/src/riskModelData.ts';
import { calibrate, explain, featureLabel, featuresAt, levelFor, scoreRisk } from '../spacetimedb/src/riskModel.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/riskModel.json', import.meta.url), 'utf8'));
const rowsOf = c => c.raw.map(r => r.map(v => (v === null ? NaN : v)));

test('features match the Python definitions', () => {
  assert.equal(MODEL.FEATURES.length, 89);
  for (const c of fixture.cases) {
    const rows = rowsOf(c);
    for (const [hour, expected] of Object.entries(c.features)) {
      const got = featuresAt(rows, Number(hour), c.age);
      assert.equal(got.length, expected.length);
      got.forEach((v, i) => {
        const e = expected[i];
        if (e === null) assert.ok(Number.isNaN(v), `${c.id} h${hour} ${MODEL.FEATURES[i]} should be missing, got ${v}`);
        else
          assert.ok(
            Math.abs(v - e) <= 1e-9 * Math.max(1, Math.abs(e)),
            `${c.id} h${hour} ${MODEL.FEATURES[i]}: ${v} vs ${e}`
          );
      });
    }
  }
});

test('probabilities match XGBoost on hospital B patients', () => {
  let worst = 0;
  for (const c of fixture.cases) {
    const rows = rowsOf(c);
    c.prob.forEach((expected, t) => {
      const { margin } = explain(MODEL, featuresAt(rows, t, c.age));
      worst = Math.max(worst, Math.abs(calibrate(MODEL, margin) - expected));
    });
  }
  assert.ok(worst < 2e-6, `largest probability difference ${worst}`);
});

test('driver effects add up to the margin', () => {
  const c = fixture.cases[1];
  const x = featuresAt(rowsOf(c), c.raw.length - 1, c.age);
  const { margin, effects } = explain(MODEL, x);
  const roots = MODEL.TREES.reduce((s, tree) => s + tree[5], 0);
  const total = MODEL.BASE_MARGIN + roots + effects.reduce((s, e) => s + e, 0);
  assert.ok(Math.abs(total - margin) < 1e-9);
});

test('levels, labels and drivers', () => {
  assert.equal(levelFor(MODEL, 0), 'low');
  assert.equal(levelFor(MODEL, MODEL.THRESHOLDS.elevated), 'elevated');
  assert.equal(levelFor(MODEL, MODEL.THRESHOLDS.high + 0.01), 'high');
  assert.equal(featureLabel('Resp_min24'), 'Breathing rate, 24 h low');
  assert.equal(featureLabel('Age'), 'Age');
  const c = fixture.cases[1];
  const r = scoreRisk(MODEL, rowsOf(c), c.age);
  assert.ok(r.drivers.length > 0 && r.drivers.length <= 4);
  for (let i = 1; i < r.drivers.length; i++) {
    assert.ok(Math.abs(r.drivers[i - 1].effect) >= Math.abs(r.drivers[i].effect));
  }
});
