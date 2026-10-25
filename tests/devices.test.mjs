import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceProp } from '../src/lib/deviceProp.ts';
import { DEMO_DEVICES } from '../spacetimedb/src/examples.ts';
import { LIBRARY, matchEntry } from '../spacetimedb/src/library.ts';

// matchEntry expects the stored row shape: aliases as one comma-joined string.
const deviceEntries = LIBRARY.filter(e => e.kind === 'device').map(e => ({
  slug: e.slug,
  name: e.name,
  aliases: e.aliases.join(','),
  kind: e.kind,
}));

test('every library device draws a prop (dentures are list-only)', () => {
  const deviceSlugs = deviceEntries.map(e => e.slug);
  assert.ok(deviceSlugs.length >= 12, `expected the curated device set, got ${deviceSlugs.length}`);
  for (const slug of deviceSlugs) {
    const prop = deviceProp(slug);
    if (slug === 'dentures') {
      // Dentures live in a drawer, not on the body: list-only by design.
      assert.equal(prop.kind, 'none');
      continue;
    }
    assert.notEqual(prop.kind, 'none', `${slug} should draw on the twin`);
    assert.ok(prop.anchor[1] > 0, `${slug} label anchor should float above the ground`);
  }
});

test('body-anchored props are wearables; freestanding props are not', () => {
  const wearables = ['eyeglasses', 'hearing-aids', 'compression-stockings', 'medical-alert'];
  for (const slug of wearables) assert.equal(deviceProp(slug).wearable, true, slug);
  for (const slug of ['walker', 'wheelchair', 'home-oxygen', 'cpap', 'cane', 'crutches']) {
    assert.equal(deviceProp(slug).wearable, false, slug);
  }
});

test('unknown devices fall back to a case prop; a walking boot wraps the foot', () => {
  assert.equal(deviceProp('made-up-thing').kind, 'equipment-case');
  assert.equal(deviceProp('assistive-device').kind, 'equipment-case');
  const boot = deviceProp('assistive-device', 'Walking boot');
  assert.equal(boot.kind, 'walking-boot');
  assert.equal(boot.wearable, true);
  assert.equal(deviceProp('assistive-device', 'Nebulizer').kind, 'equipment-case');
});

test('every demo device resolves to a library slug and a renderable prop', () => {
  const expected = {
    'Kadrian Ayarza': [
      ['Front-wheeled walker', 'walker'],
      ['Raised toilet seat', 'bathroom-safety'],
    ],
    // No specific entry: the save reducer falls back to the general assistive-device slug.
    'Tom Becker': [['Walking boot', undefined]],
    'Mei Lin Wu': [['Home oxygen', 'home-oxygen']],
    'Jesus Allejandro': [
      ['Compression stockings', 'compression-stockings'],
      ['Medical alert button', 'medical-alert'],
    ],
    'Elena Novak': [
      ['Wheelchair', 'wheelchair'],
      ['Reacher', 'daily-living-aids'],
    ],
  };
  for (const [name, rows] of Object.entries(DEMO_DEVICES)) {
    assert.deepEqual(
      rows.map(r => r[0]),
      (expected[name] ?? []).map(r => r[0]),
      `${name} demo devices should stay in sync`
    );
    for (const [deviceName, slug] of expected[name] ?? []) {
      const matched = matchEntry(deviceEntries, deviceName, 'device');
      assert.equal(matched?.slug, slug, deviceName);
      // The row stores the fallback slug when nothing specific matches.
      const rowSlug = matched?.slug ?? 'assistive-device';
      const prop = deviceProp(rowSlug, deviceName);
      assert.notEqual(prop.kind, 'none', `${deviceName} should draw on the twin`);
    }
  }
  // Isak's empty chart is a demo state too.
  assert.deepEqual(DEMO_DEVICES['Isak Smith'], []);
});
