import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_DEVICES, EXAMPLE_CHECK_INS } from '../spacetimedb/src/examples.ts';
import { symptomRules } from '../spacetimedb/src/clinical.ts';
import { LIBRARY, matchEntry } from '../spacetimedb/src/library.ts';

const SIDES = {
  'Kadrian Ayarza': 'right',
  'Isak Smith': 'left',
  'Jesus Allejandro': 'right',
  'Tom Becker': 'left',
  'Mei Lin Wu': 'right',
  'Elena Novak': 'right',
  'Maria Delgado': 'right',
  'Daniel Cho': 'right',
  'Priya Nair': 'right',
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

test('demo devices cover the roster and resolve against the device library', () => {
  // The roster keys match the check-in seeds, so every patient is addressable.
  assert.deepEqual(Object.keys(DEMO_DEVICES).sort(), Object.keys(SIDES).sort());
  // matchEntry expects the stored row shape: aliases joined into one string.
  const devices = LIBRARY.filter(e => e.kind === 'device').map(e => ({ ...e, aliases: e.aliases.join(',') }));
  for (const [name, list] of Object.entries(DEMO_DEVICES)) {
    for (const [device, detail, since] of list) {
      assert.ok(device.trim() && detail.trim().length <= 500 && since.trim().length <= 100, name);
      // Seeding mirrors the reducer: a name match wins, otherwise the general entry.
      const slug = matchEntry(devices, device, 'device')?.slug ?? 'assistive-device';
      assert.ok(LIBRARY.some(e => e.slug === slug), `${device} resolves to ${slug}`);
    }
  }
  // The wheelchair device is what seats the twin, so the seeded chair must resolve to it.
  assert.equal(matchEntry(devices, DEMO_DEVICES['Elena Novak'][0][0], 'device')?.slug, 'wheelchair');
});
