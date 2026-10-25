// Reference library: medications, labs, and conditions, with shared helpers for reducers, client, and tests.
// Curated text summarizes the cited public sources (DailyMed FDA labels, MedlinePlus, CDC). It is reference
// material for clinicians and patient education, not a substitute for the full label or clinical judgment.

export const LIB_KINDS = ['medication', 'lab', 'condition', 'device'] as const;
export type LibKind = (typeof LIB_KINDS)[number];

export const LIB_KIND_LABEL: Record<string, string> = {
  medication: 'Medication',
  lab: 'Lab',
  condition: 'Condition',
  device: 'Device',
};

/** General guidance shown for any assistive device the library has no specific entry for. */
export const DEVICE_FALLBACK_SLUG = 'assistive-device';

export const HISTORY_CATEGORIES = ['medical', 'surgical', 'allergy', 'family', 'social'] as const;

export const HISTORY_LABEL: Record<string, string> = {
  medical: 'Medical history',
  surgical: 'Surgical history',
  allergy: 'Allergies',
  family: 'Family history',
  social: 'Social history',
};

/** Prefix for sections written by the openFDA import, so a re-import can replace them. */
export const FDA_SECTION_PREFIX = 'FDA label · ';

export type LibSectionData = { heading: string; body: string; patient: boolean };

export type LibRange = {
  refLow?: number;
  refHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
};

export type LibSeed = LibRange & {
  slug: string;
  kind: LibKind;
  name: string;
  aliases: string[];
  category: string;
  summary: string;
  patientSummary: string;
  sections: LibSectionData[];
  unit: string;
  related: string[];
  sourceName: string;
  sourceUrl: string;
};

export type LabFlag = '' | 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

export const FLAG_LABEL: Record<string, string> = {
  normal: 'In range',
  low: 'Low',
  high: 'High',
  critical_low: 'Critical low',
  critical_high: 'Critical high',
};

/** Plain-language flag for the patient view. */
export const FLAG_PATIENT_LABEL: Record<string, string> = {
  normal: 'In the usual range',
  low: 'Lower than usual',
  high: 'Higher than usual',
  critical_low: 'Much lower than usual',
  critical_high: 'Much higher than usual',
};

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Flag a lab value against reference and critical limits. '' when the library has no range. */
export function labFlag(value: number, r: { refLow?: number | null; refHigh?: number | null; criticalLow?: number | null; criticalHigh?: number | null }): LabFlag {
  if (!Number.isFinite(value)) return '';
  if (has(r.criticalLow) && value < r.criticalLow) return 'critical_low';
  if (has(r.criticalHigh) && value >= r.criticalHigh) return 'critical_high';
  if (!has(r.refLow) && !has(r.refHigh)) return '';
  if (has(r.refLow) && value < r.refLow) return 'low';
  if (has(r.refHigh) && value > r.refHigh) return 'high';
  return 'normal';
}

export const isCritical = (flag: string) => flag === 'critical_low' || flag === 'critical_high';

export function rangeText(r: LibRange & { unit?: string }) {
  const u = r.unit ? ` ${r.unit}` : '';
  if (has(r.refLow) && has(r.refHigh)) return `${r.refLow}–${r.refHigh}${u}`;
  if (has(r.refHigh)) return `≤ ${r.refHigh}${u}`;
  if (has(r.refLow)) return `≥ ${r.refLow}${u}`;
  return '';
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Find the library entry a free-text name refers to (for example "Insulin glargine (basal)").
 * Exact name or alias wins; otherwise the longest name or alias contained in the text.
 */
export function matchEntry<T extends { slug: string; name: string; aliases: string; kind: string }>(
  entries: readonly T[],
  text: string,
  kind?: string
): T | undefined {
  const target = norm(text);
  if (!target) return undefined;
  let best: { e: T; len: number } | undefined;
  for (const e of entries) {
    if (kind && e.kind !== kind) continue;
    const names = [e.name, ...e.aliases.split(',')].map(norm).filter(n => n.length >= 3);
    for (const n of names) {
      if (n === target || e.slug === text) return e;
      const padded = ` ${target} `;
      if (n.length >= 4 && padded.includes(` ${n} `) && (!best || n.length > best.len)) best = { e, len: n.length };
    }
  }
  return best?.e;
}

// ---------------------------------------------------------------------------
// Curated content
// ---------------------------------------------------------------------------

const lines = (...xs: string[]) => xs.join('\n');
const dailymed = (q: string) => `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(q)}`;
const lab = (path: string) => `https://medlineplus.gov/lab-tests/${path}/`;
const topic = (page: string) => `https://medlineplus.gov/${page}`;

type MedInput = {
  aliases: string[];
  category: string;
  summary: string;
  patient: string;
  uses: string[];
  sideEffects: string[];
  callIf: string[];
  contraindications: string[];
  warnings: string[];
  interactions: string[];
  monitoring: string[];
  related: string[];
  search?: string;
};

function med(slug: string, name: string, m: MedInput): LibSeed {
  return {
    slug,
    kind: 'medication',
    name,
    aliases: m.aliases,
    category: m.category,
    summary: m.summary,
    patientSummary: m.patient,
    sections: [
      { heading: 'Used for', body: lines(...m.uses), patient: true },
      { heading: 'Common side effects', body: lines(...m.sideEffects), patient: true },
      { heading: 'Call your care team if', body: lines(...m.callIf), patient: true },
      { heading: 'Contraindications', body: lines(...m.contraindications), patient: false },
      { heading: 'Warnings', body: lines(...m.warnings), patient: false },
      { heading: 'Interactions', body: lines(...m.interactions), patient: false },
      { heading: 'Monitoring', body: lines(...m.monitoring), patient: false },
    ],
    unit: '',
    related: m.related,
    sourceName: 'DailyMed (FDA label)',
    sourceUrl: dailymed(m.search ?? name),
  };
}

type LabInput = LibRange & {
  aliases: string[];
  category: string;
  unit: string;
  summary: string;
  patient: string;
  measures: string[];
  high: string[];
  low: string[];
  notes: string[];
  related: string[];
  url: string;
};

function labTest(slug: string, name: string, l: LabInput): LibSeed {
  const sections: LibSectionData[] = [{ heading: 'What it measures', body: lines(...l.measures), patient: true }];
  if (l.high.length) sections.push({ heading: 'Higher than usual can mean', body: lines(...l.high), patient: true });
  if (l.low.length) sections.push({ heading: 'Lower than usual can mean', body: lines(...l.low), patient: true });
  sections.push({ heading: 'Clinical notes', body: lines(...l.notes), patient: false });
  return {
    slug,
    kind: 'lab',
    name,
    aliases: l.aliases,
    category: l.category,
    summary: l.summary,
    patientSummary: l.patient,
    sections,
    unit: l.unit,
    refLow: l.refLow,
    refHigh: l.refHigh,
    criticalLow: l.criticalLow,
    criticalHigh: l.criticalHigh,
    related: l.related,
    sourceName: 'MedlinePlus (NLM)',
    sourceUrl: l.url,
  };
}

type CondInput = {
  aliases: string[];
  category: string;
  summary: string;
  patient: string;
  signs: string[];
  risks: string[];
  urgent: string[];
  management: string[];
  related: string[];
  url: string;
  sourceName?: string;
};

function condition(slug: string, name: string, c: CondInput): LibSeed {
  return {
    slug,
    kind: 'condition',
    name,
    aliases: c.aliases,
    category: c.category,
    summary: c.summary,
    patientSummary: c.patient,
    sections: [
      { heading: 'Signs and symptoms', body: lines(...c.signs), patient: true },
      { heading: 'Risk factors', body: lines(...c.risks), patient: true },
      { heading: 'Get help right away if', body: lines(...c.urgent), patient: true },
      { heading: 'Clinical management', body: lines(...c.management), patient: false },
    ],
    unit: '',
    related: c.related,
    sourceName: c.sourceName ?? 'MedlinePlus (NLM)',
    sourceUrl: c.url,
  };
}

type DeviceInput = {
  aliases: string[];
  category: string;
  summary: string;
  patient: string;
  use: string[];
  precautions: string[];
  callIf: string[];
  clinical: string[];
  related: string[];
  url: string;
};

function device(slug: string, name: string, d: DeviceInput): LibSeed {
  return {
    slug,
    kind: 'device',
    name,
    aliases: d.aliases,
    category: d.category,
    summary: d.summary,
    patientSummary: d.patient,
    sections: [
      { heading: 'How to use it', body: lines(...d.use), patient: true },
      { heading: 'Safety and precautions', body: lines(...d.precautions), patient: true },
      { heading: 'Call your care team if', body: lines(...d.callIf), patient: true },
      { heading: 'Clinical notes', body: lines(...d.clinical), patient: false },
    ],
    unit: '',
    related: d.related,
    sourceName: 'MedlinePlus (NLM)',
    sourceUrl: d.url,
  };
}

const FALL_CALL = 'A fall, even if you feel fine afterward, or a hit to the head (call 911 if you cannot get up)';

const LOW_SUGAR = 'Low blood sugar: shaky, sweaty, fast heartbeat, hunger, confusion';
const ALLERGY_CALL = 'Signs of a serious allergic reaction: hives all over, swelling of the face or throat, trouble breathing (call 911)';
const BLEED_CALL = [
  'Bleeding that will not stop, or unusual bruising',
  'Pink, red, or brown urine; red or black, tarry stools',
  'Coughing up or vomiting blood or material that looks like coffee grounds',
  'A fall or hit to the head, or a sudden severe headache (call 911)',
];

export const LIBRARY: LibSeed[] = [
  // ----- Medications: diabetes -----
  med('insulin-glargine', 'Insulin glargine', {
    aliases: ['Lantus', 'Basaglar', 'Toujeo', 'Semglee', 'basal insulin', 'long-acting insulin'],
    category: 'Diabetes · Long-acting insulin',
    summary: 'Once-daily basal insulin analog that provides steady background insulin for about 24 hours.',
    patient: 'A long-acting insulin you take once a day to keep your blood sugar steady between meals and overnight.',
    uses: ['Type 1 and type 2 diabetes, to control blood sugar'],
    sideEffects: [LOW_SUGAR, 'Redness, swelling, or itching where you inject', 'Lumps or pits under the skin (rotate injection sites)', 'Weight gain', 'Swelling in the hands or feet'],
    callIf: ['Low blood sugar that does not get better after you treat it', 'Several low or very high readings in a row', ALLERGY_CALL],
    contraindications: ['During episodes of hypoglycemia', 'Hypersensitivity to insulin glargine or any excipient'],
    warnings: [
      'Hypoglycemia, especially with changes in meal pattern, activity, or co-medications',
      'Never share pens or cartridges between patients, even if the needle is changed',
      'Hypokalemia',
      'Fluid retention and heart failure with thiazolidinediones (pioglitazone, rosiglitazone)',
      'Not for intravenous use or for treatment of diabetic ketoacidosis',
    ],
    interactions: [
      'Other glucose-lowering drugs increase hypoglycemia risk',
      'Beta-blockers, clonidine, guanethidine, and reserpine may mask hypoglycemia symptoms',
      'Corticosteroids, thiazides, atypical antipsychotics, and sympathomimetics can raise glucose',
    ],
    monitoring: ['Blood glucose (fingerstick or CGM)', 'Hemoglobin A1c every 3 months until at goal', 'Potassium in patients at risk of hypokalemia'],
    related: ['hypoglycemia', 'type-2-diabetes', 'glucose', 'a1c', 'potassium', 'insulin-lispro'],
  }),
  med('insulin-lispro', 'Insulin lispro', {
    aliases: ['Humalog', 'Admelog', 'Lyumjev', 'mealtime insulin', 'rapid-acting insulin', 'correction insulin'],
    category: 'Diabetes · Rapid-acting insulin',
    summary: 'Rapid-acting prandial insulin analog; onset about 15 minutes, used at meals and for correction doses.',
    patient: 'A fast-acting insulin you take with meals to stop your blood sugar from going too high after eating.',
    uses: ['Type 1 and type 2 diabetes, to control blood sugar at mealtimes'],
    sideEffects: [LOW_SUGAR, 'Low potassium: muscle cramps or weakness', 'Redness, swelling, or itching where you inject', 'Lumps or pits under the skin (rotate injection sites)'],
    callIf: ['Low blood sugar that does not get better after you treat it', 'You cannot eat but have already taken your mealtime dose', ALLERGY_CALL],
    contraindications: ['During episodes of hypoglycemia', 'Hypersensitivity to insulin lispro or any excipient'],
    warnings: [
      'Hypoglycemia; give within 15 minutes before or right after a meal',
      'Never share pens or cartridges between patients',
      'Hypokalemia',
      'Fluid retention and heart failure with thiazolidinediones',
    ],
    interactions: [
      'Other glucose-lowering drugs increase hypoglycemia risk',
      'Beta-blockers and clonidine may mask hypoglycemia symptoms',
      'Corticosteroids and thiazides can raise glucose',
    ],
    monitoring: ['Pre-meal and bedtime glucose', 'Hemoglobin A1c', 'Potassium when at risk'],
    related: ['hypoglycemia', 'type-2-diabetes', 'glucose', 'a1c', 'insulin-glargine', 'dka'],
  }),
  med('metformin', 'Metformin', {
    aliases: ['Glucophage', 'Glumetza', 'Fortamet', 'Riomet'],
    category: 'Diabetes · Biguanide',
    summary: 'First-line oral therapy for type 2 diabetes; lowers hepatic glucose production with low hypoglycemia risk on its own.',
    patient: 'A pill that helps your body use insulin better and lowers how much sugar your liver makes.',
    uses: ['Type 2 diabetes, along with diet and exercise'],
    sideEffects: ['Nausea, diarrhea, gas, or upset stomach (often improves over a few weeks)', 'Metallic taste', 'Low vitamin B12 with long-term use'],
    callIf: ['Unusual muscle pain, trouble breathing, stomach pain, or feeling very weak or cold (possible lactic acidosis)', 'Vomiting or diarrhea that keeps you from drinking fluids', 'You are scheduled for a scan with contrast dye or for surgery'],
    contraindications: ['Severe renal impairment (eGFR below 30 mL/min/1.73 m²)', 'Acute or chronic metabolic acidosis, including diabetic ketoacidosis', 'Hypersensitivity to metformin'],
    warnings: [
      'Boxed warning: lactic acidosis; risk rises with renal impairment, age 65 or older, contrast studies, surgery, hypoxia, heavy alcohol use, and hepatic impairment',
      'Starting is not recommended at eGFR 30–45',
      'Hold at or before iodinated contrast imaging when eGFR is 30–60, or with liver disease, alcoholism, or heart failure; recheck eGFR 48 hours after',
      'Hold temporarily for procedures that restrict food and fluids',
      'Vitamin B12 deficiency',
    ],
    interactions: ['Carbonic anhydrase inhibitors (topiramate, acetazolamide) raise acidosis risk', 'Drugs that reduce metformin clearance (ranolazine, dolutegravir, cimetidine)', 'Alcohol potentiates the effect on lactate'],
    monitoring: ['eGFR before starting and at least yearly', 'Hemoglobin A1c', 'Vitamin B12 periodically'],
    related: ['type-2-diabetes', 'egfr', 'creatinine', 'lactate', 'ckd', 'a1c'],
  }),
  med('lithium', 'Lithium', {
    aliases: ['Lithobid', 'lithium carbonate', 'Eskalith', 'lithium citrate'],
    category: 'Psychiatric · Mood stabilizer',
    summary: 'First-line maintenance for bipolar I disorder; the therapeutic window is narrow and toxicity can occur near the reference range.',
    patient: 'A mood medicine that keeps highs and lows of bipolar disorder from coming back. Blood tests keep the dose safe.',
    uses: ['Bipolar I disorder: maintenance and mania', 'Augmentation in depression (off-label)'],
    sideEffects: ['Tremor, thirst, and urinating more often', 'Nausea or loose stools early in treatment', 'Weight gain or mild ankle swelling', 'Low thyroid with long-term use', 'Toxicity: heavy shaking, vomiting, slurred speech, unsteady walking, confusion (urgent)'],
    callIf: ['Heavy tremor, vomiting, or you cannot walk straight or think clearly (possible lithium toxicity - urgent)', 'Vomiting or diarrhea for more than a day', 'You cannot keep fluids down or you have stopped sweating in hot weather'],
    contraindications: ['Significant renal impairment unless levels can be monitored closely', 'Hypersensitivity to lithium'],
    warnings: [
      'Narrow therapeutic index: toxicity can occur within the reference range; treat the patient, not the number',
      'Dehydration, low-salt diets, heat waves, NSAIDs, diuretics, and ACE inhibitors raise levels',
      'Do not stop abruptly; rebound mania can follow a sudden stop',
      'Check TSH and creatinine at least every 6-12 months',
    ],
    interactions: ['NSAIDs (ibuprofen, naproxen) raise levels', 'Thiazide diuretics and ACE inhibitors raise levels', 'SSRIs add tremor risk', 'Haloperidol adds neurotoxicity reports'],
    monitoring: ['Lithium level about 12 hours after the last dose, every 3-6 months when stable', 'TSH and creatinine every 6-12 months', 'Calcium periodically'],
    related: ['lithium-level', 'bipolar-disorder', 'creatinine', 'tsh'],
  }),
  med('sertraline', 'Sertraline', {
    aliases: ['Zoloft', 'sertraline hydrochloride', 'SSRI'],
    category: 'Psychiatric · SSRI',
    summary: 'SSRI for depression, several anxiety disorders, and PTSD; benefit builds over 2-4 weeks and stopping should be gradual.',
    patient: 'A medicine for depression and anxiety that lifts mood over a few weeks. Do not stop it suddenly.',
    uses: ['Major depressive disorder', 'Generalized anxiety disorder', 'Panic disorder', 'Social anxiety disorder', 'PTSD'],
    sideEffects: ['Nausea, loose stools, or upset stomach in the first weeks', 'Trouble sleeping or feeling jittery early on', 'Dry mouth, sweating, headache', 'Sexual side effects', 'Low sodium in older adults'],
    callIf: ['New or worsening thoughts of harming yourself (contact your care team or 988 right away)', 'Fever with agitation or confusion, muscle jerks, or a racing heart (possible serotonin syndrome)', 'A rash or facial swelling'],
    contraindications: ['Current or recent (within 14 days) MAOI use', 'Pimozide use', 'Hypersensitivity to sertraline'],
    warnings: [
      'Boxed warning: in people under 25, antidepressants can increase suicidal thoughts early in treatment; watch closely in the first weeks',
      'Serotonin syndrome with MAOIs, linezolid, tramadol, or triptans',
      'Bleeding risk with NSAIDs, aspirin, and anticoagulants',
      'Hyponatremia in older adults, especially with diuretics',
      'Stopping suddenly causes discontinuation symptoms; taper under guidance',
    ],
    interactions: ['MAOIs and linezolid (contraindicated)', 'Tramadol, triptans, and St. John\u2019s wort add serotonin risk', 'Warfarin and NSAIDs add bleeding risk', 'Pimozide'],
    monitoring: ['Mood and suicidal-thinking check-ins, especially in the first month', 'PHQ-9 or GAD-7 scores to track response', 'Sodium in older adults'],
    related: ['depression', 'gad', 'phq-9', 'gad-7'],
  }),
  med('empagliflozin', 'Empagliflozin', {
    aliases: ['Jardiance', 'SGLT2 inhibitor'],
    category: 'Diabetes / Heart failure · SGLT2 inhibitor',
    summary: 'SGLT2 inhibitor for type 2 diabetes with heart failure and chronic kidney disease benefits.',
    patient: 'A pill that helps your kidneys remove extra sugar in your urine. It also protects the heart and kidneys.',
    uses: ['Type 2 diabetes', 'Heart failure', 'Chronic kidney disease'],
    sideEffects: ['Genital yeast infections', 'Urinary tract infections', 'Urinating more often', 'Dizziness from dehydration'],
    callIf: ['Nausea, vomiting, stomach pain, unusual tiredness, or trouble breathing, even if your blood sugar is normal (possible ketoacidosis)', 'Pain, redness, or swelling in the genital or anal area with fever', 'You cannot eat or drink, or you are scheduled for surgery'],
    contraindications: ['Hypersensitivity to empagliflozin', 'Patients on dialysis'],
    warnings: [
      'Ketoacidosis, including euglycemic DKA; hold at least 3 days before scheduled surgery and during acute illness or prolonged fasting',
      'Volume depletion and hypotension, especially with diuretics',
      'Urosepsis and pyelonephritis',
      'Necrotizing fasciitis of the perineum (Fournier gangrene)',
      'Hypoglycemia with insulin or sulfonylureas',
    ],
    interactions: ['Insulin and sulfonylureas: consider lower doses', 'Diuretics: additive volume depletion', 'Lithium levels may fall'],
    monitoring: ['Renal function and volume status', 'Ketones when acutely ill despite normal glucose'],
    related: ['type-2-diabetes', 'heart-failure', 'ckd', 'dka', 'ketones'],
  }),

  // ----- Medications: anticoagulants / antiplatelets -----
  med('apixaban', 'Apixaban', {
    aliases: ['Eliquis', 'DOAC', 'factor Xa inhibitor'],
    category: 'Anticoagulant · Factor Xa inhibitor',
    summary: 'Oral direct factor Xa inhibitor for stroke prevention in AF, VTE treatment, and VTE prophylaxis after hip or knee replacement.',
    patient: 'A blood thinner that helps prevent and treat blood clots and lowers stroke risk from atrial fibrillation.',
    uses: ['Preventing blood clots after hip or knee replacement', 'Treating blood clots in the legs or lungs', 'Lowering stroke risk in atrial fibrillation'],
    sideEffects: ['Bruising more easily', 'Bleeding gums or nosebleeds', 'Nausea'],
    callIf: BLEED_CALL,
    contraindications: ['Active pathological bleeding', 'Severe hypersensitivity to apixaban'],
    warnings: [
      'Boxed warning: premature discontinuation increases thrombotic events; bridge if stopping for reasons other than bleeding',
      'Boxed warning: spinal or epidural hematoma with neuraxial anesthesia or puncture',
      'Bleeding risk',
      'Not recommended with prosthetic heart valves or triple-positive antiphospholipid syndrome',
    ],
    interactions: ['Combined strong CYP3A4 and P-gp inhibitors (ketoconazole, itraconazole, ritonavir) raise levels', 'Combined strong inducers (rifampin, carbamazepine, phenytoin, St. John’s wort) lower levels: avoid', 'Antiplatelets, NSAIDs, SSRIs/SNRIs increase bleeding risk'],
    monitoring: ['Signs of bleeding; hemoglobin if suspected', 'Renal and hepatic function', 'Dose criteria in AF: age ≥ 80, weight ≤ 60 kg, creatinine ≥ 1.5 mg/dL'],
    related: ['dvt', 'pulmonary-embolism', 'atrial-fibrillation', 'stroke', 'hemoglobin', 'creatinine', 'total-knee-replacement'],
  }),
  med('enoxaparin', 'Enoxaparin', {
    aliases: ['Lovenox', 'LMWH', 'low molecular weight heparin'],
    category: 'Anticoagulant · Low molecular weight heparin',
    summary: 'Subcutaneous LMWH for VTE prophylaxis after surgery and treatment of DVT/PE.',
    patient: 'A blood thinner shot, usually given in the belly, that prevents blood clots after surgery.',
    uses: ['Preventing blood clots after hip or knee replacement and other surgery', 'Treating blood clots in the legs or lungs'],
    sideEffects: ['Bruising, pain, or a small lump where you inject', 'Bleeding more easily'],
    callIf: [...BLEED_CALL, 'Numbness, tingling, or weakness in the legs after spinal or epidural anesthesia (call 911)'],
    contraindications: ['Active major bleeding', 'History of heparin-induced thrombocytopenia within the past 100 days or with circulating antibodies', 'Hypersensitivity to enoxaparin, heparin, or pork products'],
    warnings: ['Boxed warning: spinal or epidural hematoma with neuraxial anesthesia or puncture', 'Bleeding risk', 'Thrombocytopenia', 'Adjust dose for creatinine clearance below 30 mL/min'],
    interactions: ['Antiplatelets, NSAIDs, and other anticoagulants increase bleeding risk'],
    monitoring: ['CBC with platelets', 'Renal function', 'Anti-Xa levels in pregnancy, severe renal impairment, or extremes of weight'],
    related: ['dvt', 'pulmonary-embolism', 'platelets', 'hemoglobin', 'creatinine', 'total-knee-replacement'],
  }),
  med('warfarin', 'Warfarin', {
    aliases: ['Coumadin', 'Jantoven', 'vitamin K antagonist'],
    category: 'Anticoagulant · Vitamin K antagonist',
    summary: 'Oral vitamin K antagonist; dose titrated to INR, usually 2.0–3.0.',
    patient: 'A blood thinner that needs regular INR blood tests to make sure your dose is right.',
    uses: ['Preventing and treating blood clots', 'Lowering stroke risk in atrial fibrillation', 'Mechanical heart valves'],
    sideEffects: ['Bruising more easily', 'Bleeding gums or nosebleeds'],
    callIf: [...BLEED_CALL, 'You start or stop any medicine, including antibiotics or supplements', 'Pain, color change, or temperature change in the toes or feet'],
    contraindications: ['Pregnancy, except with mechanical heart valves at high thrombotic risk', 'Hemorrhagic tendencies or active bleeding', 'Recent or planned surgery of the central nervous system or eye', 'Threatened abortion, eclampsia, and preeclampsia', 'Unsupervised patients at high risk of nonadherence'],
    warnings: ['Boxed warning: major or fatal bleeding; monitor INR regularly', 'Tissue necrosis and calciphylaxis', 'Purple toe syndrome'],
    interactions: ['Many drugs change INR (for example amiodarone, antibiotics, azole antifungals, and NSAIDs)', 'Botanicals such as St. John’s wort, garlic, and ginkgo', 'Keep vitamin K intake consistent'],
    monitoring: ['INR, target 2.0–3.0 for most indications', 'Signs of bleeding'],
    related: ['inr', 'atrial-fibrillation', 'dvt', 'pulmonary-embolism', 'stroke'],
  }),
  med('aspirin-low-dose', 'Aspirin (low dose)', {
    aliases: ['aspirin', 'ASA', 'baby aspirin', 'Bayer'],
    category: 'Antiplatelet',
    summary: 'Irreversible COX inhibitor used at 81 mg for secondary cardiovascular prevention; also used for VTE prophylaxis after arthroplasty.',
    patient: 'A low-dose pill that makes your blood less sticky to help prevent heart attack, stroke, or clots.',
    uses: ['Preventing another heart attack or stroke', 'Sometimes used to prevent clots after joint replacement'],
    sideEffects: ['Upset stomach or heartburn', 'Bruising or bleeding more easily'],
    callIf: ['Black, tarry stools or vomiting blood', 'Ringing in the ears', ALLERGY_CALL],
    contraindications: ['Allergy to NSAIDs', 'Syndrome of asthma, rhinitis, and nasal polyps', 'Children or teenagers with viral infections (risk of Reye syndrome)'],
    warnings: ['GI bleeding and ulcers, higher with alcohol, anticoagulants, or older age', 'Bleeding risk with other antithrombotics'],
    interactions: ['Anticoagulants and other NSAIDs increase bleeding', 'Ibuprofen may blunt aspirin’s antiplatelet effect'],
    monitoring: ['Signs of GI bleeding', 'Hemoglobin when bleeding is suspected'],
    related: ['stroke', 'total-knee-replacement', 'dvt'],
  }),

  // ----- Medications: pain and antibiotics -----
  med('acetaminophen', 'Acetaminophen', {
    aliases: ['Tylenol', 'paracetamol', 'APAP'],
    category: 'Analgesic / Antipyretic',
    summary: 'First-line analgesic and antipyretic; part of multimodal post-op pain plans. Main risk is hepatotoxicity with excess dosing.',
    patient: 'A pain and fever reliever. It is in many combination products, so check labels to avoid taking too much.',
    uses: ['Mild to moderate pain', 'Fever'],
    sideEffects: ['Few side effects at the right dose'],
    callIf: ['You took more than the daily limit', 'Yellow skin or eyes, dark urine, or pain in the upper right belly', ALLERGY_CALL],
    contraindications: ['Severe hepatic impairment or severe active liver disease', 'Hypersensitivity to acetaminophen'],
    warnings: ['Hepatotoxicity; adult maximum is 4,000 mg per day from all sources, lower with liver disease, chronic alcohol use, or low body weight', 'Serious skin reactions (SJS/TEN) are rare'],
    interactions: ['Combination products (opioid/acetaminophen, cold and flu remedies) add to the daily total', 'Warfarin: regular use may raise INR'],
    monitoring: ['Total daily dose across all products', 'Liver function with long-term high-dose use'],
    related: ['total-knee-replacement', 'oxycodone'],
  }),
  med('oxycodone', 'Oxycodone', {
    aliases: ['OxyContin', 'Roxicodone', 'Percocet', 'opioid'],
    category: 'Analgesic · Opioid agonist',
    summary: 'Opioid for severe acute pain when alternatives are inadequate; use the lowest effective dose for the shortest time.',
    patient: 'A strong prescription pain medicine for a short time after surgery. It can cause sleepiness and slow breathing.',
    uses: ['Severe pain, such as in the first days after surgery'],
    sideEffects: ['Constipation', 'Nausea', 'Sleepiness or dizziness', 'Itching'],
    callIf: ['Very hard to wake, or slow or shallow breathing (call 911 and give naloxone if you have it)', 'No bowel movement for 3 days', 'Pain that is not controlled'],
    contraindications: ['Significant respiratory depression', 'Acute or severe asthma in an unmonitored setting', 'Known or suspected GI obstruction, including paralytic ileus', 'Hypersensitivity to oxycodone'],
    warnings: ['Boxed warnings: addiction, abuse, and misuse; life-threatening respiratory depression; accidental ingestion; neonatal opioid withdrawal; CYP3A4 interactions', 'Boxed warning: profound sedation and death with benzodiazepines or other CNS depressants', 'Prescribe naloxone and a bowel regimen'],
    interactions: ['Benzodiazepines, alcohol, gabapentinoids, and other CNS depressants', 'CYP3A4 inhibitors raise levels; inducers lower levels', 'Serotonergic drugs: serotonin syndrome risk'],
    monitoring: ['Sedation and respiratory rate', 'Bowel function', 'Pain scores and functional goals', 'Taper plan'],
    related: ['total-knee-replacement', 'acetaminophen', 'copd'],
  }),
  med('cephalexin', 'Cephalexin', {
    aliases: ['Keflex', 'first-generation cephalosporin'],
    category: 'Antibiotic · Cephalosporin',
    summary: 'Oral first-generation cephalosporin for skin and soft-tissue infections, UTIs, and some respiratory infections.',
    patient: 'An antibiotic pill for bacterial infections such as skin or wound infections. Take every dose until it is gone.',
    uses: ['Skin and wound infections', 'Urinary tract infections', 'Some bone and respiratory infections'],
    sideEffects: ['Diarrhea', 'Nausea or upset stomach', 'Rash'],
    callIf: ['Watery or bloody diarrhea, especially with stomach cramps or fever', 'Rash, hives, or itching', ALLERGY_CALL],
    contraindications: ['Known allergy to cephalosporins'],
    warnings: ['Hypersensitivity, including in some patients with penicillin allergy', 'Clostridioides difficile–associated diarrhea', 'Adjust dose in severe renal impairment'],
    interactions: ['Metformin levels may rise', 'Probenecid increases cephalexin levels'],
    monitoring: ['Clinical response of the infection', 'Renal function for long courses'],
    related: ['surgical-site-infection', 'diabetic-foot-ulcer', 'wbc'],
  }),
  med('cefazolin', 'Cefazolin', {
    aliases: ['Ancef', 'Kefzol'],
    category: 'Antibiotic · Cephalosporin (IV)',
    summary: 'IV first-generation cephalosporin; standard perioperative prophylaxis for orthopedic surgery and treatment of MSSA infections.',
    patient: 'An antibiotic given through an IV, often just before surgery to prevent infection.',
    uses: ['Preventing infection around surgery', 'Treating serious skin, bone, or blood infections'],
    sideEffects: ['Pain at the IV site', 'Diarrhea', 'Rash'],
    callIf: ['Watery or bloody diarrhea', ALLERGY_CALL],
    contraindications: ['Known allergy to cephalosporins'],
    warnings: ['Hypersensitivity, including some patients with penicillin allergy', 'Clostridioides difficile–associated diarrhea', 'Seizure risk with high doses in renal impairment'],
    interactions: ['Probenecid increases levels'],
    monitoring: ['Renal function', 'Clinical response'],
    related: ['surgical-site-infection', 'sepsis', 'total-knee-replacement'],
  }),

  // ----- Medications: cardiac and pulmonary -----
  med('furosemide', 'Furosemide', {
    aliases: ['Lasix', 'loop diuretic', 'water pill'],
    category: 'Cardiac · Loop diuretic',
    summary: 'Loop diuretic for congestion in heart failure, renal disease, and cirrhosis; also used for hypertension.',
    patient: 'A “water pill” that helps your body get rid of extra fluid so breathing is easier and swelling goes down.',
    uses: ['Fluid buildup from heart failure, kidney disease, or liver disease', 'High blood pressure'],
    sideEffects: ['Urinating more often', 'Dizziness when standing up', 'Low potassium: muscle cramps or weakness', 'Thirst or dry mouth'],
    callIf: ['Weight gain of 2–3 pounds in a day or 5 pounds in a week', 'Fainting, severe dizziness, or very little urine', 'Ringing in the ears or hearing changes'],
    contraindications: ['Anuria', 'Hypersensitivity to furosemide'],
    warnings: ['Boxed warning: potent diuretic; excessive doses cause profound diuresis with water and electrolyte depletion', 'Hypokalemia, hyponatremia, and hypomagnesemia', 'Ototoxicity with high IV doses or with aminoglycosides'],
    interactions: ['Aminoglycosides and other ototoxic drugs', 'Lithium levels rise', 'NSAIDs blunt the diuretic effect', 'Hypokalemia increases digoxin toxicity'],
    monitoring: ['Daily weight', 'Basic metabolic panel (potassium, sodium, creatinine)', 'Blood pressure'],
    related: ['heart-failure', 'potassium', 'sodium', 'creatinine', 'bmp', 'ckd'],
  }),
  med('lisinopril', 'Lisinopril', {
    aliases: ['Zestril', 'Prinivil', 'ACE inhibitor'],
    category: 'Cardiac · ACE inhibitor',
    summary: 'ACE inhibitor for hypertension, heart failure, post-MI, and diabetic kidney disease.',
    patient: 'A blood pressure medicine that also protects the heart and kidneys.',
    uses: ['High blood pressure', 'Heart failure', 'After a heart attack', 'Kidney protection in diabetes'],
    sideEffects: ['Dry cough', 'Dizziness', 'High potassium', 'Small rise in creatinine'],
    callIf: ['Swelling of the face, lips, tongue, or throat, or trouble breathing (call 911)', 'Fainting or severe dizziness', 'You become pregnant'],
    contraindications: ['History of angioedema, including with prior ACE inhibitor', 'Hereditary or idiopathic angioedema', 'With aliskiren in patients with diabetes', 'Within 36 hours of sacubitril/valsartan'],
    warnings: ['Boxed warning: fetal toxicity; stop when pregnancy is detected', 'Hyperkalemia', 'Renal function decline, especially with renal artery stenosis or volume depletion', 'Hypotension'],
    interactions: ['Potassium supplements, potassium-sparing diuretics, and salt substitutes', 'NSAIDs: reduced effect and renal risk', 'Lithium levels rise'],
    monitoring: ['Potassium and creatinine 1–2 weeks after starting or dose change', 'Blood pressure'],
    related: ['hypertension', 'heart-failure', 'ckd', 'potassium', 'creatinine', 'type-2-diabetes'],
  }),
  med('metoprolol', 'Metoprolol', {
    aliases: ['Lopressor', 'Toprol XL', 'beta-blocker'],
    category: 'Cardiac · Beta-blocker',
    summary: 'Cardioselective beta-blocker for hypertension, angina, post-MI, AF rate control, and HFrEF (succinate).',
    patient: 'A heart medicine that slows the heart rate and lowers blood pressure.',
    uses: ['High blood pressure', 'Chest pain (angina)', 'Heart failure', 'Fast heart rhythms like atrial fibrillation'],
    sideEffects: ['Tiredness', 'Dizziness', 'Slow heart rate', 'Cold hands and feet'],
    callIf: ['Heart rate below 50 with dizziness or fainting', 'New or worse shortness of breath or swelling', 'Do not stop suddenly; ask first'],
    contraindications: ['Severe bradycardia', 'Heart block greater than first degree without a pacemaker', 'Cardiogenic shock', 'Sick sinus syndrome without a pacemaker', 'Decompensated heart failure (tartrate)'],
    warnings: ['Boxed warning: abrupt cessation can worsen angina and cause MI; taper over 1–2 weeks', 'May mask tachycardia from hypoglycemia', 'Bronchospasm in asthma or COPD (use lowest dose)'],
    interactions: ['Verapamil, diltiazem, digoxin, amiodarone: additive bradycardia', 'CYP2D6 inhibitors (fluoxetine, paroxetine) raise levels', 'Clonidine withdrawal rebound'],
    monitoring: ['Heart rate and blood pressure', 'Heart failure symptoms'],
    related: ['hypertension', 'heart-failure', 'atrial-fibrillation', 'hypoglycemia'],
  }),
  med('albuterol', 'Albuterol', {
    aliases: ['ProAir', 'Ventolin', 'Proventil', 'rescue inhaler', 'salbutamol'],
    category: 'Pulmonary · Short-acting beta-agonist',
    summary: 'Short-acting bronchodilator for quick relief of bronchospasm in asthma and COPD.',
    patient: 'A quick-relief “rescue” inhaler that opens your airways within minutes when you are short of breath.',
    uses: ['Quick relief of wheezing and shortness of breath in COPD or asthma'],
    sideEffects: ['Shakiness', 'Fast or pounding heartbeat', 'Nervousness', 'Headache'],
    callIf: ['You need it more often than usual or it is not helping (your COPD or asthma may be getting worse)', 'Chest pain or a very fast heartbeat', 'Lips or fingertips turning blue, or trouble talking (call 911)'],
    contraindications: ['Hypersensitivity to albuterol'],
    warnings: ['Paradoxical bronchospasm', 'Increasing use signals deterioration', 'Cardiovascular effects and hypokalemia at high doses'],
    interactions: ['Non-selective beta-blockers block its effect', 'Loop or thiazide diuretics: additive hypokalemia'],
    monitoring: ['Frequency of rescue use', 'Heart rate and potassium with frequent dosing'],
    related: ['copd', 'tiotropium', 'potassium'],
  }),
  med('tiotropium', 'Tiotropium', {
    aliases: ['Spiriva', 'LAMA', 'long-acting antimuscarinic'],
    category: 'Pulmonary · Long-acting antimuscarinic',
    summary: 'Once-daily maintenance bronchodilator for COPD; not for acute symptoms.',
    patient: 'A once-a-day inhaler that keeps your airways open. It is not a rescue inhaler.',
    uses: ['Daily control of COPD symptoms and fewer flare-ups'],
    sideEffects: ['Dry mouth', 'Constipation', 'Sore throat'],
    callIf: ['Eye pain, blurred vision, or seeing halos (possible glaucoma)', 'Trouble urinating or painful urination', 'Wheezing that gets worse right after a dose'],
    contraindications: ['Hypersensitivity to tiotropium, ipratropium, or atropine derivatives'],
    warnings: ['Not for acute bronchospasm', 'Worsening of narrow-angle glaucoma', 'Urinary retention', 'Paradoxical bronchospasm'],
    interactions: ['Avoid other anticholinergics, including ipratropium'],
    monitoring: ['Symptoms and exacerbation frequency', 'Inhaler technique'],
    related: ['copd', 'albuterol'],
  }),

  // ----- Labs -----
  labTest('a1c', 'Hemoglobin A1c', {
    aliases: ['HbA1c', 'A1c', 'glycated hemoglobin'],
    category: 'Diabetes',
    unit: '%',
    refHigh: 5.6,
    summary: 'Average glucose over about 3 months. 5.7–6.4% is prediabetes; 6.5% or higher on two tests diagnoses diabetes. Many adults with diabetes target below 7%.',
    patient: 'Shows your average blood sugar over the past 3 months.',
    measures: ['How much sugar is attached to your red blood cells, reflecting your average blood sugar over about 3 months'],
    high: ['Prediabetes (5.7–6.4%) or diabetes (6.5% or higher)', 'In diabetes, a higher number means blood sugar has been running high'],
    low: [],
    notes: ['Diagnostic cut points: normal < 5.7%, prediabetes 5.7–6.4%, diabetes ≥ 6.5%', 'Usual treatment goal < 7% for many nonpregnant adults; individualize', 'Falsely low or high with anemia, recent transfusion, blood loss, hemoglobin variants, pregnancy, or advanced CKD'],
    related: ['glucose', 'type-2-diabetes', 'metformin', 'insulin-glargine'],
    url: lab('hemoglobin-a1c-hba1c-test'),
  }),
  labTest('glucose', 'Blood glucose', {
    aliases: ['glucose', 'blood sugar', 'fasting glucose', 'FBG', 'fingerstick glucose', 'POC glucose'],
    category: 'Diabetes',
    unit: 'mg/dL',
    refLow: 70,
    refHigh: 99,
    criticalLow: 54,
    criticalHigh: 400,
    summary: 'Fasting reference 70–99 mg/dL. Below 70 is hypoglycemia; below 54 is clinically significant (level 2) hypoglycemia.',
    patient: 'The amount of sugar in your blood right now.',
    measures: ['The amount of glucose (sugar) in your blood at the time of the test'],
    high: ['Diabetes or prediabetes', 'Stress, infection, surgery, or steroid medicines', 'Missed diabetes medicine'],
    low: ['Too much insulin or diabetes medicine', 'Skipped meals or more exercise than usual', 'Drinking alcohol'],
    notes: ['Reference range is for fasting samples; random values run higher', 'Fasting 100–125 mg/dL is prediabetes; ≥ 126 mg/dL on two tests is diabetes', 'Level 2 hypoglycemia < 54 mg/dL; very high values warrant ketone testing'],
    related: ['a1c', 'hypoglycemia', 'dka', 'type-2-diabetes', 'insulin-lispro', 'ketones'],
    url: lab('blood-glucose-test'),
  }),
  labTest('ketones', 'Blood ketones (beta-hydroxybutyrate)', {
    aliases: ['ketones', 'beta-hydroxybutyrate', 'BHB', 'serum ketones'],
    category: 'Diabetes',
    unit: 'mmol/L',
    refHigh: 0.6,
    criticalHigh: 3.0,
    summary: 'Below 0.6 mmol/L is normal; 0.6–1.5 is elevated; above 3.0 strongly suggests ketoacidosis in the right setting.',
    patient: 'Checks for ketones, which build up when your body burns fat because it does not have enough insulin.',
    measures: ['Ketones in the blood, made when the body breaks down fat for energy'],
    high: ['Not enough insulin, as in diabetic ketoacidosis', 'Fasting or very low-carbohydrate diets', 'Ketoacidosis on SGLT2 inhibitors, sometimes with normal glucose'],
    low: [],
    notes: ['DKA criteria include ketonemia with acidosis (pH < 7.3 or bicarbonate < 18 mmol/L)', 'Check in any patient on an SGLT2 inhibitor with nausea, vomiting, or malaise'],
    related: ['dka', 'glucose', 'empagliflozin', 'insulin-lispro'],
    url: lab('ketones-in-blood'),
  }),
  labTest('cbc', 'Complete blood count (CBC)', {
    aliases: ['CBC', 'complete blood count', 'hemogram'],
    category: 'General',
    unit: '',
    summary: 'Panel of WBC, hemoglobin, hematocrit, and platelets, with red cell indices and often a differential.',
    patient: 'A common blood test that counts your white cells, red cells, and platelets.',
    measures: ['White blood cells, which fight infection', 'Red blood cells and hemoglobin, which carry oxygen', 'Platelets, which help blood clot'],
    high: [],
    low: [],
    notes: ['Post-op: track hemoglobin for blood loss and platelets on heparin products', 'Infection: WBC trend and differential'],
    related: ['wbc', 'hemoglobin', 'platelets'],
    url: lab('complete-blood-count-cbc'),
  }),
  labTest('wbc', 'White blood cell count (WBC)', {
    aliases: ['WBC', 'white count', 'leukocytes'],
    category: 'General · CBC',
    unit: '×10³/µL',
    refLow: 4.5,
    refHigh: 11.0,
    criticalLow: 2.0,
    criticalHigh: 30.0,
    summary: 'Typical adult range about 4.5–11.0 ×10³/µL. Leukocytosis suggests infection, inflammation, or stress; leukopenia raises infection risk.',
    patient: 'Counts the white blood cells that fight infection.',
    measures: ['The number of white blood cells in your blood'],
    high: ['An infection or inflammation', 'Stress, surgery, or steroid medicines'],
    low: ['Some medicines or treatments that lower immunity', 'Certain viral infections or bone marrow problems'],
    notes: ['Ranges vary by laboratory', 'Interpret with the differential and clinical picture; steroids cause demargination'],
    related: ['cbc', 'sepsis', 'surgical-site-infection', 'crp'],
    url: lab('white-blood-count-wbc'),
  }),
  labTest('hemoglobin', 'Hemoglobin', {
    aliases: ['Hgb', 'Hb', 'hemoglobin'],
    category: 'General · CBC',
    unit: 'g/dL',
    refLow: 12.0,
    refHigh: 17.5,
    criticalLow: 7.0,
    criticalHigh: 20.0,
    summary: 'Adult ranges about 12.0–15.5 g/dL (female) and 13.5–17.5 g/dL (male). Restrictive transfusion threshold is often 7 g/dL (8 g/dL in orthopedic or cardiac patients).',
    patient: 'Measures the protein in red blood cells that carries oxygen.',
    measures: ['Hemoglobin, the protein in red blood cells that carries oxygen around your body'],
    high: ['Dehydration', 'Smoking or lung disease', 'Living at high altitude'],
    low: ['Anemia', 'Blood loss, including after surgery', 'Kidney disease or low iron'],
    notes: ['Ranges vary by sex and laboratory', 'Expect a post-op drop after arthroplasty; trend and assess symptoms', 'Unexplained drop on anticoagulation: evaluate for bleeding'],
    related: ['cbc', 'apixaban', 'enoxaparin', 'ckd'],
    url: lab('hemoglobin-test'),
  }),
  labTest('platelets', 'Platelet count', {
    aliases: ['PLT', 'platelets', 'thrombocytes'],
    category: 'General · CBC',
    unit: '×10³/µL',
    refLow: 150,
    refHigh: 450,
    criticalLow: 50,
    criticalHigh: 1000,
    summary: 'Typical range 150–450 ×10³/µL. On heparin or enoxaparin, a fall of more than 50% from baseline raises concern for HIT.',
    patient: 'Counts platelets, the small cells that help your blood clot.',
    measures: ['The number of platelets in your blood'],
    high: ['Inflammation, infection, or iron deficiency', 'Recovery after surgery or bleeding'],
    low: ['Some medicines, including heparin', 'Infection, liver disease, or bone marrow problems'],
    notes: ['Monitor on heparin products; 4Ts score for suspected HIT', 'Bleeding risk rises below 50 ×10³/µL'],
    related: ['cbc', 'enoxaparin'],
    url: lab('platelet-tests'),
  }),
  labTest('bmp', 'Basic metabolic panel (BMP)', {
    aliases: ['BMP', 'chem 7', 'basic metabolic panel'],
    category: 'General',
    unit: '',
    summary: 'Sodium, potassium, chloride, bicarbonate, BUN, creatinine, glucose, and calcium.',
    patient: 'A common blood test that checks your kidneys, blood sugar, and body salts (electrolytes).',
    measures: ['Electrolytes such as sodium and potassium', 'Kidney function (BUN and creatinine)', 'Blood sugar'],
    high: [],
    low: [],
    notes: ['Check after starting or changing diuretics, ACE inhibitors, or ARBs', 'Anion gap = Na − (Cl + HCO₃); elevated gap suggests DKA or lactic acidosis'],
    related: ['sodium', 'potassium', 'creatinine', 'bun', 'glucose', 'egfr'],
    url: lab('basic-metabolic-panel-bmp'),
  }),
  labTest('sodium', 'Sodium', {
    aliases: ['Na', 'serum sodium'],
    category: 'General · BMP',
    unit: 'mmol/L',
    refLow: 135,
    refHigh: 145,
    criticalLow: 120,
    criticalHigh: 160,
    summary: 'Reference 135–145 mmol/L. Hyponatremia is common with diuretics, heart failure, and SIADH; correct chronic hyponatremia slowly.',
    patient: 'Measures sodium, a salt that helps control fluid balance and nerve and muscle function.',
    measures: ['The amount of sodium in your blood'],
    high: ['Not drinking enough water or losing a lot of fluid'],
    low: ['Water pills (diuretics) or some other medicines', 'Heart failure, kidney, or liver disease', 'Drinking a very large amount of water'],
    notes: ['Avoid correcting chronic hyponatremia by more than 8–10 mmol/L in 24 hours (osmotic demyelination risk)'],
    related: ['bmp', 'furosemide', 'heart-failure'],
    url: lab('sodium-blood-test'),
  }),
  labTest('potassium', 'Potassium', {
    aliases: ['K', 'serum potassium'],
    category: 'General · BMP',
    unit: 'mmol/L',
    refLow: 3.5,
    refHigh: 5.0,
    criticalLow: 2.8,
    criticalHigh: 6.2,
    summary: 'Reference about 3.5–5.0 mmol/L. Hypokalemia with loop diuretics and insulin; hyperkalemia with ACE inhibitors, ARBs, CKD, and spironolactone.',
    patient: 'Measures potassium, which your heart and muscles need to work properly.',
    measures: ['The amount of potassium in your blood'],
    high: ['Kidney disease', 'Some blood pressure medicines (like ACE inhibitors)', 'A sample that was damaged during the blood draw'],
    low: ['Water pills (diuretics)', 'Vomiting or diarrhea', 'Insulin treatment'],
    notes: ['Get an ECG for significant hyperkalemia or hypokalemia', 'In DKA, replace potassium before insulin if K < 3.3 mmol/L', 'Rule out hemolysis on unexpected high values'],
    related: ['bmp', 'furosemide', 'lisinopril', 'insulin-glargine', 'dka', 'ckd'],
    url: lab('potassium-blood-test'),
  }),
  labTest('creatinine', 'Creatinine', {
    aliases: ['Cr', 'serum creatinine', 'SCr'],
    category: 'Kidney · BMP',
    unit: 'mg/dL',
    refLow: 0.6,
    refHigh: 1.3,
    summary: 'Typical adult range about 0.6–1.3 mg/dL; used to estimate GFR. AKI is a rise of ≥ 0.3 mg/dL in 48 hours or ≥ 1.5× baseline.',
    patient: 'A waste product your kidneys filter. It shows how well your kidneys are working.',
    measures: ['Creatinine, a waste product from muscles that healthy kidneys remove from the blood'],
    high: ['Kidneys not filtering as well as usual', 'Dehydration', 'Some medicines (like NSAIDs) or contrast dye'],
    low: ['Low muscle mass'],
    notes: ['Ranges vary by sex, muscle mass, and laboratory', 'Dose-adjust renally cleared drugs (metformin, enoxaparin, many antibiotics)'],
    related: ['egfr', 'bun', 'bmp', 'ckd', 'metformin', 'lisinopril'],
    url: lab('creatinine-test'),
  }),
  labTest('bun', 'Blood urea nitrogen (BUN)', {
    aliases: ['BUN', 'urea'],
    category: 'Kidney · BMP',
    unit: 'mg/dL',
    refLow: 7,
    refHigh: 20,
    summary: 'Typical range about 7–20 mg/dL. BUN:creatinine ratio above 20 suggests prerenal causes or GI bleeding.',
    patient: 'Another waste product that shows how well your kidneys are working.',
    measures: ['Urea nitrogen, a waste product from protein breakdown removed by the kidneys'],
    high: ['Kidney problems', 'Dehydration', 'Bleeding in the stomach or intestines', 'A high-protein diet or steroid medicines'],
    low: ['Liver disease or low protein intake'],
    notes: ['Interpret with creatinine; ratio > 20 suggests prerenal azotemia or upper GI bleeding'],
    related: ['creatinine', 'bmp', 'ckd'],
    url: lab('bun-blood-urea-nitrogen'),
  }),
  labTest('lithium-level', 'Lithium level', {
    aliases: ['lithium', 'serum lithium', 'lithium blood level'],
    category: 'Psychiatric monitoring',
    unit: 'mEq/L',
    refLow: 0.6,
    refHigh: 1.2,
    criticalHigh: 2.0,
    summary: 'Therapeutic maintenance range about 0.6–1.2 mEq/L (up to 1.5 in mania). Toxicity risk climbs steeply above 2.0.',
    patient: 'How much lithium is in your blood. Too little does not work; too much can make you very sick.',
    measures: ['The concentration of lithium in a blood sample, drawn about 12 hours after the last dose'],
    high: ['Too high a dose for you', 'Dehydration, low salt intake, or vomiting and diarrhea', 'Interactions: diuretics, NSAIDs like ibuprofen, ACE inhibitors'],
    low: ['A missed dose or a dose change'],
    notes: [
      'Toxicity can occur within the "normal" range: treat the patient, not only the number',
      'Classic toxicity triad: coarse tremor, GI upset, then confusion or unsteady gait',
      'Check TSH and creatinine at least every 6-12 months on chronic therapy',
      'Hold and recheck with any suspicion of toxicity; hemodialysis for severe cases',
    ],
    related: ['lithium', 'creatinine', 'tsh', 'bmp'],
    url: lab('lithium'),
  }),
  labTest('tsh', 'TSH (thyroid stimulating hormone)', {
    aliases: ['TSH', 'thyroid stimulating hormone', 'thyrotropin'],
    category: 'Endocrine · Thyroid',
    unit: 'mIU/L',
    refLow: 0.4,
    refHigh: 4.0,
    summary: 'First-line thyroid test. Lithium lowers thyroid function in a minority of patients, so TSH is checked at least every 6-12 months on chronic lithium.',
    patient: 'A blood test that shows how well your thyroid gland is working. Lithium can slow it down, so it is checked regularly.',
    measures: ['The pituitary hormone that signals the thyroid, in a blood sample'],
    high: ['An underactive thyroid (hypothyroidism), which lithium can cause', 'Recent lithium use or dose change', 'Recovering from a recent thyroid illness'],
    low: ['An overactive thyroid (hyperthyroidism)'],
    notes: [
      'Check TSH before starting lithium and every 6-12 months while on it',
      'Free T4 confirms an abnormal TSH',
      'Symptoms of low thyroid on lithium: tiredness, feeling cold, weight gain, constipation',
    ],
    related: ['lithium', 'lithium-level', 'creatinine', 'bmp'],
    url: lab('tsh-thyroid-stimulating-hormone-test'),
  }),
  labTest('egfr', 'eGFR', {
    aliases: ['eGFR', 'estimated glomerular filtration rate', 'GFR'],
    category: 'Kidney',
    unit: 'mL/min/1.73 m²',
    refLow: 60,
    criticalLow: 15,
    summary: 'eGFR below 60 for 3 months or more defines CKD stage 3 or worse; below 15 is kidney failure. Drives dosing of metformin, SGLT2 inhibitors, and anticoagulants.',
    patient: 'An estimate of how well your kidneys filter your blood, based on your creatinine.',
    measures: ['How much blood your kidneys filter each minute, estimated from your creatinine level, age, and sex'],
    high: [],
    low: ['Chronic kidney disease, often from diabetes or high blood pressure', 'A sudden kidney injury from dehydration, infection, or some medicines'],
    notes: ['CKD stages: G3a 45–59, G3b 30–44, G4 15–29, G5 < 15', 'Metformin contraindicated < 30; not recommended to start at 30–45'],
    related: ['creatinine', 'ckd', 'metformin', 'empagliflozin', 'enoxaparin'],
    url: lab('estimated-glomerular-filtration-rate-egfr-and-gfr-tests'),
  }),
  labTest('inr', 'PT/INR', {
    aliases: ['INR', 'PT', 'prothrombin time'],
    category: 'Coagulation',
    unit: '',
    refHigh: 1.1,
    criticalHigh: 5.0,
    summary: 'Without anticoagulation INR is about 0.8–1.1. Warfarin target is usually 2.0–3.0 (2.5–3.5 for some mechanical valves).',
    patient: 'Measures how long your blood takes to clot. People on warfarin get this test often.',
    measures: ['How long it takes your blood to form a clot'],
    high: ['Warfarin, as expected on treatment (usual goal 2 to 3)', 'Liver disease or low vitamin K', 'Interacting medicines, such as some antibiotics'],
    low: ['Warfarin dose too low for you, or eating much more vitamin K than usual'],
    notes: ['The reference range applies to patients not on warfarin; interpret on-treatment values against the INR goal', 'INR > 4.5 without bleeding: hold doses and consider oral vitamin K per guidelines'],
    related: ['warfarin', 'atrial-fibrillation'],
    url: lab('prothrombin-time-test-and-inr-ptinr'),
  }),
  labTest('d-dimer', 'D-dimer', {
    aliases: ['D-dimer', 'DDimer'],
    category: 'Coagulation',
    unit: 'µg/mL FEU',
    refHigh: 0.5,
    summary: 'Below 0.5 µg/mL FEU helps rule out VTE when pretest probability is low. Nonspecific: often high after surgery, in older adults, and with infection.',
    patient: 'Looks for a substance released when a blood clot breaks down.',
    measures: ['A protein fragment made when a blood clot dissolves'],
    high: ['Possible blood clot (DVT or pulmonary embolism)', 'Recent surgery, injury, infection, or pregnancy'],
    low: [],
    notes: ['Use with a pretest probability score (Wells); low value rules out VTE only when probability is low', 'Age-adjusted cutoff: age × 0.01 µg/mL FEU for patients over 50', 'Low value after recent arthroplasty is uncommon; image when clinical suspicion is high'],
    related: ['dvt', 'pulmonary-embolism'],
    url: lab('d-dimer-test'),
  }),
  labTest('crp', 'C-reactive protein (CRP)', {
    aliases: ['CRP', 'C-reactive protein'],
    category: 'Inflammation',
    unit: 'mg/L',
    refHigh: 10,
    summary: 'Nonspecific marker of inflammation. After arthroplasty CRP peaks around day 2–3 and normalizes over weeks; a secondary rise suggests infection.',
    patient: 'Measures inflammation in your body, which can rise with infection or after surgery.',
    measures: ['A protein your liver makes when there is inflammation in your body'],
    high: ['Infection', 'Inflammation, including after surgery', 'Autoimmune conditions'],
    low: [],
    notes: ['Units vary (mg/L vs mg/dL); check the lab report', 'Trend values rather than single readings for post-op infection'],
    related: ['surgical-site-infection', 'sepsis', 'wbc'],
    url: lab('c-reactive-protein-crp-test'),
  }),
  labTest('troponin', 'Troponin', {
    aliases: ['troponin', 'hs-troponin', 'troponin I', 'troponin T', 'TnI', 'TnT'],
    category: 'Cardiac',
    unit: 'ng/L',
    summary: 'Marker of myocardial injury. Cutoffs are assay-specific (99th percentile URL); interpret serial values and the change between them.',
    patient: 'Checks for heart muscle damage, for example from a heart attack.',
    measures: ['Troponin, a protein released into the blood when heart muscle is damaged'],
    high: ['Heart attack or other heart muscle injury', 'Severe infection, pulmonary embolism, or kidney disease'],
    low: [],
    notes: ['No universal range: use your lab’s 99th percentile upper reference limit', 'Rise and/or fall with ischemic symptoms supports MI'],
    related: ['heart-failure', 'pulmonary-embolism'],
    url: lab('troponin-test'),
  }),
  labTest('bnp', 'BNP', {
    aliases: ['BNP', 'B-type natriuretic peptide', 'brain natriuretic peptide'],
    category: 'Cardiac',
    unit: 'pg/mL',
    refHigh: 100,
    summary: 'BNP below 100 pg/mL makes acute heart failure unlikely. Higher with age and kidney disease; lower with obesity; sacubitril raises BNP but not NT-proBNP.',
    patient: 'Checks for strain on your heart, which goes up with heart failure.',
    measures: ['A hormone your heart releases when it is stretched or working harder'],
    high: ['Heart failure or worsening heart failure', 'Kidney disease, older age, or a lung clot'],
    low: [],
    notes: ['NT-proBNP has different cutoffs (age-dependent)', 'Track trends for heart failure management'],
    related: ['heart-failure', 'furosemide'],
    url: lab('natriuretic-peptide-tests-bnp-nt-probnp'),
  }),
  labTest('lactate', 'Lactate', {
    aliases: ['lactate', 'lactic acid'],
    category: 'Critical care',
    unit: 'mmol/L',
    refLow: 0.5,
    refHigh: 2.0,
    criticalHigh: 4.0,
    summary: 'Normal about 0.5–2.0 mmol/L. Above 2 in suspected sepsis prompts reassessment; 4 or higher is high risk and triggers fluid resuscitation.',
    patient: 'Measures lactate, which can rise when the body is not getting enough oxygen, as in a serious infection.',
    measures: ['Lactate, made when cells do not get enough oxygen'],
    high: ['Sepsis or serious infection', 'Shock, severe dehydration, or heavy exercise', 'Rarely, metformin-associated lactic acidosis'],
    low: [],
    notes: ['Repeat within 2–4 hours if initial lactate > 2 mmol/L in sepsis', 'Consider metformin-associated lactic acidosis with renal failure'],
    related: ['sepsis', 'metformin'],
    url: lab('lactate-test'),
  }),

  // ----- Conditions -----
  condition('bipolar-disorder', 'Bipolar disorder', {
    aliases: ['bipolar', 'bipolar I', 'bipolar II', 'manic depression', 'manic-depressive illness'],
    category: 'Mental health',
    summary: 'Episodic illness with manic, hypomanic, and depressive episodes. Maintenance treatment and steady sleep lower relapse risk.',
    patient: 'A condition with big mood swings: times of very high energy and times of deep lows. Medicine and steady routines keep it in balance.',
    signs: [
      'High mood or irritability with much more energy than usual',
      'Little need for sleep during a high',
      'Racing thoughts, talking fast, jumping between ideas',
      'Risky spending, driving, or decisions during a high',
      'Episodes of depression: low mood, low energy, no enjoyment',
    ],
    risks: ['Family history of bipolar disorder', 'Disrupted sleep and shift work', 'Stopping mood medicine suddenly', 'Alcohol or stimulant use', 'Major life stress'],
    urgent: ['Thoughts of self-harm, or of not wanting to be here (call or text 988)', 'Not sleeping at all while mood is very high', 'Confusion, recklessness, or decisions that could cause real harm'],
    management: [
      'Lithium, valproate, or an atypical antipsychotic as maintenance',
      'Lithium levels every 3-6 months once stable, with TSH and creatinine',
      'Protect sleep as part of the treatment plan',
      'Track mood daily; a run of high days with short sleep means call the clinic',
      'Psychotherapy and a written relapse-prevention plan',
    ],
    related: ['lithium', 'lithium-level', 'depression', 'sertraline'],
    url: topic('bipolardisorder.html'),
  }),
  condition('depression', 'Depression', {
    aliases: ['major depressive disorder', 'MDD', 'clinical depression', 'depressive episode', 'low mood'],
    category: 'Mental health',
    summary: 'At least two weeks of low mood or loss of interest. PHQ-9 tracks severity; item 9 screens for thoughts of self-harm.',
    patient: 'More than a few sad days: weeks of low mood, low energy, or losing interest in things you enjoyed. It is treatable.',
    signs: ['Low mood most days', 'No interest or pleasure in usual activities', 'Sleeping too little or too much', 'Tiredness and trouble concentrating', 'Feeling worthless or guilty', 'Thoughts of being better off dead (urgent)'],
    risks: ['Prior episodes of depression', 'Family history', 'Chronic illness or chronic pain', 'Isolation or major loss', 'Some medicines and alcohol use'],
    urgent: ['Thoughts of harming yourself or of being better off dead (call or text 988, or 911 if you may act on them)', 'Hearing or seeing things others do not', 'Cannot care for yourself at all'],
    management: [
      'PHQ-9 at intake and to track response; a 5-point drop is meaningful',
      'Any positive item 9 needs a same-day safety conversation',
      'SSRI or psychotherapy for most patients; combination for moderate or worse',
      'Watch closely in the first weeks of a new antidepressant',
      'Exercise, sleep, and social contact support recovery',
    ],
    related: ['sertraline', 'gad', 'bipolar-disorder', 'phq-9'],
    url: topic('depression.html'),
  }),
  condition('gad', 'Generalized anxiety disorder', {
    aliases: ['GAD', 'anxiety', 'generalized anxiety', 'constant worry', 'nervousness'],
    category: 'Mental health',
    summary: 'Excessive, hard-to-control worry on more days than not for at least six months, with physical tension symptoms. GAD-7 tracks severity.',
    patient: 'Worry that will not switch off, most days, with a tense or restless body. Very treatable with therapy, medicine, or both.',
    signs: ['Worry that is hard to stop, most days', 'Restlessness or feeling keyed up', 'Trouble sleeping', 'Tense muscles, headaches, or stomach upset', 'Irritability and trouble concentrating'],
    risks: ['Long-term stress or trauma', 'Family history of anxiety', 'Too much caffeine or stimulants', 'Other mental health conditions'],
    urgent: ['Chest pain, trouble breathing, or fear you are dying (call 911; it can be hard to tell a panic attack from a heart problem)', 'Drinking or using pills to calm the worry', 'Thoughts of self-harm (call or text 988)'],
    management: [
      'GAD-7 at intake and to track response',
      'CBT is first-line; SSRIs or buspirone for persistent symptoms',
      'Limit caffeine and alcohol; practice paced breathing and exercise',
      'Treat the depression that travels with anxiety',
    ],
    related: ['sertraline', 'depression', 'gad-7'],
    url: topic('anxiety.html'),
  }),
  labTest('phq-9', 'PHQ-9 depression screening', {
    aliases: ['PHQ-9', 'PHQ9', 'patient health questionnaire', 'depression screening'],
    category: 'Mental health · Screening',
    unit: 'points (0-27)',
    refLow: 0,
    refHigh: 4,
    summary: 'Nine-item self-report for depression severity over the last two weeks; item 9 screens for thoughts of self-harm. Bands: 0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe.',
    patient: 'A short questionnaire about how you have been feeling. Your answers tell your care team how low your mood has been and whether you need help soon.',
    measures: ['Nine questions about mood, sleep, energy, appetite, concentration, and self-worth, each scored 0-3', 'Item 9 asks about thoughts of being better off dead or of self-harm'],
    high: ['A total of 15 or more: moderately severe to severe depression, needs same-day follow-up', 'Any nonzero answer on item 9: contact the patient now'],
    low: [],
    notes: [
      'A 5-point drop between screenings is a meaningful response to treatment',
      'Item 9 positive overrides the total: assess safety the same day whatever the score',
      'Scores are screening, not diagnosis: confirm with a clinical interview',
    ],
    related: ['depression', 'sertraline', 'gad', 'gad-7'],
    url: topic('depression.html'),
  }),
  labTest('gad-7', 'GAD-7 anxiety screening', {
    aliases: ['GAD-7', 'GAD7', 'generalized anxiety disorder scale', 'anxiety screening'],
    category: 'Mental health · Screening',
    unit: 'points (0-21)',
    refLow: 0,
    refHigh: 4,
    summary: 'Seven-item self-report for anxiety severity over the last two weeks. Bands: 0-4 minimal, 5-9 mild, 10-14 moderate, 15-21 severe.',
    patient: 'A short questionnaire about worry and tension. Your answers show your care team how much anxiety is getting in the way and whether to step up treatment.',
    measures: ['Seven questions about nervousness, uncontrollable worry, restlessness, and irritability, each scored 0-3'],
    high: ['A total of 15 or more: severe anxiety, needs same-day follow-up', 'A total of 10 or more: consider treatment if not already started'],
    low: [],
    notes: [
      'Also screens usefully for panic, social anxiety, and PTSD symptoms',
      'A 5-point drop between screenings is a meaningful response to treatment',
      'Pair with the PHQ-9: depression and anxiety travel together',
    ],
    related: ['gad', 'depression', 'sertraline', 'phq-9'],
    url: topic('anxiety.html'),
  }),
  condition('type-2-diabetes', 'Type 2 diabetes', {
    aliases: ['T2D', 'T2DM', 'diabetes', 'diabetes mellitus', 'type 2 diabetes mellitus'],
    category: 'Diabetes',
    summary: 'Chronic hyperglycemia from insulin resistance and relative insulin deficiency. Diagnosis: A1c ≥ 6.5%, fasting glucose ≥ 126 mg/dL, or 2-hour OGTT ≥ 200 mg/dL.',
    patient: 'A long-term condition where your body does not use insulin well, so blood sugar runs too high.',
    signs: ['Feeling very thirsty or urinating often', 'Blurry vision', 'Tiredness', 'Cuts or sores that heal slowly', 'Numbness or tingling in the feet', 'Often no symptoms early on'],
    risks: ['Overweight or less physical activity', 'Family history of diabetes', 'Age 35 or older', 'History of diabetes in pregnancy', 'High blood pressure or cholesterol'],
    urgent: ['Blood sugar under 70 that does not come up after treating it', 'Blood sugar over 300 with vomiting, stomach pain, or trouble breathing', 'Confusion or very drowsy'],
    management: ['Individualized A1c goal, often < 7%', 'Metformin plus lifestyle therapy for most patients', 'SGLT2 inhibitor or GLP-1 RA with ASCVD, heart failure, or CKD regardless of A1c', 'Add basal insulin when needed; titrate to fasting glucose', 'Annual eye exam, foot exam, urine albumin, and eGFR'],
    related: ['a1c', 'glucose', 'metformin', 'empagliflozin', 'insulin-glargine', 'insulin-lispro', 'hypoglycemia', 'dka', 'diabetic-foot-ulcer', 'ckd'],
    url: topic('diabetestype2.html'),
  }),
  condition('hypoglycemia', 'Hypoglycemia', {
    aliases: ['low blood sugar', 'low glucose', 'hypo'],
    category: 'Diabetes',
    summary: 'Glucose < 70 mg/dL (level 1); < 54 mg/dL is clinically significant (level 2); level 3 is severe with altered mental status needing assistance.',
    patient: 'Blood sugar that drops too low, usually below 70. It needs to be treated right away.',
    signs: ['Shaky, sweaty, or clammy', 'Fast heartbeat', 'Hungry, irritable, or anxious', 'Dizzy, confused, or blurry vision', 'Trouble speaking or acting strangely'],
    risks: ['Taking insulin or sulfonylurea pills', 'Skipping or delaying meals', 'More exercise than usual', 'Drinking alcohol', 'Kidney disease'],
    urgent: ['You cannot eat or drink, or you pass out (someone should give glucagon if you have it and call 911)', 'Your blood sugar stays below 70 after treating it twice'],
    management: ['Conscious patient: 15–20 g fast-acting glucose, recheck in 15 minutes, repeat if still < 70 mg/dL, then a snack or meal', 'Unable to take oral glucose: glucagon or IV dextrose', 'Identify cause and adjust insulin or sulfonylurea; consider CGM', 'Beta-blockers can mask adrenergic symptoms'],
    related: ['glucose', 'insulin-glargine', 'insulin-lispro', 'type-2-diabetes', 'metoprolol'],
    url: topic('hypoglycemia.html'),
  }),
  condition('dka', 'Diabetic ketoacidosis (DKA)', {
    aliases: ['DKA', 'ketoacidosis', 'euglycemic DKA'],
    category: 'Diabetes',
    summary: 'Hyperglycemia (or euglycemia on SGLT2 inhibitors), ketonemia, and metabolic acidosis from insulin deficiency. A medical emergency.',
    patient: 'A dangerous condition where the body has too little insulin and makes acids called ketones. It needs emergency care.',
    signs: ['Very thirsty and urinating a lot', 'Nausea, vomiting, or stomach pain', 'Fruity-smelling breath', 'Deep, fast breathing', 'Very tired or confused'],
    risks: ['Missed insulin doses', 'Infection, surgery, or other illness', 'Insulin pump problems', 'SGLT2 inhibitor medicines, especially around surgery or fasting'],
    urgent: ['Vomiting and cannot keep fluids down', 'Trouble breathing or fruity breath', 'Confusion or very drowsy (call 911)'],
    management: ['Labs: glucose, BMP with anion gap, beta-hydroxybutyrate, venous blood gas', 'IV fluids, IV insulin infusion, and potassium replacement (hold insulin if K < 3.3 mmol/L)', 'Find and treat the trigger (infection, missed insulin)', 'Hold SGLT2 inhibitors'],
    related: ['ketones', 'glucose', 'potassium', 'insulin-lispro', 'empagliflozin', 'type-2-diabetes'],
    url: 'https://medlineplus.gov/ency/article/000320.htm',
  }),
  condition('diabetic-foot-ulcer', 'Diabetic foot ulcer', {
    aliases: ['diabetic foot', 'foot ulcer', 'DFU'],
    category: 'Diabetes · Wound',
    summary: 'Ulceration from neuropathy, peripheral arterial disease, and pressure. Infection and osteomyelitis risk drive amputation.',
    patient: 'An open sore on the foot that can be hard to heal when you have diabetes. Check your feet every day.',
    signs: ['A sore, blister, or cut that is not healing', 'Drainage on your sock', 'Redness, warmth, or swelling', 'Bad smell from the wound', 'Numbness in the foot'],
    risks: ['Nerve damage (neuropathy) from diabetes', 'Poor circulation', 'High blood sugar', 'Smoking', 'Shoes that rub or past foot ulcers'],
    urgent: ['Redness spreading up the foot or leg', 'Fever or chills', 'The wound turns black or smells bad'],
    management: ['Offloading, debridement, and moisture-balanced dressings', 'Assess infection severity (IWGDF/IDSA); culture deep tissue, not swabs', 'Probe-to-bone, X-ray, or MRI for osteomyelitis', 'Vascular assessment (ABI, toe pressures)', 'Glycemic control and podiatry follow-up'],
    related: ['type-2-diabetes', 'cephalexin', 'wbc', 'crp', 'a1c'],
    url: topic('diabeticfoot.html'),
  }),
  condition('dvt', 'Deep vein thrombosis (DVT)', {
    aliases: ['DVT', 'blood clot', 'venous thromboembolism', 'VTE'],
    category: 'Post-op / Vascular',
    summary: 'Thrombus in a deep vein, usually of the leg. Major orthopedic surgery is a strong risk factor; can embolize to the lungs.',
    patient: 'A blood clot in a deep vein, usually in the leg. It can travel to the lungs, so report symptoms quickly.',
    signs: ['Swelling in one leg', 'Pain or tenderness in the calf or thigh', 'Warm skin', 'Red or darker skin on the leg'],
    risks: ['Recent surgery, especially hip or knee replacement', 'Not moving much, or long travel', 'Cancer, pregnancy, or estrogen medicines', 'Past blood clots', 'Obesity or smoking'],
    urgent: ['Sudden shortness of breath, chest pain, coughing blood, or a racing heart (call 911; possible pulmonary embolism)'],
    management: ['Pretest probability (Wells score), D-dimer when probability is low', 'Compression ultrasound to confirm', 'Anticoagulation, typically a DOAC for at least 3 months for provoked DVT', 'Post-arthroplasty prophylaxis: aspirin, DOAC, or LMWH per surgeon protocol'],
    related: ['pulmonary-embolism', 'd-dimer', 'apixaban', 'enoxaparin', 'warfarin', 'total-knee-replacement'],
    url: topic('deepveinthrombosis.html'),
  }),
  condition('pulmonary-embolism', 'Pulmonary embolism (PE)', {
    aliases: ['PE', 'lung clot'],
    category: 'Post-op / Vascular',
    summary: 'Embolic occlusion of the pulmonary arteries, usually from leg DVT. Presents with dyspnea, pleuritic chest pain, tachycardia, or hypoxia.',
    patient: 'A blood clot that has traveled to the lungs. It is an emergency.',
    signs: ['Sudden shortness of breath', 'Sharp chest pain that is worse with a deep breath', 'Coughing up blood', 'Fast heartbeat', 'Lightheaded or fainting'],
    risks: ['A blood clot in the leg (DVT)', 'Recent surgery or hospital stay', 'Not moving much', 'Cancer or past clots'],
    urgent: ['Any of these signs: call 911'],
    management: ['CT pulmonary angiography; V/Q scan if contrast is contraindicated', 'Risk-stratify (PESI, RV strain, troponin)', 'Anticoagulation; systemic thrombolysis for high-risk (massive) PE'],
    related: ['dvt', 'd-dimer', 'troponin', 'apixaban', 'enoxaparin'],
    url: topic('pulmonaryembolism.html'),
  }),
  condition('surgical-site-infection', 'Surgical site infection', {
    aliases: ['SSI', 'wound infection', 'incision infection', 'prosthetic joint infection', 'PJI'],
    category: 'Post-op / Infection',
    summary: 'Infection of the incision (superficial), deeper tissue, or organ space within 30 days of surgery, or 90 days after implants such as joint replacements.',
    patient: 'An infection where you had surgery. Catching it early makes it easier to treat.',
    signs: ['Redness, warmth, or swelling around the incision that is getting worse', 'More pain than the day before', 'Cloudy or bad-smelling drainage', 'The incision opening up', 'Fever'],
    risks: ['Diabetes or high blood sugar', 'Smoking', 'Obesity', 'Weakened immune system or steroid medicines', 'Long surgery'],
    urgent: ['Fever with chills, a fast heartbeat, or confusion (possible sepsis)', 'Redness spreading quickly'],
    management: ['Examine the wound; culture drainage', 'Superficial: oral antibiotics such as cephalexin; deep or organ space: surgical evaluation', 'Suspected prosthetic joint infection: urgent orthopedic referral, joint aspiration, ESR/CRP; avoid antibiotics before cultures if stable', 'Optimize perioperative glucose'],
    related: ['crp', 'wbc', 'cephalexin', 'cefazolin', 'sepsis', 'total-knee-replacement', 'type-2-diabetes'],
    url: 'https://www.cdc.gov/surgical-site-infections/about/index.html',
    sourceName: 'CDC',
  }),
  condition('sepsis', 'Sepsis', {
    aliases: ['septic shock', 'septicemia'],
    category: 'Infection / Critical care',
    summary: 'Life-threatening organ dysfunction from a dysregulated response to infection. Early recognition and antibiotics improve survival.',
    patient: 'The body’s extreme reaction to an infection. It is a medical emergency.',
    signs: ['Fever, chills, or feeling very cold', 'Fast heartbeat or fast breathing', 'Confusion or sleepiness', 'Extreme pain or feeling very unwell', 'Clammy or sweaty skin'],
    risks: ['Recent surgery or an infection such as a wound, urinary, or lung infection', 'Age 65 or older', 'Diabetes, kidney, or lung disease', 'Weakened immune system'],
    urgent: ['Signs of infection plus confusion, fast breathing, or a fast heartbeat: call 911 and say “I am worried about sepsis”'],
    management: ['Screen with qSOFA/NEWS; measure lactate', 'Blood cultures before antibiotics when it does not delay them', 'Broad-spectrum antibiotics within 1 hour for possible septic shock or high likelihood of sepsis', '30 mL/kg crystalloid for hypotension or lactate ≥ 4 mmol/L; vasopressors for MAP < 65', 'Source control'],
    related: ['lactate', 'wbc', 'crp', 'surgical-site-infection', 'cefazolin'],
    url: topic('sepsis.html'),
  }),
  condition('heart-failure', 'Heart failure', {
    aliases: ['HF', 'CHF', 'congestive heart failure', 'HFrEF', 'HFpEF'],
    category: 'Cardiac',
    summary: 'Clinical syndrome of congestion and/or low output. HFrEF benefits from four-pillar GDMT; diuretics treat congestion.',
    patient: 'The heart does not pump as well as it should, so fluid can build up in the lungs and legs.',
    signs: ['Shortness of breath with activity or when lying flat', 'Swelling in the feet, ankles, or legs', 'Quick weight gain', 'Tired and weak', 'Cough, especially at night'],
    risks: ['High blood pressure', 'Past heart attack or coronary artery disease', 'Diabetes', 'Heart valve disease or atrial fibrillation', 'Kidney disease'],
    urgent: ['Shortness of breath at rest or that wakes you up', 'Chest pain or fainting (call 911)', 'Weight gain of 2–3 pounds in a day or 5 pounds in a week (call your care team)'],
    management: ['HFrEF: ACE inhibitor/ARB/ARNI, evidence-based beta-blocker, MRA, and SGLT2 inhibitor', 'Loop diuretic for congestion; daily weights', 'Monitor potassium, sodium, and creatinine', 'BNP/NT-proBNP to support diagnosis and trends'],
    related: ['bnp', 'furosemide', 'lisinopril', 'metoprolol', 'empagliflozin', 'potassium', 'sodium', 'atrial-fibrillation'],
    url: topic('heartfailure.html'),
  }),
  condition('copd', 'COPD', {
    aliases: ['COPD', 'chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis', 'COPD exacerbation'],
    category: 'Pulmonary',
    summary: 'Persistent airflow limitation (post-bronchodilator FEV1/FVC < 0.7). Exacerbations drive decline; target SpO₂ 88–92% in CO₂ retainers.',
    patient: 'A long-term lung disease that makes it hard to breathe. Inhalers and avoiding smoke help.',
    signs: ['Shortness of breath, especially with activity', 'Long-lasting cough with mucus', 'Wheezing', 'Chest tightness'],
    risks: ['Smoking now or in the past', 'Secondhand smoke, dust, or chemical fumes', 'Alpha-1 antitrypsin deficiency'],
    urgent: ['Very short of breath, or the rescue inhaler is not helping', 'Lips or fingertips turning blue or gray', 'Confused or very drowsy (call 911)'],
    management: ['Maintenance LAMA and/or LABA; add ICS for frequent exacerbations with eosinophils ≥ 300', 'Exacerbation: short-acting bronchodilators, prednisone 40 mg for 5 days, antibiotics if sputum purulence increases', 'Smoking cessation, vaccinations, pulmonary rehab', 'Use opioids and sedatives cautiously'],
    related: ['albuterol', 'tiotropium', 'oxycodone'],
    url: topic('copd.html'),
  }),
  condition('stroke', 'Stroke', {
    aliases: ['CVA', 'cerebrovascular accident', 'TIA', 'transient ischemic attack', 'ischemic stroke'],
    category: 'Neurologic / Vascular',
    summary: 'Acute focal neurologic deficit from ischemia or hemorrhage. Time-critical: thrombolysis within 4.5 hours of last known well; thrombectomy for large vessel occlusion.',
    patient: 'Blood flow to part of the brain is blocked or a blood vessel bursts. Every minute counts: call 911.',
    signs: ['B – loss of balance', 'E – sudden vision changes in one or both eyes', 'F – face drooping on one side', 'A – arm or leg weakness on one side', 'S – slurred or strange speech', 'T – time to call 911'],
    risks: ['High blood pressure', 'Atrial fibrillation', 'Diabetes', 'Smoking', 'High cholesterol', 'Past stroke or TIA'],
    urgent: ['Any BE FAST sign, even if it goes away: call 911 and note the time it started'],
    management: ['Last-known-well time, glucose check, non-contrast CT', 'IV thrombolysis within 4.5 hours if eligible; thrombectomy for large vessel occlusion up to 24 hours in selected patients', 'Hold anticoagulants until hemorrhage is excluded; check INR', 'Secondary prevention: antithrombotic, statin, BP and glucose control; anticoagulate for AF'],
    related: ['atrial-fibrillation', 'hypertension', 'apixaban', 'warfarin', 'aspirin-low-dose', 'glucose', 'inr'],
    url: topic('stroke.html'),
  }),
  condition('atrial-fibrillation', 'Atrial fibrillation', {
    aliases: ['AF', 'AFib', 'a-fib'],
    category: 'Cardiac',
    summary: 'Irregular atrial rhythm that raises stroke risk about fivefold. Use CHA₂DS₂-VASc to guide anticoagulation; control rate or rhythm.',
    patient: 'An irregular heartbeat that can cause blood clots and raise the risk of stroke.',
    signs: ['Fluttering or pounding heartbeat', 'Tiredness', 'Shortness of breath', 'Dizziness', 'Some people have no symptoms'],
    risks: ['Older age', 'High blood pressure', 'Heart failure or valve disease', 'Sleep apnea, alcohol, thyroid disease', 'Recent surgery'],
    urgent: ['Stroke signs (BE FAST): call 911', 'Chest pain, fainting, or severe shortness of breath'],
    management: ['CHA₂DS₂-VASc ≥ 2 (men) or ≥ 3 (women): anticoagulate, DOAC preferred over warfarin except mechanical valve or moderate-severe mitral stenosis', 'Rate control with beta-blocker or non-dihydropyridine calcium blocker', 'Assess bleeding risk factors'],
    related: ['stroke', 'apixaban', 'warfarin', 'metoprolol', 'inr', 'heart-failure'],
    url: topic('atrialfibrillation.html'),
  }),
  condition('hypertension', 'High blood pressure', {
    aliases: ['hypertension', 'HTN', 'high blood pressure'],
    category: 'Cardiac',
    summary: 'ACC/AHA: stage 1 is 130–139/80–89 mmHg, stage 2 is ≥ 140/90. ≥ 180/120 with organ damage is a hypertensive emergency.',
    patient: 'Blood pressure that stays too high. It usually has no symptoms but raises the risk of stroke, heart attack, and kidney disease.',
    signs: ['Usually no symptoms', 'Very high readings may cause headache, vision changes, or chest pain'],
    risks: ['Family history', 'Older age', 'High-salt diet, alcohol, or less activity', 'Overweight', 'Diabetes or kidney disease'],
    urgent: ['Blood pressure 180/120 or higher with chest pain, shortness of breath, back pain, weakness, vision changes, or trouble speaking (call 911)'],
    management: ['Confirm with home or ambulatory readings', 'Goal < 130/80 for most adults', 'First-line: thiazide, ACE inhibitor or ARB, or calcium channel blocker; ACE inhibitor/ARB with diabetes and albuminuria', 'Lifestyle: sodium reduction, DASH diet, activity, alcohol limits'],
    related: ['lisinopril', 'metoprolol', 'stroke', 'ckd', 'heart-failure'],
    url: topic('highbloodpressure.html'),
  }),
  condition('ckd', 'Chronic kidney disease', {
    aliases: ['CKD', 'kidney disease', 'renal insufficiency'],
    category: 'Kidney',
    summary: 'eGFR < 60 or markers of kidney damage (such as albuminuria) for 3 months or more. Requires renal dose adjustment of many drugs.',
    patient: 'The kidneys slowly lose their ability to filter the blood. Diabetes and high blood pressure are the most common causes.',
    signs: ['Often no symptoms early on', 'Swelling in the legs or around the eyes', 'Tiredness', 'Urinating more or less than usual', 'Itchy skin or poor appetite in later stages'],
    risks: ['Diabetes', 'High blood pressure', 'Heart disease', 'Family history of kidney disease', 'Older age'],
    urgent: ['Very little or no urine', 'Severe shortness of breath or swelling', 'Confusion or chest pain'],
    management: ['Stage by eGFR and albuminuria (KDIGO)', 'ACE inhibitor or ARB for albuminuria; SGLT2 inhibitor for eligible patients', 'Avoid NSAIDs; renally dose metformin, enoxaparin, and antibiotics', 'Monitor potassium, bicarbonate, hemoglobin'],
    related: ['egfr', 'creatinine', 'bun', 'potassium', 'metformin', 'lisinopril', 'empagliflozin'],
    url: topic('chronickidneydisease.html'),
  }),
  condition('total-knee-replacement', 'Total knee replacement recovery', {
    aliases: ['TKA', 'TKR', 'total knee arthroplasty', 'knee replacement'],
    category: 'Post-op / Orthopedic',
    summary: 'Post-arthroplasty course: VTE prophylaxis, multimodal analgesia, early mobilization and PT. Watch for DVT/PE, SSI or PJI, and uncontrolled pain.',
    patient: 'Recovery after having your knee joint replaced. Some swelling and bruising are normal; some signs need a call.',
    signs: ['Expected: swelling, bruising, warmth, and stiffness around the knee for several weeks', 'Pain that slowly improves', 'Tiredness'],
    risks: ['Higher risk of problems with diabetes, obesity, smoking, or past blood clots'],
    urgent: ['Calf pain or swelling (possible blood clot)', 'Sudden shortness of breath or chest pain (call 911)', 'Fever, spreading redness, or drainage from the incision', 'Pain that is suddenly much worse or not controlled'],
    management: ['VTE prophylaxis per protocol (aspirin, DOAC, or LMWH), usually 10–35 days', 'Multimodal analgesia: acetaminophen, NSAID if appropriate, short opioid course', 'Early mobilization and physical therapy for range of motion', 'Wound checks; low threshold to evaluate for PJI'],
    related: ['dvt', 'pulmonary-embolism', 'surgical-site-infection', 'apixaban', 'enoxaparin', 'aspirin-low-dose', 'acetaminophen', 'oxycodone', 'hemoglobin', 'walker', 'cane'],
    url: topic('kneereplacement.html'),
  }),

  // ----- Assistive devices and daily-living aids -----
  device('walker', 'Walker', {
    aliases: ['walkers', 'rollator', 'front-wheeled walker', 'wheeled walker', 'walking frame', 'zimmer frame'],
    category: 'Mobility',
    summary: 'Standard, front-wheeled, or four-wheeled (rollator) frame that offloads the legs. Height set so the elbows bend about 15–30 degrees.',
    patient: 'A frame you hold with both hands to keep steady and take weight off a sore or weak leg.',
    use: [
      'Stand up first, then reach for the walker; do not pull on it to stand',
      'Move the walker a short step ahead, step in with the weaker or operated leg first, then the stronger leg',
      'Keep your back straight and stay inside the frame; do not push it too far ahead',
      'Handles should be level with your wrists when your arms hang down',
    ],
    precautions: [
      'Clear rugs, cords, and clutter from walkways; use night lights',
      'Lock the brakes on a rollator before sitting on its seat or standing up',
      'Do not use a walker on stairs or escalators',
      'Check rubber tips and wheels for wear; wear flat, non-slip shoes',
      'Carry things in a walker bag or basket, not in your hands',
    ],
    callIf: ['The walker feels too high, too low, or wobbly', 'You are more unsteady than before or need more support', FALL_CALL],
    clinical: [
      'PT to fit height and teach gait pattern; progress walker to cane as strength and balance allow',
      'Rollators need adequate hand function to brake; front-wheeled walkers suit most post-op patients',
      'Screen fall risk (history, orthostasis, sedating medications, vision)',
    ],
    related: ['total-knee-replacement', 'cane', 'stroke'],
    url: 'https://medlineplus.gov/ency/patientinstructions/000342.htm',
  }),
  device('cane', 'Cane', {
    aliases: ['canes', 'walking stick', 'quad cane', 'walking cane'],
    category: 'Mobility',
    summary: 'Single-point or quad cane for mild imbalance or unilateral weakness; held in the hand opposite the affected leg.',
    patient: 'A walking stick that gives a little extra balance and takes some weight off a sore or weak leg.',
    use: [
      'Hold the cane in the hand on your stronger side',
      'Move the cane and your weaker leg forward together, then step through with the stronger leg',
      'On stairs: up with the good leg first, down with the cane and the weaker leg first ("up with the good, down with the bad")',
      'The top of the cane should be level with your wrist crease when your arm hangs down',
    ],
    precautions: [
      'Replace a worn rubber tip; it is what keeps the cane from slipping',
      'Take extra care on wet, icy, or uneven ground',
      'Use the handrail on stairs whenever there is one',
    ],
    callIf: ['You need to lean on the cane more than before', 'Pain in your hand, wrist, or shoulder from using it', FALL_CALL],
    clinical: ['Indicated when weight-bearing tolerance and balance no longer require a walker', 'Offloads roughly 20–25% of body weight from the contralateral limb'],
    related: ['walker', 'total-knee-replacement'],
    url: 'https://medlineplus.gov/ency/patientinstructions/000343.htm',
  }),
  device('crutches', 'Crutches', {
    aliases: ['crutch', 'underarm crutches', 'forearm crutches', 'axillary crutches'],
    category: 'Mobility',
    summary: 'Axillary or forearm crutches for partial or non-weight-bearing gait. Axillary pads sit 1–2 inches below the armpit.',
    patient: 'A pair of supports that let you keep weight off an injured leg or foot while you walk.',
    use: [
      'Put your weight on your hands, not your armpits',
      'Move both crutches forward, then swing or step through with the good leg',
      'Follow your exact weight-bearing instructions for the injured leg',
      'On stairs, use a handrail and one crutch, or go up and down seated if unsure',
    ],
    precautions: [
      'Leaning on the armpit pads can injure nerves in the arm',
      'Check tips for wear; avoid wet floors and loose rugs',
      'Keep the injured leg elevated when resting to reduce swelling',
    ],
    callIf: ['Numbness or tingling in your hands or arms', 'You cannot keep to your weight-bearing limits', FALL_CALL],
    clinical: ['Document weight-bearing status (NWB, TTWB, PWB, WBAT)', 'Requires upper-body strength and balance; consider a walker or knee scooter for frail patients'],
    related: ['walker', 'diabetic-foot-ulcer'],
    url: topic('mobilityaids.html'),
  }),
  device('wheelchair', 'Wheelchair', {
    aliases: ['wheelchairs', 'manual wheelchair', 'power wheelchair', 'power chair', 'transport chair'],
    category: 'Mobility',
    summary: 'Manual or power wheelchair; fit, cushion, and pressure-relief routine prevent pressure injuries and shoulder overuse.',
    patient: 'A chair on wheels for getting around when walking is not possible or safe.',
    use: [
      'Lock both brakes before getting in or out, and swing the footrests out of the way',
      'Shift your weight or do a pressure lift about every 15–30 minutes',
      'Sit all the way back with feet supported and hips level',
    ],
    precautions: [
      'Check your skin every day, especially your bottom, hips, and heels, for red spots that do not fade',
      'Keep the cushion inflated or set correctly; never sit directly on the sling',
      'Check tire pressure and brakes regularly; charge a power chair every night',
      'Use ramps, not curbs, and go down steep slopes slowly or with help',
    ],
    callIf: ['A red or dark area on the skin that does not fade within 30 minutes, or any open sore', 'New shoulder, wrist, or back pain from pushing', 'The chair or cushion no longer fits well'],
    clinical: [
      'Seating assessment by PT/OT; pressure-mapping where available',
      'For spinal cord injury, review autonomic dysreflexia, bladder and bowel programs, and skin checks',
    ],
    related: ['assistive-device'],
    url: topic('mobilityaids.html'),
  }),
  device('hearing-aids', 'Hearing aids', {
    aliases: ['hearing aid', 'hearing device', 'cochlear implant', 'hearing amplifier'],
    category: 'Hearing',
    summary: 'Behind-the-ear or in-ear amplification. Ask about them on admission; missing aids hinder communication and can mimic confusion.',
    patient: 'Small devices worn in or behind the ear that make sounds louder and clearer.',
    use: [
      'Wear them every day, starting with a few hours if they are new',
      'Clean them daily with a soft, dry cloth or the brush that came with them',
      'Take them out for showers, swimming, and sleep; open the battery door overnight or charge them',
    ],
    precautions: [
      'Keep away from water, heat, and hair spray',
      'Keep batteries away from children and pets; swallowed button batteries are an emergency',
      'Tell staff you use hearing aids during a hospital stay or procedure so they are not lost',
    ],
    callIf: ['Ear pain, itching, drainage, or a sore from the fit', 'Sudden change or loss of hearing', 'Whistling or feedback that cleaning does not fix'],
    clinical: ['Document side and type; store in a labeled case during admission', 'Sudden sensorineural hearing loss needs urgent ENT review'],
    related: ['assistive-device'],
    url: topic('hearingaids.html'),
  }),
  device('dentures', 'Dentures', {
    aliases: ['denture', 'false teeth', 'partial denture', 'partials', 'upper denture', 'lower denture', 'dental plate'],
    category: 'Dental',
    summary: 'Full or partial removable prostheses. Poor fit affects nutrition and speech; remove and store before procedures and imaging.',
    patient: 'Removable replacement teeth, either a full set or a partial that clips onto your own teeth.',
    use: [
      'Take them out and rinse after eating',
      'Brush them every day with a soft brush and denture cleaner, not regular toothpaste',
      'Take them out at night and keep them moist in water or a soaking solution',
      'Brush your gums, tongue, and any natural teeth too',
    ],
    precautions: [
      'Never use hot water; it can warp them',
      'Clean over a folded towel or a basin of water in case you drop them',
      'Do not try to adjust or repair them yourself',
      'Tell staff you wear dentures before surgery or a scan',
    ],
    callIf: ['Sore spots, bleeding, or ulcers on your gums', 'They feel loose, click, or make chewing hard', 'Trouble eating enough because of pain'],
    clinical: ['Remove before intubation, sedation, and MRI; store in a labeled cup', 'Ill-fitting dentures contribute to weight loss and aspiration risk'],
    related: ['assistive-device'],
    url: topic('dentures.html'),
  }),
  device('eyeglasses', 'Glasses and contact lenses', {
    aliases: ['glasses', 'eyeglasses', 'reading glasses', 'bifocals', 'contact lenses', 'contacts'],
    category: 'Vision',
    summary: 'Corrective lenses. Uncorrected vision is a modifiable fall risk; multifocal lenses can impair stair and curb judgment.',
    patient: 'Lenses that help you see clearly, worn on your face or on your eyes.',
    use: [
      'Keep your glasses within reach of your bed, especially at night',
      'Clean lenses with lens cleaner and a microfiber cloth',
      'Follow your eye doctor’s schedule for wearing and replacing contact lenses',
    ],
    precautions: [
      'Bifocals and progressives can blur steps and curbs; look straight down by tipping your head',
      'Never sleep or shower in contact lenses unless your eye doctor says it is safe',
      'Get your eyes checked if things seem blurry; old prescriptions raise the chance of falling',
    ],
    callIf: ['Sudden vision loss, flashes of light, or a curtain over your vision (get help right away)', 'Red, painful eye while wearing contact lenses'],
    clinical: ['Include vision in fall-risk screening; single-vision distance lenses may be safer for walking outdoors'],
    related: ['assistive-device'],
    url: topic('eyewear.html'),
  }),
  device('bathroom-safety', 'Bathroom safety equipment', {
    aliases: ['shower chair', 'shower bench', 'tub transfer bench', 'grab bar', 'grab bars', 'raised toilet seat', 'toilet riser', 'bedside commode', 'commode'],
    category: 'Home safety',
    summary: 'Shower chairs, tub benches, grab bars, raised toilet seats, and commodes reduce falls in the highest-risk room of the house.',
    patient: 'Seats, rails, and raised toilet seats that make bathing and using the toilet safer.',
    use: [
      'Sit to shower if standing is tiring or unsteady',
      'Hold grab bars, not towel racks or the sink, when you stand or sit',
      'Use a raised toilet seat if your hips or knees should not bend deeply',
    ],
    precautions: [
      'Grab bars must be screwed into wall studs; suction-cup bars can come loose',
      'Use a non-slip mat inside and outside the tub, and dry the floor',
      'Check that seat legs are level and the rubber feet are not worn',
      'Keep a night light on the way to the bathroom',
    ],
    callIf: ['A near-fall or fall in the bathroom', 'You cannot get on or off the toilet or in and out of the tub safely'],
    clinical: ['OT home-safety evaluation; raised seat for post-arthroplasty hip and knee precautions'],
    related: ['walker', 'total-knee-replacement'],
    url: topic('falls.html'),
  }),
  device('daily-living-aids', 'Dressing and reaching aids', {
    aliases: ['reacher', 'grabber', 'reaching tool', 'sock aid', 'long-handled shoe horn', 'long handled sponge', 'dressing stick', 'adaptive utensils'],
    category: 'Daily living',
    summary: 'Reachers, sock aids, long-handled sponges and shoe horns, and adaptive utensils support independence within movement precautions.',
    patient: 'Tools that help you dress, bathe, reach, and eat without bending or twisting too far.',
    use: [
      'Use a reacher to pick things up from the floor instead of bending',
      'A sock aid and long shoe horn let you dress without bending your hip or knee deeply',
      'Keep everyday items between waist and shoulder height so you need these tools less',
    ],
    precautions: [
      'Do not use a reacher for heavy items, sharp objects, or anything above your head',
      'Sit down to dress your lower body',
    ],
    callIf: ['Dressing or bathing is getting harder', 'You need a tool you do not have'],
    clinical: ['OT to train and supply per hip, knee, or spine precautions'],
    related: ['total-knee-replacement', 'bathroom-safety'],
    url: topic('assistivedevices.html'),
  }),
  device('home-oxygen', 'Home oxygen', {
    aliases: ['oxygen', 'oxygen concentrator', 'oxygen tank', 'portable oxygen', 'nasal cannula', 'supplemental oxygen'],
    category: 'Breathing',
    summary: 'Long-term oxygen therapy by concentrator or cylinder, prescribed by flow (L/min) and hours. Fire risk and tubing trips are the main hazards.',
    patient: 'Extra oxygen breathed through a nose tube or mask from a machine or tank at home.',
    use: [
      'Use the flow rate and hours your care team prescribed; do not turn it up on your own',
      'Wash the nasal cannula as directed and replace tubing on schedule',
      'Keep a backup tank charged or full in case the power goes out',
    ],
    precautions: [
      'Never smoke or let anyone smoke near oxygen; keep it at least 6 feet from flames, stoves, and candles',
      'Do not use oil-based lotions or petroleum jelly on your face; use water-based products',
      'Keep tubing out of walkways so you do not trip',
      'Tell your power company and fire department you use home oxygen',
    ],
    callIf: ['More short of breath than usual, or lips and fingertips turn blue (call 911 if severe)', 'Headache, confusion, or unusual sleepiness', 'Nosebleeds or sores from the cannula'],
    clinical: ['Titrate to SpO2 88–92% in COPD with hypercapnia risk', 'Re-certify need per payer rules; check smoking status'],
    related: ['copd', 'heart-failure'],
    url: topic('oxygentherapy.html'),
  }),
  device('cpap', 'CPAP machine', {
    aliases: ['CPAP', 'BiPAP', 'APAP', 'sleep apnea machine', 'breathing machine for sleep'],
    category: 'Breathing',
    summary: 'Positive airway pressure for obstructive sleep apnea. Bring it to the hospital; post-op opioids worsen untreated apnea.',
    patient: 'A bedside machine that blows gentle air through a mask to keep your airway open while you sleep.',
    use: [
      'Use it every night and for naps, for the whole time you sleep',
      'Wash the mask, tubing, and water chamber as the instructions say',
      'Use distilled water in the humidifier',
    ],
    precautions: [
      'Bring your machine to the hospital or any overnight stay',
      'Opioid pain medicines and sleeping pills make apnea worse; always use CPAP when taking them',
      'Replace cushions and filters on schedule for a good seal',
    ],
    callIf: ['The mask leaks or causes sores', 'You still snore, feel very sleepy in the day, or wake gasping', 'Nosebleeds or a very dry mouth'],
    clinical: ['Continue CPAP peri-operatively; extra monitoring with opioids (STOP-BANG)'],
    related: ['oxycodone', 'heart-failure', 'atrial-fibrillation'],
    url: topic('sleepapnea.html'),
  }),
  device('compression-stockings', 'Compression stockings', {
    aliases: ['compression socks', 'TED hose', 'TED stockings', 'support stockings'],
    category: 'Circulation',
    summary: 'Graduated compression for edema and venous insufficiency, or anti-embolism stockings in hospital. Check fit and skin.',
    patient: 'Snug stockings that gently squeeze your legs to help blood flow and reduce swelling.',
    use: [
      'Put them on in the morning before your legs swell',
      'Smooth out every wrinkle; do not roll or fold down the top band',
      'Wash them by hand and air-dry; replace them every 3–6 months',
    ],
    precautions: [
      'Take them off and check your skin every day, especially heels and shins',
      'Do not wear them if they cause pain, numbness, or color change in your toes',
      'Ask first if you have poor circulation in your legs or diabetes with numb feet',
    ],
    callIf: ['Blisters, sores, or marks that do not fade', 'Toes turn pale, blue, cold, or numb', 'New calf pain or swelling in one leg'],
    clinical: ['Check ABI before therapeutic compression if arterial disease is suspected', 'Not a substitute for pharmacologic VTE prophylaxis'],
    related: ['dvt', 'heart-failure'],
    url: topic('dvt.html'),
  }),
  device('medical-alert', 'Medical alert button', {
    aliases: ['medical alert', 'personal emergency response system', 'PERS', 'life alert', 'fall alarm', 'fall detection'],
    category: 'Home safety',
    summary: 'Wearable personal emergency response device, often with automatic fall detection. Valuable for patients who live alone.',
    patient: 'A button you wear that calls for help if you fall or cannot reach a phone.',
    use: [
      'Wear it all the time, including in the shower if it is waterproof',
      'Test it once a month and keep it charged',
      'Keep your emergency contact list with the company up to date',
    ],
    precautions: ['Make sure it works in every room you use, and outside if you go out alone'],
    callIf: ['You fell and could not get up, even if help came', 'The device stopped working'],
    clinical: ['Consider for patients living alone with falls, syncope, or hypoglycemia risk'],
    related: ['walker', 'assistive-device'],
    url: topic('falls.html'),
  }),
  device(DEVICE_FALLBACK_SLUG, 'Assistive device (general)', {
    aliases: ['assistive device', 'mobility aid', 'medical equipment', 'adaptive equipment', 'durable medical equipment', 'DME'],
    category: 'General',
    summary: 'General use and safety guidance for durable medical equipment and daily-living aids without a specific entry.',
    patient: 'General tips for any equipment that helps you move, hear, see, eat, or care for yourself.',
    use: [
      'Learn to use it with your nurse, therapist, or supplier before relying on it alone',
      'Follow the instructions that came with it for setup, cleaning, and charging',
      'Keep it where you will use it, and keep the supplier’s phone number handy',
    ],
    precautions: [
      'Check it often for loose parts, worn tips or pads, and damage',
      'Do not change or repair it yourself',
      'Bring it, or tell staff about it, when you go to the hospital or a clinic',
    ],
    callIf: ['It no longer fits, hurts, or causes skin marks', 'It stops working the way it should', FALL_CALL],
    clinical: ['Refer to PT/OT for fit and training; document device and settings on the chart'],
    related: ['walker', 'bathroom-safety'],
    url: topic('assistivedevices.html'),
  }),
];

// ---------------------------------------------------------------------------
// openFDA label import (pure helpers; the scheduled procedure does the I/O)
// ---------------------------------------------------------------------------

/** Longest section body kept from an FDA label. */
export const FDA_SECTION_MAX_CHARS = 4000;

/** openFDA label fields worth keeping, in display order. */
export const FDA_FIELDS = [
  { field: 'indications_and_usage', heading: 'Indications and usage', patient: false },
  { field: 'boxed_warning', heading: 'Boxed warning', patient: false },
  { field: 'warnings_and_precautions', heading: 'Warnings and precautions', patient: false },
  { field: 'adverse_reactions', heading: 'Adverse reactions', patient: false },
  { field: 'drug_interactions', heading: 'Drug interactions', patient: false },
  { field: 'information_for_patients', heading: 'Information for patients', patient: true },
] as const;

/** One openFDA label result; only the fields we read are typed. */
export type FdaLabelResult = {
  openfda?: { generic_name?: string[]; brand_name?: string[]; spl_setid?: string[] };
} & Record<string, unknown>;

const labelArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

/** openFDA label query for a medication name. */
export const fdaLabelUrl = (name: string) =>
  `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`openfda.generic_name:"${name}"`)}&limit=10`;

/**
 * Pick the label row that matches the entry best: an exact generic-name match
 * first (so fixed-dose combinations rank below the single-ingredient product),
 * then a generic name that starts with the entry name, then the first row.
 */
export function pickFdaResult(results: FdaLabelResult[], name: string): FdaLabelResult | undefined {
  if (results.length === 0) return undefined;
  const target = name.toLowerCase().trim();
  let exact: FdaLabelResult | undefined;
  let prefix: FdaLabelResult | undefined;
  for (const r of results) {
    for (const g of labelArray(r.openfda?.generic_name)) {
      const v = g.toLowerCase().trim();
      if (v === target) exact = exact ?? r;
      else if (!prefix && v.startsWith(target)) prefix = r;
    }
  }
  return exact ?? prefix ?? results[0];
}

/** Turn one FDA label row into library sections: prefixed, whitespace-collapsed, truncated. */
export function fdaSections(result: FdaLabelResult): LibSectionData[] {
  const out: LibSectionData[] = [];
  for (const f of FDA_FIELDS) {
    const body = labelArray(result[f.field])
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, FDA_SECTION_MAX_CHARS);
    if (body) {
      out.push({ heading: `${FDA_SECTION_PREFIX}${f.heading}`, body, patient: f.patient });
    }
  }
  return out;
}
