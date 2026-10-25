import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSESSMENT_LABEL,
  ASSESSMENT_NORMAL,
  ASSESSMENT_PROMPT,
  ASSESSMENT_SHORT,
  ASSESSMENT_STATUSES,
  ASSESSMENT_STATUS_LABEL,
  ASSESSMENT_SYSTEMS,
  assessmentLabel,
  isAssessmentStatus,
  isAssessmentSystem,
  latestBySystem,
  statusLabel,
  systemForRegion,
} from '../spacetimedb/src/assessment.ts';
import { DEMO_ASSESSMENTS } from '../spacetimedb/src/examples.ts';

test('the catalogue is a complete head-to-toe set', () => {
  assert.equal(ASSESSMENT_SYSTEMS.length, 9);
  for (const s of ASSESSMENT_SYSTEMS) {
    assert.ok(ASSESSMENT_LABEL[s] && ASSESSMENT_SHORT[s], s);
    assert.ok(ASSESSMENT_PROMPT[s].length > 10, s);
    assert.ok(ASSESSMENT_NORMAL[s].length > 10, s);
    assert.equal(assessmentLabel(s), ASSESSMENT_LABEL[s]);
  }
  for (const st of ASSESSMENT_STATUSES) {
    assert.ok(ASSESSMENT_STATUS_LABEL[st]);
    assert.equal(statusLabel(st), ASSESSMENT_STATUS_LABEL[st]);
  }
  // Unknown codes fall back to the raw code instead of rendering as undefined.
  assert.equal(assessmentLabel('bogus'), 'bogus');
  assert.equal(statusLabel('bogus'), 'bogus');
  assert.equal(isAssessmentSystem('neuro'), true);
  assert.equal(isAssessmentSystem('bogus'), false);
  assert.equal(isAssessmentStatus('deferred'), true);
  assert.equal(isAssessmentStatus('bogus'), false);
});

test('tapped twin regions open the right system', () => {
  assert.equal(systemForRegion('knee_r_anterior'), 'msk');
  assert.equal(systemForRegion('calf_l_posterior'), 'msk');
  assert.equal(systemForRegion('shoulder_r_anterior'), 'msk');
  assert.equal(systemForRegion('chest'), 'respiratory');
  assert.equal(systemForRegion('back'), 'msk');
  assert.equal(systemForRegion('abdomen'), 'gi');
  assert.equal(systemForRegion('hip'), 'gu');
  assert.equal(systemForRegion('head_anterior'), 'heent');
  assert.equal(systemForRegion('head_posterior'), 'neuro');
  assert.equal(systemForRegion('neck_posterior'), 'heent');
  assert.equal(systemForRegion('foot_l_anterior'), 'msk');
});

test('demo assessments only use known systems, statuses, and clean text', () => {
  assert.ok(Object.keys(DEMO_ASSESSMENTS).length >= 2);
  for (const [name, rows] of Object.entries(DEMO_ASSESSMENTS)) {
    assert.ok(name.length > 0);
    for (const a of rows) {
      assert.ok(isAssessmentSystem(a.system), `${name} ${a.system}`);
      assert.ok(isAssessmentStatus(a.status), `${name} ${a.status}`);
      assert.ok(a.findings.trim().length > 0 && a.findings.length <= 500, `${name} ${a.system}`);
      assert.ok(a.hoursAgo > 0, `${name} ${a.system}`);
      assert.ok((a.region ?? '').length <= 100, `${name} ${a.system}`);
    }
  }
  // Kadrian's seed is a complete pass, so the panel starts with 9 of 9.
  const seeded = new Set(DEMO_ASSESSMENTS['Kadrian Ayarza'].map(a => a.system));
  for (const s of ASSESSMENT_SYSTEMS) assert.ok(seeded.has(s), s);
  // Elena's seed is mid-round, so not-yet-assessed systems also demo well.
  assert.ok(DEMO_ASSESSMENTS['Elena Novak'].length < ASSESSMENT_SYSTEMS.length);
  assert.ok(DEMO_ASSESSMENTS['Elena Novak'].length >= 3);
});

test('latestBySystem keeps the newest row per system', () => {
  const rows = [
    { system: 'msk', status: 'normal', assessedAt: { microsSinceUnixEpoch: 100n } },
    { system: 'msk', status: 'abnormal', assessedAt: { microsSinceUnixEpoch: 300n } },
    { system: 'skin', status: 'abnormal', assessedAt: { microsSinceUnixEpoch: 200n } },
    { system: 'msk', status: 'deferred', assessedAt: { microsSinceUnixEpoch: 50n } },
  ];
  const latest = latestBySystem(rows);
  assert.equal(latest.size, 2);
  assert.equal(latest.get('msk').status, 'abnormal');
  assert.equal(latest.get('skin').status, 'abnormal');
  assert.deepEqual(latestBySystem([]).size, 0);
});
