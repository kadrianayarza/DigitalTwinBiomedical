import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CRISIS_LINES,
  GAD7_QUESTIONS,
  MH_CRISIS_CODES,
  MH_KIND_LABEL,
  MH_KINDS,
  MH_MAX_SCORE,
  MH_OPTIONS,
  MOOD_SCALE,
  PHQ9_QUESTIONS,
  gad7Band,
  isCrisisNote,
  isElevatedWithLittleSleep,
  isMhKind,
  mhBand,
  mhRules,
  phq9Band,
} from '../spacetimedb/src/mentalHealth.ts';
import { DEMO_MENTAL_HEALTH, EXAMPLE_CHECK_INS } from '../spacetimedb/src/examples.ts';
import { REASON_LABEL } from '../spacetimedb/src/clinical.ts';

const entry = (kind, score, extra = {}) => ({
  kind,
  score,
  item9: 0,
  sleepHours: 0,
  notes: '',
  ...extra,
});

test('the instruments are the standard PHQ-9 and GAD-7', () => {
  assert.equal(PHQ9_QUESTIONS.length, 9);
  assert.equal(GAD7_QUESTIONS.length, 7);
  assert.equal(MH_OPTIONS.length, 4);
  assert.equal(MH_MAX_SCORE.phq9, 27);
  assert.equal(MH_MAX_SCORE.gad7, 21);
  assert.equal(MH_MAX_SCORE.mood, 3);
  // Item 9 asks about self-harm; it must be present and last.
  assert.match(PHQ9_QUESTIONS[8], /better off dead|hurting yourself/);
  // Every kind is labeled so no row can render as undefined.
  for (const k of MH_KINDS) assert.ok(MH_KIND_LABEL[k]);
  assert.equal(isMhKind('phq9'), true);
  assert.equal(isMhKind('bogus'), false);
});

test('severity bands follow the published cutoffs', () => {
  assert.equal(phq9Band(4), 'minimal');
  assert.equal(phq9Band(5), 'mild');
  assert.equal(phq9Band(10), 'moderate');
  assert.equal(phq9Band(15), 'mod_severe');
  assert.equal(phq9Band(20), 'severe');
  assert.equal(gad7Band(4), 'minimal');
  assert.equal(gad7Band(5), 'mild');
  assert.equal(gad7Band(10), 'moderate');
  assert.equal(gad7Band(15), 'severe');
  assert.equal(mhBand('phq9', 16), 'mod_severe');
  assert.equal(mhBand('gad7', 16), 'severe');
  assert.equal(mhBand('mood', 3), '');
});

test('a positive PHQ-9 item 9 is always an emergency', () => {
  assert.deepEqual(mhRules(entry('phq9', 10, { item9: 1 })), [
    { code: 'SELF_HARM_RISK', priority: 'emergency' },
  ]);
  assert.deepEqual(mhRules(entry('phq9', 21, { item9: 2 })), [
    { code: 'SELF_HARM_RISK', priority: 'emergency' },
    { code: 'SEVERE_DEPRESSION', priority: 'same_day' },
  ]);
  // Item 9 negative and below the severe cutoff: no alert.
  assert.deepEqual(mhRules(entry('phq9', 14, { item9: 0 })), []);
});

test('severe anxiety and deep low mood flag same-day review', () => {
  assert.deepEqual(mhRules(entry('gad7', 15)), [{ code: 'SEVERE_ANXIETY', priority: 'same_day' }]);
  assert.deepEqual(mhRules(entry('gad7', 14)), []);
  assert.deepEqual(mhRules(entry('mood', -3)), [{ code: 'SEVERE_LOW_MOOD', priority: 'same_day' }]);
  assert.deepEqual(mhRules(entry('mood', -2)), []);
});

test('high mood with little sleep flags possible activation', () => {
  assert.equal(isElevatedWithLittleSleep(2, 4), true);
  assert.equal(isElevatedWithLittleSleep(3, 3.5), true);
  assert.equal(isElevatedWithLittleSleep(1, 4), false);
  assert.equal(isElevatedWithLittleSleep(2, 6), false);
  assert.equal(isElevatedWithLittleSleep(2, 0), false);
  assert.deepEqual(mhRules(entry('mood', 2, { sleepHours: 4 })), [
    { code: 'MOOD_ELEVATION', priority: 'same_day' },
  ]);
  // One energetic day is not a pattern.
  assert.deepEqual(mhRules(entry('mood', 2, { sleepHours: 5 })), []);
  // Three high days in a row on five hours or less is.
  assert.deepEqual(
    mhRules(entry('mood', 2, { sleepHours: 4.5 }), [
      { score: 2, sleepHours: 5 },
      { score: 3, sleepHours: 5 },
    ]),
    [{ code: 'MOOD_ELEVATION', priority: 'same_day' }]
  );
  // Two high days plus one even day is not: the streak needs all three days high.
  // The new day sits at 4.5 h so only the streak rule (not the single-day rule) can fire.
  assert.deepEqual(
    mhRules(entry('mood', 2, { sleepHours: 4.5 }), [
      { score: 2, sleepHours: 5 },
      { score: 0, sleepHours: 5 },
    ]),
    []
  );
});

test('crisis wording is caught, everyday wording is not', () => {
  assert.equal(isCrisisNote('I want to kill myself'), true);
  assert.equal(isCrisisNote('I have been thinking about suicide a lot'), true);
  assert.equal(isCrisisNote('better off dead'), true);
  assert.equal(isCrisisNote('I might hurt myself'), true);
  // Narrow by design: pain complaints must not fire the crisis path.
  assert.equal(isCrisisNote('this headache is killing me'), false);
  assert.equal(isCrisisNote('killing it at work today'), false);
  assert.equal(isCrisisNote('tired and run down all week'), false);
  assert.equal(isCrisisNote(''), false);
  // Crisis wording on any instrument is an emergency, even with a quiet score.
  assert.deepEqual(mhRules(entry('gad7', 8, { notes: 'I wish I was dead' })), [
    { code: 'CRISIS_LANGUAGE', priority: 'emergency' },
  ]);
});

test('every new reason code has a label the UI can render', () => {
  for (const code of [
    'SELF_HARM_RISK',
    'CRISIS_LANGUAGE',
    'SEVERE_DEPRESSION',
    'SEVERE_ANXIETY',
    'MOOD_ELEVATION',
    'SEVERE_LOW_MOOD',
  ]) {
    assert.ok(REASON_LABEL[code], code);
  }
  // The crisis codes are the ones that push crisis lines to the patient.
  assert.deepEqual(MH_CRISIS_CODES, ['SELF_HARM_RISK', 'CRISIS_LANGUAGE']);
  assert.ok(CRISIS_LINES.length >= 3);
  assert.ok(CRISIS_LINES.some(l => l.detail.includes('988')));
});

test('the three demo patients replay to their intended alerts', () => {
  for (const [name, demo] of Object.entries(DEMO_MENTAL_HEALTH)) {
    assert.ok(EXAMPLE_CHECK_INS[name], `${name} has physical check-ins`);
    assert.ok(demo.meds.length > 0, `${name} has chart meds`);
    for (const e of demo.entries) {
      assert.ok(isMhKind(e.kind), `${name} ${e.kind}`);
      assert.ok(e.score >= -3 && e.score <= MH_MAX_SCORE[e.kind], `${name} score ${e.score}`);
      if (e.kind === 'mood') assert.ok(e.sleepHours === undefined || (e.sleepHours > 0 && e.sleepHours <= 24));
      else assert.ok((e.item9 ?? 0) <= 3);
    }
  }

  // Oldest first, the way the seeder inserts them.
  const replay = name => {
    const hits = [];
    const moodTrail = [];
    const entries = [...DEMO_MENTAL_HEALTH[name].entries].sort((a, b) => b.hoursAgo - a.hoursAgo);
    for (const e of entries) {
      const row = entry(e.kind, e.score, {
        item9: e.item9 ?? 0,
        sleepHours: e.sleepHours ?? 0,
        notes: e.notes ?? '',
      });
      hits.push(...mhRules(row, moodTrail));
      if (e.kind === 'mood') moodTrail.push({ score: e.score, sleepHours: e.sleepHours ?? 0 });
    }
    return hits;
  };

  // Maria: the climb ends in high mood on four hours of sleep.
  assert.ok(replay('Maria Delgado').some(h => h.code === 'MOOD_ELEVATION'));
  assert.equal(replay('Maria Delgado').some(h => h.priority === 'emergency'), false);

  // Daniel: item 9 positive on the latest PHQ-9 fires the crisis path.
  const daniel = replay('Daniel Cho');
  assert.ok(daniel.some(h => h.code === 'SELF_HARM_RISK' && h.priority === 'emergency'));
  assert.ok(daniel.some(h => h.code === 'SEVERE_DEPRESSION'));
  assert.equal(daniel.some(h => h.priority === 'emergency' && h.code === 'CRISIS_LANGUAGE'), false);

  // Priya: moderate anxiety, nothing urgent.
  assert.deepEqual(replay('Priya Nair'), []);
});

test('the mood scale covers the full range the rules reference', () => {
  assert.deepEqual(MOOD_SCALE.map(m => m.value), [-3, -2, -1, 0, 1, 2, 3]);
  for (const m of MOOD_SCALE) assert.ok(m.label.length > 0);
});
