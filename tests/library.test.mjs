import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLAG_LABEL,
  FLAG_PATIENT_LABEL,
  HISTORY_CATEGORIES,
  HISTORY_LABEL,
  LIB_KINDS,
  LIBRARY,
  FDA_SECTION_MAX_CHARS,
  fdaLabelUrl,
  fdaSections,
  isCritical,
  labFlag,
  matchEntry,
  pickFdaResult,
  rangeText,
  slugify,
} from '../spacetimedb/src/library.ts';

// The library table stores aliases as one comma-joined string; mirror that row shape here.
const rows = LIBRARY.map(e => ({ ...e, aliases: e.aliases.join(',') }));
const bySlug = Object.fromEntries(rows.map(e => [e.slug, e]));
const labs = rows.filter(e => e.kind === 'lab');
const meds = rows.filter(e => e.kind === 'medication');
const conditions = rows.filter(e => e.kind === 'condition');

test('library covers every demo care area with unique slugs', () => {
  assert.equal(new Set(rows.map(e => e.slug)).size, rows.length);
  const coverage = [
    'metformin', 'insulin-glargine', 'a1c', 'glucose', 'type-2-diabetes', // diabetes
    'apixaban', 'oxycodone', 'acetaminophen', 'total-knee-replacement', // post-op / ortho
    'furosemide', 'bnp', 'troponin', 'heart-failure', 'atrial-fibrillation', // cardiac / heart failure
    'albuterol', 'tiotropium', 'copd', // COPD
    'cbc', 'bmp', 'wbc', 'cephalexin', // general: pain, antibiotics, CBC, BMP
    'stroke', 'sepsis', 'surgical-site-infection', 'crp', 'lactate', // stroke, infection, pathology
  ];
  for (const slug of coverage) assert.ok(bySlug[slug], `missing coverage: ${slug}`);
  assert.ok(meds.length >= 17);
  assert.ok(labs.length >= 19);
  assert.ok(conditions.length >= 15);
});

test('every entry is complete, cites a source, and links only to known slugs', () => {
  for (const e of rows) {
    assert.ok(LIB_KINDS.includes(e.kind), e.slug);
    assert.ok(e.name && e.summary && e.patientSummary, e.slug);
    assert.ok(e.sourceName && e.sourceUrl.startsWith('https://'), e.slug);
    assert.ok(e.aliases.length > 0, e.slug);
    assert.ok(e.sections.some(s => s.patient), `${e.slug} needs patient-visible text`);
    assert.ok(e.sections.some(s => !s.patient), `${e.slug} needs clinician text`);
    for (const s of e.sections) assert.ok(s.heading && s.body, `${e.slug}: ${s.heading}`);
    for (const r of e.related) assert.ok(bySlug[r], `${e.slug} relates to unknown ${r}`);
  }
});

test('lab ranges are ordered and consistent with the flag logic', () => {
  for (const l of labs) {
    if (l.refLow != null && l.refHigh != null) assert.ok(l.refLow < l.refHigh, l.slug);
    if (l.criticalLow != null) assert.ok(l.refLow == null || l.criticalLow < l.refLow, l.slug);
    if (l.criticalHigh != null) assert.ok(l.refHigh == null || l.criticalHigh > l.refHigh, l.slug);
  }
  const glucose = bySlug.glucose;
  assert.equal(labFlag(53, glucose), 'critical_low');
  assert.equal(labFlag(54, glucose), 'low');
  assert.equal(labFlag(55, glucose), 'low');
  assert.equal(labFlag(70, glucose), 'normal');
  assert.equal(labFlag(99, glucose), 'normal');
  assert.equal(labFlag(100, glucose), 'high');
  assert.equal(labFlag(399, glucose), 'high');
  assert.equal(labFlag(400, glucose), 'critical_high');
  assert.equal(labFlag(4.0, bySlug.potassium), 'normal');
  assert.equal(labFlag(6.2, bySlug.potassium), 'critical_high');
  assert.equal(labFlag(6.5, bySlug.a1c), 'high');
  assert.equal(labFlag(7.5, bySlug.cbc), '');
  assert.equal(labFlag(Number.NaN, glucose), '');
  assert.ok(isCritical('critical_low') && isCritical('critical_high'));
  assert.ok(!isCritical('low') && !isCritical('high') && !isCritical('normal'));
});

test('flag labels and history categories are fully labeled', () => {
  for (const flag of ['normal', 'low', 'high', 'critical_low', 'critical_high']) {
    assert.ok(FLAG_LABEL[flag], flag);
    assert.ok(FLAG_PATIENT_LABEL[flag], flag);
  }
  assert.equal(HISTORY_CATEGORIES.length, 5);
  for (const c of HISTORY_CATEGORIES) assert.ok(HISTORY_LABEL[c], c);
});

test('rangeText renders the stored ranges', () => {
  assert.equal(rangeText(bySlug.glucose), '70–99 mg/dL');
  assert.equal(rangeText(bySlug.egfr), '≥ 60 mL/min/1.73 m²');
  assert.equal(rangeText(bySlug.a1c), '≤ 5.6 %');
  assert.equal(rangeText(bySlug.cbc), '');
});

test('slugify produces stable url-safe slugs', () => {
  assert.equal(slugify('C-reactive protein (CRP)'), 'c-reactive-protein-crp');
  assert.equal(slugify('  eGFR test!! '), 'egfr-test');
  assert.equal(slugify('a'.repeat(80)).length, 60);
});

test('matchEntry resolves names, aliases, slugs, and free text', () => {
  assert.equal(matchEntry(rows, 'metformin')?.slug, 'metformin');
  assert.equal(matchEntry(rows, 'Lantus')?.slug, 'insulin-glargine');
  assert.equal(matchEntry(rows, 'Insulin glargine (basal), 20 units')?.slug, 'insulin-glargine');
  assert.equal(matchEntry(rows, 'total-knee-replacement')?.slug, 'total-knee-replacement');
  assert.equal(matchEntry(rows, 'high blood sugar')?.slug, 'glucose');
  assert.equal(matchEntry(rows, 'insulin glargine with insulin lispro')?.slug, 'insulin-glargine');
  assert.equal(matchEntry(rows, 'glucose', 'lab')?.slug, 'glucose');
  assert.equal(matchEntry(rows, 'glucose', 'medication'), undefined);
  assert.equal(matchEntry(rows, 'nonexistent thing'), undefined);
  assert.equal(matchEntry(rows, ''), undefined);
});

test('pickFdaResult prefers exact generic matches over combinations', () => {
  const combo = { openfda: { generic_name: ['Insulin Glargine and Lixisenatide'] } };
  const single = { openfda: { generic_name: ['Insulin Glargine'] } };
  assert.equal(pickFdaResult([combo, single], 'Insulin glargine'), single);
  const prefixed = [{ openfda: { generic_name: ['Metformin Hydrochloride'] } }];
  assert.equal(pickFdaResult(prefixed, 'Metformin'), prefixed[0]);
  const only = [{ openfda: {} }];
  assert.equal(pickFdaResult(only, 'Metformin'), only[0]);
  assert.equal(pickFdaResult([], 'Metformin'), undefined);
});

test('fdaSections prefixes, flattens, and truncates FDA label text', () => {
  const result = {
    indications_and_usage: ['INDICATIONS AND USAGE\n\nLantus is  indicated  to improve glycemic control in adults'],
    boxed_warning: [],
    warnings_and_precautions: ['   Do   not share   pens. '],
    information_for_patients: ['Do not share your pen even if the needle has changed.'],
  };
  const sections = fdaSections(result);
  assert.deepEqual(sections.map(s => s.heading), [
    'FDA label · Indications and usage',
    'FDA label · Warnings and precautions',
    'FDA label · Information for patients',
  ]);
  assert.ok(sections[0].body.startsWith('INDICATIONS AND USAGE Lantus is indicated to improve'));
  assert.equal(sections[1].body, 'Do not share pens.');
  assert.equal(sections.filter(s => s.patient).length, 1);
  const truncated = fdaSections({ adverse_reactions: ['x '.repeat(5000)] })[0];
  assert.equal(truncated.body.length, FDA_SECTION_MAX_CHARS);
  assert.deepEqual(fdaSections({}), []);
});

test('fdaLabelUrl queries openFDA for a generic name', () => {
  assert.equal(
    fdaLabelUrl('Insulin glargine'),
    'https://api.fda.gov/drug/label.json?search=openfda.generic_name%3A%22Insulin%20glargine%22&limit=10'
  );
});
