import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VOICE_TARGET_FOR,
  VOICE_TOOL,
  confirmQuestion,
  matchKnownName,
  normalizeCandidate,
  normalizeCandidates,
  normalizeRegion,
  parseVoiceLocally,
  replyVoiceLocally,
  spokenTemperature,
} from '../spacetimedb/src/voice.ts';

const CTX = {
  side: 'right',
  medications: ['Insulin glargine (basal)', 'Insulin lispro (mealtime)', 'Metformin'],
  labs: ['Blood glucose', 'Potassium', 'Creatinine', 'White blood cell count (WBC)'],
};

const kinds = list => list.map(i => i.kind);
const byKind = (list, kind) => list.find(i => i.kind === kind);

test('every kind maps to the app section that will show it', () => {
  for (const [kind, target] of Object.entries(VOICE_TARGET_FOR)) {
    assert.equal(typeof target, 'string', `${kind} needs a target`);
    assert.ok(target.length > 0);
  }
});

test('normalizes spoken regions, rejecting parts the twin cannot show', () => {
  assert.equal(normalizeRegion('knee_r_anterior', 'left'), 'knee_r_anterior');
  assert.equal(normalizeRegion('calf', 'right'), 'calf_r_anterior');
  assert.equal(normalizeRegion('calf_l_posterior', 'right'), 'calf_l_posterior');
  assert.equal(normalizeRegion('chest', 'right'), 'chest');
  assert.equal(normalizeRegion('back_anterior', 'right'), 'back_anterior');
  assert.equal(normalizeRegion('spleen', 'right'), undefined);
  assert.equal(normalizeRegion('', 'right'), undefined);
  assert.equal(normalizeRegion(undefined, 'right'), undefined);
});

test('converts spoken Fahrenheit temperatures and keeps Celsius as-is', () => {
  assert.equal(spokenTemperature('my temperature is 101'), 38.3);
  assert.equal(spokenTemperature('fever of 100.4'), 38);
  assert.equal(spokenTemperature('temp 38.5'), 38.5);
  assert.equal(spokenTemperature('no temperature mentioned'), undefined);
});

test('resolves a spoken short name to the full medication name', () => {
  assert.equal(matchKnownName('lispro', CTX.medications), 'Insulin lispro (mealtime)');
  assert.equal(matchKnownName('Metformin', CTX.medications), 'Metformin');
  assert.equal(matchKnownName('metfornin', CTX.medications), undefined);
});

test('accepts a well-formed model item and drops an unusable one', () => {
  const good = normalizeCandidate(
    {
      kind: 'vitals',
      label: 'BP 148/92',
      confidence: 'high',
      fields: { systolic: 148, diastolic: 92 },
    },
    CTX
  );
  assert.deepEqual(good, {
    kind: 'vitals',
    label: 'BP 148/92',
    target: 'vitals',
    confidence: 'high',
    detail: { systolic: 148, diastolic: 92 },
  });

  assert.equal(normalizeCandidate({ kind: 'vitals', label: 'nothing', fields: {} }, CTX), null);
  assert.equal(normalizeCandidate({ kind: 'weather', label: 'rain', fields: {} }, CTX), null);
  assert.equal(normalizeCandidate({ kind: 'vitals', label: '', fields: { hr: 80 } }, CTX), null);
  assert.equal(normalizeCandidate(null, CTX), null);
  assert.equal(normalizeCandidate('text', CTX), null);
});

test('rejects out-of-range vitals instead of storing them', () => {
  assert.equal(normalizeCandidate({ kind: 'vitals', label: 'x', fields: { hr: 900 } }, CTX), null);
  assert.equal(normalizeCandidate({ kind: 'vitals', label: 'x', fields: { spo2: 140 } }, CTX), null);
  // Diastolic above systolic is not a reading we can store.
  assert.equal(
    normalizeCandidate({ kind: 'vitals', label: 'x', fields: { systolic: 80, diastolic: 120 } }, CTX),
    null
  );
});

test('caps the number of proposals and removes duplicates', () => {
  const item = { kind: 'vitals', label: 'HR 80', confidence: 'high', fields: { hr: 80 } };
  const many = Array.from({ length: 30 }, () => item);
  const out = normalizeCandidates({ items: many }, CTX);
  assert.equal(out.length, 1);

  const distinct = normalizeCandidates(
    { items: [item, { ...item, fields: { hr: 81 }, label: 'HR 81' }] },
    CTX
  );
  assert.equal(distinct.length, 2);
  assert.equal(normalizeCandidates('nope', CTX).length, 0);
});

test('falls back to a symptom, vitals, and dose from one spoken sentence', () => {
  const out = parseVoiceLocally(
    'My right knee is really sore, about a 6 out of 10, and my heart rate is 96',
    CTX
  );
  const symptom = byKind(out, 'symptom');
  assert.equal(symptom.detail.region, 'knee_r_anterior');
  assert.equal(symptom.detail.severity, 6);
  assert.equal(symptom.confidence, 'high');
  const vitals = byKind(out, 'vitals');
  assert.equal(vitals.detail.hr, 96);
});

test('fallback reads a skipped insulin dose with a blood sugar reading', () => {
  const out = parseVoiceLocally('I skipped my lispro and my sugar was 190', CTX);
  const dose = byKind(out, 'dose');
  assert.equal(dose.detail.medicationName, 'Insulin lispro (mealtime)');
  assert.equal(dose.detail.status, 'skipped');
  assert.equal(dose.detail.glucoseMgDl, 190);
  // Glucose is reported once, as a vital sign, not twice.
  assert.equal(out.filter(i => i.kind === 'lab').length, 0);
});

test('fallback flags emergency wording from the speaker', () => {
  const out = parseVoiceLocally('I have chest pain and I am short of breath', CTX);
  const symptom = byKind(out, 'symptom');
  assert.equal(symptom.detail.chestPain, true);
  assert.equal(symptom.detail.shortnessOfBreath, true);
  assert.equal(symptom.target, 'check-ins');
});

test('fallback keeps the surgical side when the speaker does not say which leg', () => {
  const out = parseVoiceLocally('my calf is swollen and warm', CTX);
  const symptom = byKind(out, 'symptom');
  assert.equal(symptom.detail.region, 'calf_r_anterior');
  assert.equal(symptom.detail.swelling, true);
  assert.equal(symptom.detail.warmth, true);
});

test('fallback reads a nurse lab value and a history statement', () => {
  const out = parseVoiceLocally(
    'Potassium was 3.1 today and she was diagnosed with type 2 diabetes in 2019',
    CTX
  );
  const lab = byKind(out, 'lab');
  assert.equal(lab.detail.name, 'Potassium');
  assert.equal(lab.detail.value, 3.1);
  assert.equal(lab.target, 'labs');
  const history = byKind(out, 'history');
  assert.equal(history.detail.category, 'medical');
  assert.equal(history.detail.whenText, '2019');
  assert.equal(history.target, 'history');
});

test('fallback categorizes an allergy statement', () => {
  const out = parseVoiceLocally('I am allergic to penicillin', CTX);
  const history = byKind(out, 'history');
  assert.equal(history.detail.category, 'allergy');
});

test('fallback returns nothing for a sentence with no recordable fact', () => {
  assert.deepEqual(parseVoiceLocally('good morning, how are you today', CTX), []);
  assert.deepEqual(parseVoiceLocally('', CTX), []);
});

test('fallback only proposes kinds it can actually fill', () => {
  const out = parseVoiceLocally('my blood pressure was 132 over 84 and I took my metformin', CTX);
  assert.deepEqual(kinds(out).sort(), ['dose', 'vitals']);
  const vitals = byKind(out, 'vitals');
  assert.equal(vitals.detail.systolic, 132);
  assert.equal(vitals.detail.diastolic, 84);
  assert.equal(byKind(out, 'dose').detail.status, 'taken');
});

test('a severity of six out of ten is not mistaken for a blood pressure', () => {
  const out = parseVoiceLocally('the pain in my knee is 6/10', CTX);
  assert.equal(byKind(out, 'vitals'), undefined);
  assert.equal(byKind(out, 'symptom').detail.severity, 6);
});

test('fallback quotes only the diet clause, not the whole sentence', () => {
  const out = parseVoiceLocally(
    'my knee is sore, I ate chicken soup for lunch, and I slept about 7 hours',
    CTX
  );
  const diet = byKind(out, 'diet');
  assert.equal(/chicken soup/i.test(diet.detail.summary), true);
  assert.equal(/knee|slept/i.test(diet.detail.summary), false);
  assert.equal(diet.detail.whenText, 'lunch');
  assert.equal(diet.target, 'diet');

  const sleep = byKind(out, 'sleep');
  assert.equal(/slept/i.test(sleep.detail.summary), true);
  assert.equal(/knee|soup/i.test(sleep.detail.summary), false);
  assert.equal(sleep.detail.hours, 7);
  assert.equal(sleep.target, 'sleep');
});

test('fallback reads fluid intake into the diet section', () => {
  const out = parseVoiceLocally('I drank 2 glasses of water this afternoon', CTX);
  const diet = byKind(out, 'diet');
  assert.equal(diet.detail.amount, '2 glasses');
  assert.equal(diet.detail.whenText, 'afternoon');
});

test('fallback records a sleep complaint without a stated duration', () => {
  const out = parseVoiceLocally('I had trouble sleeping last night', CTX);
  const sleep = byKind(out, 'sleep');
  assert.equal(sleep.detail.hours, undefined);
  assert.equal(sleep.detail.summary.length > 0, true);
});

test('fallback keeps a history title to its own clause', () => {
  const out = parseVoiceLocally('I was diagnosed with asthma in 2010 and I live with my sister', CTX);
  const history = byKind(out, 'history');
  assert.equal(/asthma/i.test(history.detail.title), true);
  assert.equal(history.detail.whenText, '2010');
});

test('a meal is never mistaken for medical history', () => {
  // "I had a salad" used to trigger the history branch and propose a chart entry.
  const out = parseVoiceLocally('I had a salad with chicken for dinner', CTX);
  assert.equal(byKind(out, 'history'), undefined);
  assert.equal(byKind(out, 'diet').detail.whenText, 'dinner');
  assert.equal(parseVoiceLocally('I had a bad night', CTX).some(i => i.kind === 'history'), false);
});

test('history still triggers on clinical wording', () => {
  for (const line of [
    'I was diagnosed with asthma in 2015',
    'I had a heart attack two years ago',
    'she is allergic to penicillin',
  ]) {
    assert.equal(byKind(parseVoiceLocally(line, CTX), 'history') !== undefined, true, `missed: ${line}`);
  }
});

test('fallback reads two different lab values from one sentence', () => {
  const labs = { ...CTX, labs: ['Hemoglobin', 'Complete blood count (CBC)'] };
  const out = parseVoiceLocally('hemoglobin is 11.2 and white count is 6.8', labs);
  const results = out.filter(i => i.kind === 'lab');
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map(i => i.detail.value).sort((a, b) => a - b),
    [6.8, 11.2]
  );
});

test('two lab names cannot claim the same spoken number', () => {
  const labs = {
    ...CTX,
    labs: ['Complete blood count (CBC)', 'White blood cell count (WBC)', 'Hemoglobin'],
  };
  const out = parseVoiceLocally('white count is 6.8', labs);
  const results = out.filter(i => i.kind === 'lab');
  assert.equal(results.length, 1);
  assert.equal(results[0].detail.value, 6.8);
});

test('a glucose-style lab stays a vital and is not double-counted as a lab', () => {
  const out = parseVoiceLocally('my blood sugar is 145', CTX);
  assert.equal(byKind(out, 'lab'), undefined);
  assert.equal(byKind(out, 'vitals').detail.glucoseMgDl, 145);
});
// --- spoken confirmation questions ------------------------------------------

test('asks a plain confirmation question before saving a dose', () => {
  assert.equal(
    confirmQuestion('dose', { medicationName: 'Metformin', status: 'taken' }),
    'Do you want me to record that you took Metformin?'
  );
  assert.equal(
    confirmQuestion('dose', { medicationName: 'Metformin', status: 'skipped' }),
    'Do you want me to record that you skipped Metformin?'
  );
});

test('asks about the symptom in spoken words', () => {
  assert.equal(
    confirmQuestion('symptom', { region: 'knee_r_anterior', severity: 6 }),
    'Do you want me to record that your right knee hurts, 6 out of 10?'
  );
  assert.equal(
    confirmQuestion('symptom', { chestPain: true }),
    'Do you want me to record that you have chest pain?'
  );
  const withBreath = confirmQuestion('symptom', { region: 'chest', shortnessOfBreath: true, severity: 4 });
  assert.equal(
    withBreath,
    'Do you want me to record that your chest hurts, 4 out of 10, you are short of breath?'
  );
});

test('reads vitals, labs, and history back in the question', () => {
  assert.equal(
    confirmQuestion('vitals', { systolic: 148, diastolic: 92, hr: 96 }),
    'Do you want me to record these readings: blood pressure 148 over 92, heart rate 96?'
  );
  assert.equal(
    confirmQuestion('lab', { name: 'Hemoglobin', value: 11.2, unit: 'g/dL' }),
    'Do you want me to record Hemoglobin of 11.2 g/dL in your chart?'
  );
  assert.equal(
    confirmQuestion('history', { title: 'Asthma, diagnosed 2010' }),
    'Do you want me to add "Asthma, diagnosed 2010" to your health history?'
  );
});

test('re-voices a first-person diet or sleep note as second person', () => {
  assert.equal(
    confirmQuestion('diet', { summary: 'I ate chicken soup for lunch' }),
    'Do you want me to record that you ate chicken soup for lunch?'
  );
  assert.equal(
    confirmQuestion('sleep', { summary: 'I slept about 7 hours', hours: 7 }),
    'Do you want me to record that you slept about 7 hours?'
  );
});

// --- spoken answers to questions ---------------------------------------------

const RICH = {
  ...CTX,
  medFacts: [
    {
      name: 'Metformin',
      instructions: 'Take one tablet with your evening meal.',
      sideEffects: ['nausea', 'upset stomach'],
    },
    {
      name: 'Insulin lispro (mealtime)',
      instructions: 'Inject 15 minutes before meals.',
      sideEffects: [],
    },
  ],
  alerts: [{ priority: 'same_day', reasons: ['Temperature 38.0 °C or higher'] }],
};

test('answers a greeting with nothing to save', () => {
  assert.deepEqual(parseVoiceLocally('hello', RICH), []);
  assert.match(replyVoiceLocally('hello', RICH), /sort it into/i);
});

test('answers a side-effects question from the medicine card', () => {
  assert.match(replyVoiceLocally('what are the side effects of metformin', RICH), /nausea, upset stomach/);
});

test('answers what a medicine is for from its instructions', () => {
  const reply = replyVoiceLocally('why am I taking metformin', RICH);
  assert.match(reply, /Metformin: Take one tablet with your evening meal/);
});

test('walks through the whole medicine list when asked to explain the meds', () => {
  const reply = replyVoiceLocally('explain the meds and their side effects to me', RICH);
  assert.match(reply, /You are on 2 medicines/);
  assert.match(reply, /Metformin - Take one tablet with your evening meal/);
  assert.match(reply, /side effects/);
  // A plain dose statement never triggers the overview.
  assert.equal(replyVoiceLocally('I took my meds', RICH), '');
});

test('admits when a medicine has no card on file', () => {
  assert.match(replyVoiceLocally('what does insulin glargine do', RICH), /don't have its details/);
});

test('explains why the care team was notified', () => {
  const reply = replyVoiceLocally('why did the nurse get notified', RICH);
  assert.match(reply, /notified because/);
  assert.match(reply, /Temperature 38\.0 °C or higher/);
});

test('says nobody was notified when no alerts are open', () => {
  assert.match(replyVoiceLocally('why did the nurse get notified', CTX), /has not been notified/);
});

test('an alert question wins over the medicine card when the nurse is mentioned', () => {
  const reply = replyVoiceLocally('why did the nurse get notified about my metformin', RICH);
  assert.match(reply, /Temperature 38\.0 °C or higher/);
  assert.equal(/Metformin/.test(reply), false);
});

test('deflects advice questions to the care team', () => {
  assert.match(replyVoiceLocally('what should I do about my swollen leg', RICH), /can't give medical advice/);
});

test('notes other questions for the care team instead of guessing', () => {
  assert.match(replyVoiceLocally('can I fly next week', RICH), /noted that here for your care team/);
});

test('a plain update gets no spoken reply', () => {
  assert.equal(replyVoiceLocally('I took my metformin', RICH), '');
});

test('the model tool carries a spoken reply field', () => {
  assert.equal(typeof VOICE_TOOL.input_schema.properties.reply, 'object');
  assert.equal(VOICE_TOOL.input_schema.required.includes('reply'), false);
});

// --- exercise ---------------------------------------------------------------

test('a spoken workout lands as a done exercise session', () => {
  const out = parseVoiceLocally('I ran for 30 minutes', CTX);
  const item = byKind(out, 'exercise');
  assert.equal(item.target, 'exercise');
  assert.equal(item.detail.activity, 'Run');
  assert.equal(item.detail.minutes, 30);
  assert.equal(item.detail.intensity, 'moderate');
  assert.equal(item.detail.status, 'done');
  assert.match(item.label, /^Exercise:/);
});

test('naming a weekday makes it a plan for that day', () => {
  const out = parseVoiceLocally('schedule a run on tuesday for 40 minutes', CTX);
  const item = byKind(out, 'exercise');
  assert.equal(item.detail.status, 'planned');
  assert.equal(item.detail.day, 1);
  assert.equal(item.detail.activity, 'Run');
  assert.equal(item.detail.minutes, 40);
});

test('easy wording sets a light intensity', () => {
  const out = parseVoiceLocally('I did an easy 20 minute swim', CTX);
  const item = byKind(out, 'exercise');
  assert.equal(item.detail.activity, 'Swim');
  assert.equal(item.detail.intensity, 'light');
  assert.equal(item.detail.minutes, 20);
});

test('a bare walk with no duration is not a workout', () => {
  const out = parseVoiceLocally('I walked to the fridge for a snack', CTX);
  assert.equal(byKind(out, 'exercise'), undefined);
  assert.equal(byKind(out, 'diet') !== undefined, true);
});

test('a walk with a duration counts, and gym wording maps to strength', () => {
  const walk = byKind(parseVoiceLocally('I walked the dog for 30 minutes', CTX), 'exercise');
  assert.equal(walk.detail.activity, 'Walk');
  assert.equal(walk.detail.minutes, 30);
  const gym = byKind(parseVoiceLocally('I lifted weights at the gym this morning', CTX), 'exercise');
  assert.equal(gym.detail.activity, 'Strength');
});

test('asks about a workout before saving it', () => {
  assert.equal(
    confirmQuestion('exercise', { activity: 'Run', minutes: 30, intensity: 'moderate', status: 'done' }),
    'Do you want me to record your run, 30 minutes?'
  );
  assert.equal(
    confirmQuestion('exercise', { activity: 'Yoga', minutes: 45, intensity: 'light', status: 'planned', day: 1 }),
    'Do you want me to schedule yoga, 45 minutes on Tuesday?'
  );
});

test('the model tool accepts exercise items and drops ones with no activity', () => {
  const out = normalizeCandidates(
    {
      items: [
        { kind: 'exercise', label: 'Run 30 min', confidence: 'high', fields: { activity: 'Run', minutes: 30 } },
        { kind: 'exercise', label: 'Mystery', confidence: 'high', fields: { minutes: 20 } },
      ],
    },
    CTX
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].detail.activity, 'Run');
  assert.equal(out[0].detail.minutes, 30);
  assert.equal(out[0].detail.intensity, 'moderate');
});
