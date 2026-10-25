import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
} from 'spacetimedb/server';
import { ScheduleAt, TimeDuration, Timestamp, type Identity } from 'spacetimedb';
import { MeshyError, pollMeshyTask, submitMeshyTask, type MeshyFetch } from './meshy';
import { DEMO_ASSESSMENTS, DEMO_DEVICES, DEMO_MENTAL_HEALTH, EXAMPLE_APPOINTMENTS, EXAMPLE_CHECK_INS } from './examples';
import {
  APPT_DURATIONS,
  APPT_KIND_LABEL,
  APPT_LOCATION_MAX,
  APPT_NOTES_MAX,
  APPT_TITLE_MAX,
  demoWhen,
  isApptKind,
  isApptMode,
  isApptStatus,
  overlaps,
  type ApptKind,
  type ApptMode,
} from './appointments';
import {
  MH_KIND_LABEL,
  MH_MAX_SCORE,
  isCrisisNote,
  isMhKind,
  mhBand,
  mhRules,
} from './mentalHealth';
import { canPostToChannel, cleanMessageBody, isMessageChannel } from './messages';
import {
  DEMO_HEALTH,
  DEVICE_KINDS,
  METRIC,
  healthDigest,
  healthRules,
  pairedDeviceHistory,
  type DemoSample,
  type HealthPoint,
} from './health';
import {
  BITDEER_CHAT_URL,
  DEFAULT_UNCERTAINTY_MODEL,
  ML_RISK_PRIORITY,
  REASON_LABEL,
  SCENARIOS,
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_TOOL,
  parseUncertainties,
  priorityRank,
  uncertaintyRequestBody,
  regionText,
  simulateVitals,
  symptomRules,
  usesWheelchair,
  vitalRules,
  type RuleHit,
} from './clinical';
import {
  DOSE_KEEP_MICROS,
  DUE_EARLY_MICROS,
  MED_KINDS,
  MED_KIND_LABEL,
  MED_PRESETS,
  MISSED_AFTER_MICROS,
  doseRules,
  doseSlots,
  glucoseRules,
  normalizeTimes,
  scheduleLabel,
  timesForSchedule,
} from './medication';
import {
  DEVICE_FALLBACK_SLUG,
  FDA_SECTION_PREFIX,
  HISTORY_CATEGORIES,
  LIBRARY,
  LIB_KINDS,
  fdaLabelUrl,
  fdaSections,
  isCritical,
  labFlag,
  matchEntry,
  pickFdaResult,
  slugify,
  type FdaLabelResult,
  type LibSectionData,
} from './library';
import {
  EXERCISE_INTENSITIES,
  NURSE_ONLY_KINDS,
  VOICE_ITEM_KINDS,
  VOICE_MAX_ITEMS,
  VOICE_MAX_REPLY,
  VOICE_MAX_TRANSCRIPT,
  VOICE_SYSTEM_PROMPT,
  VOICE_TOOL,
  normalizeCandidates,
  parseVoiceLocally,
  regionPoint,
  replyVoiceLocally,
  type VoiceAlertFact,
  type VoiceCandidate,
  type VoiceContext,
  type VoiceItemKind,
  type VoiceMedFact,
} from './voice';
import { parseLayout, serializeLayout } from './layout';
import {
  FAMILY_LOCK_MICROS,
  FAMILY_MAX_FAILED_LOGINS,
  FAMILY_MAX_MEMBERS,
  FAMILY_MAX_NAME,
  RELATIONSHIPS,
  bytesToHex,
  familyMessage,
  hashFamilyPassword,
  isFamilyAlertLevel,
  isValidEmail,
  makeInviteCode,
  normalizeEmail,
  normalizeInviteCode,
  passwordProblem,
  sameDigest,
  shouldNotifyFamily,
} from './family';
import * as RISK_MODEL from './riskModelData';
import { levelFor, scoreRisk, type Driver, type HourRow } from './riskModel';
import {
  assessmentLabel,
  isAssessmentStatus,
  isAssessmentSystem,
  latestBySystem,
  statusLabel,
} from './assessment';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const userProfile = table(
  { name: 'user_profile', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    role: t.string(), // 'patient' | 'nurse' | 'family'
    patientId: t.u64(), // the patient followed; 0 for nurses
    online: t.bool(),
  }
);

const patient = table(
  { name: 'patient', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    age: t.u32(),
    procedure: t.string(),
    side: t.string(), // 'left' | 'right'
    surgeryAt: t.timestamp(),
    twinUrl: t.string(), // empty = procedural reference body
    createdAt: t.timestamp(),
  }
);

const simState = table(
  { name: 'sim_state', public: true },
  {
    patientId: t.u64().primaryKey(),
    scenario: t.string(),
    tick: t.u32(),
    steps: t.u32(), // legacy column retained to avoid a destructive table migration
  }
);

const symptomEntry = table(
  { name: 'symptom_entry', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    region: t.string(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    onset: t.string(),
    provocation: t.string(),
    quality: t.string(),
    radiation: t.string(),
    severity: t.u8(),
    timing: t.string(),
    swelling: t.bool(),
    warmth: t.bool(),
    redness: t.bool(),
    shortnessOfBreath: t.bool(),
    chestPain: t.bool(),
    bodyTempC: t.f32(), // 0 = not measured
    notes: t.string(),
    source: t.string(), // 'tap' | 'voice' | 'nurse'
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

/** Five standard vital signs from the simulated Twin Pod. */
const vitalSign = table(
  { name: 'vital_sign', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    ts: t.timestamp(),
    hr: t.f32(),
    systolic: t.f32(),
    diastolic: t.f32(),
    respRate: t.f32(),
    spo2: t.f32(),
    tempC: t.f32(),
    source: t.string(), // 'sim' | 'phone' | 'voice'
    // Self-reported fingerstick glucose. 0 means the reading was not taken.
    // Appended last so the column order stays additive for migrations.
    glucoseMgDl: t.f32().default(0),
  }
);

/** Latest deterioration-model score per patient. Advisory; shown to nurses only. */
const riskScore = table(
  { name: 'risk_score', public: true },
  {
    patientId: t.u64().primaryKey(),
    prob: t.f64(), // calibrated chance of sepsis onset within 6 hours
    level: t.string(), // 'low' | 'elevated' | 'high'
    drivers: t.string(), // JSON Driver[] (label, value, effect in log-odds)
    history: t.string(), // JSON number[] of recent scores, oldest first
    hours: t.u32(), // readings in the model's window
    updatedAt: t.timestamp(),
  }
);

// Legacy knee-specific pod table, no longer written; retained to avoid a destructive migration.
const vitalSample = table(
  { name: 'vital_sample', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    ts: t.timestamp(),
    hr: t.f32(),
    spo2: t.f32(),
    incisionTempC: t.f32(),
    calfTempC: t.f32(),
    kneeFlexDeg: t.f32(),
    steps: t.u32(),
    source: t.string(), // 'sim' | 'phone'
  }
);

const alert = table(
  { name: 'alert', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    priority: t.string(), // routine | review_24h | same_day | emergency
    rank: t.u8(),
    reasonCodes: t.string(), // comma-separated
    status: t.string(), // open | acknowledged | escalated | resolved
    createdAt: t.timestamp(),
    ackedAt: t.option(t.timestamp()),
    ackedByName: t.string(),
    raisedBy: t.string(), // 'rules' | 'rules+claude'
  }
);

const sbarReport = table(
  { name: 'sbar_report', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    alertId: t.u64().unique(),
    patientId: t.u64().index('btree'),
    status: t.string(), // pending | draft | approved | error
    model: t.string(),
    suggestedPriority: t.string(),
    situation: t.string(),
    background: t.string(),
    assessment: t.string(),
    recommendation: t.string(),
    uncertainties: t.string(), // newline-separated
    questions: t.string(), // newline-separated
    draftSnapshot: t.string(), // AI draft as generated, for edit-rate metrics
    editedByNurse: t.bool(),
    approvedByName: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const auditEvent = table(
  { name: 'audit_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    actorName: t.string(),
    action: t.string(),
    detail: t.string(),
    ts: t.timestamp(),
  }
);

const presence = table(
  { name: 'presence', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    role: t.string(),
    patientId: t.u64(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    pointing: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const simTimer = table(
  { name: 'sim_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const sbarJob = table(
  { name: 'sbar_job' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    sbarId: t.u64(),
  }
);

// Private: holds the patient photo only until it has been submitted to Meshy.
const twinJob = table(
  { name: 'twin_job' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    patientId: t.u64(),
    photo: t.string(),
    statusUrl: t.string(),
    responseUrl: t.string(), // legacy column retained to avoid a destructive table migration
    attempt: t.u32(),
  }
);

const twinStatus = table(
  { name: 'twin_status', public: true },
  {
    patientId: t.u64().primaryKey(),
    status: t.string(), // queued | generating | ready | error
    detail: t.string(),
    updatedAt: t.timestamp(),
  }
);

const medication = table(
  { name: 'medication', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    name: t.string(),
    dose: t.string(),
    schedule: t.string(), // Once daily | Twice daily | Three times daily | As needed
    createdAt: t.timestamp(),
    kind: t.string(), // see MED_KINDS
    route: t.string(),
    instructions: t.string(),
    sideEffects: t.string(), // newline-separated
    contraindications: t.string(), // newline-separated
    scheduleTimes: t.string(), // normalized local "HH:MM,HH:MM"
    tzOffsetMin: t.i32(), // Date#getTimezoneOffset of the prescriber's clock
    remindersOn: t.bool(),
    requiresGlucose: t.bool(),
    active: t.bool(),
    prescribedBy: t.string(),
    updatedAt: t.timestamp(),
  }
);

/** One row per scheduled dose, created shortly before it is due. */
const medDose = table(
  { name: 'med_dose', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    slotKey: t.string().unique(), // `${medicationId}:${scheduledMicros}`
    medicationId: t.u64().index('btree'),
    patientId: t.u64().index('btree'),
    scheduledFor: t.timestamp(),
    status: t.string(), // due | taken | skipped | missed
    glucoseMgDl: t.f32(), // 0 = not measured
    note: t.string(),
    loggedAt: t.option(t.timestamp()),
    loggedBy: t.string(),
  }
);

const medTimer = table(
  { name: 'med_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

/** Reference-library entry: a curated or clinician-added medication, lab, or condition. */
const libraryEntry = table(
  { name: 'library_entry', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    slug: t.string().unique(),
    kind: t.string(), // see LIB_KINDS
    name: t.string(),
    aliases: t.string(), // comma-separated
    category: t.string(),
    summary: t.string(),
    patientSummary: t.string(),
    unit: t.string(),
    refLow: t.option(t.f32()), // reference range; unset when the library has no range
    refHigh: t.option(t.f32()),
    criticalLow: t.option(t.f32()),
    criticalHigh: t.option(t.f32()),
    related: t.string(), // comma-separated slugs
    sourceName: t.string(),
    sourceUrl: t.string(),
    curated: t.bool(),
    updatedBy: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

/** One section of a library entry write-up; patient sections are patient-visible. */
const librarySection = table(
  { name: 'library_section', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    entryId: t.u64().index('btree'),
    position: t.u8(),
    heading: t.string(),
    body: t.string(),
    patient: t.bool(),
  }
);

/** A lab result entered by a clinician, flagged against the library's reference range. */
const labResult = table(
  { name: 'lab_result', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    slug: t.string(), // matched library lab, '' when unknown
    name: t.string(), // display name
    value: t.f32(),
    unit: t.string(),
    flag: t.string(), // '' | normal | low | high | critical_low | critical_high
    notes: t.string(),
    resultedAt: t.timestamp(),
    enteredBy: t.string(),
    createdAt: t.timestamp(),
  }
);

/** One item of past medical, surgical, allergy, family, or social history. */
const historyItem = table(
  { name: 'history_item', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    category: t.string(), // see HISTORY_CATEGORIES
    title: t.string(),
    detail: t.string(),
    whenText: t.string(), // free text, e.g. '2019' or 'childhood'
    slug: t.string(), // matched library condition, '' when unknown
    createdBy: t.string(),
    createdAt: t.timestamp(),
  }
);

/** An assistive device or daily-living aid on the chart: walker, hearing aids, home oxygen. */
const assistiveDevice = table(
  { name: 'assistive_device', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    slug: t.string(), // matched library device; the general entry when unknown
    name: t.string(), // display name, e.g. 'Front-wheeled walker'
    detail: t.string(), // free text: settings, supplier, notes
    sinceText: t.string(), // free text, e.g. 'day 1 after surgery' or '2019'
    createdBy: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    // Reconciliation: who last confirmed the device is in use; '' while it still needs confirming.
    confirmedBy: t.string().default(''),
    confirmedAt: t.timestamp().default(new Timestamp(0n)),
  }
);

/** One head-to-toe system finding recorded by a nurse, often from a tap on the 3D twin. */
const systemAssessment = table(
  { name: 'system_assessment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    system: t.string(), // see ASSESSMENT_SYSTEMS
    status: t.string(), // normal | abnormal | deferred
    findings: t.string(),
    region: t.string(), // twin region the nurse tapped, '' when from the list
    assessedBy: t.string(),
    assessedAt: t.timestamp(),
    createdAt: t.timestamp(),
  }
);

/**
 * One mental-health check-in: a PHQ-9 or GAD-7 screening, or a bipolar mood day.
 * Red-flag rules (item 9, severe scores, activation patterns, crisis wording)
 * raise care-team alerts the moment a row is written.
 */
const mentalHealthCheckIn = table(
  { name: 'mental_health_check_in', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    kind: t.string(), // 'mood' | 'phq9' | 'gad7' — see MH_KINDS
    score: t.i32(), // mood: -3..3; phq9: 0..27; gad7: 0..21
    band: t.string(), // severity band label, '' for mood
    item9: t.u8(), // PHQ-9 thoughts-of-self-harm answer, 0..3; 0 otherwise
    sleepHours: t.f32(), // mood day hours of sleep; 0 when not answered
    notes: t.string(),
    createdBy: t.string(),
    source: t.string(), // 'patient' | 'nurse' | 'demo'
    createdAt: t.timestamp(),
  }
);

/**
 * One booked visit, call, lab draw, or therapy session. Patients book on their own
 * chart and the nurse on any chart; booked rows may not overlap for the same patient,
 * so the schedule stays coordinated without a separate availability system.
 */
const appointment = table(
  { name: 'appointment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    title: t.string(),
    kind: t.string(), // see APPT_KINDS
    whenAt: t.timestamp(),
    durationMin: t.u32(),
    mode: t.string(), // see APPT_MODES
    location: t.string(),
    notes: t.string(),
    status: t.string(), // see APPT_STATUSES
    createdBy: t.string(),
    createdAt: t.timestamp(),
  }
);

// Private: one row per pending openFDA label import.
const libImportJob = table(
  { name: 'lib_import_job' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    entryId: t.u64(),
  }
);

/** One spoken sentence being turned into proposed record updates. */
const voiceDraft = table(
  { name: 'voice_draft', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    transcript: t.string(),
    status: t.string(), // parsing | ready | error | dismissed
    model: t.string(),
    note: t.string(),
    createdBy: t.identity(),
    createdByName: t.string(),
    createdAt: t.timestamp(),
    // Spoken answer when the sentence was a question rather than an update.
    reply: t.string().default(''),
  }
);

/** One proposed update inside a draft. Nothing is written to the record until it is confirmed. */
const voiceItem = table(
  { name: 'voice_item', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    draftId: t.u64().index('btree'),
    position: t.u32(),
    kind: t.string(), // symptom | vitals | dose | lab | history
    label: t.string(),
    target: t.string(), // app section that will show it
    detail: t.string(), // JSON payload applied on confirm
    confidence: t.string(),
    decision: t.string(), // pending | confirmed | rejected
    decidedByName: t.string(),
    decidedAt: t.option(t.timestamp()),
  }
);

// Private: schedules the Claude parse for one voice draft.
const voiceJob = table(
  { name: 'voice_job' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    draftId: t.u64(),
  }
);

/**
 * One tab arrangement per patient, shared by the patient and nurse views so both sides
 * agree on which tabs matter. `tabs` is a JSON array; see layout.ts for the shape.
 */
const patientLayout = table(
  { name: 'patient_layout', public: true },
  {
    patientId: t.u64().primaryKey(),
    tabs: t.string(),
    goal: t.string(),
    assessed: t.bool(),
    updatedBy: t.string(),
    updatedAt: t.timestamp(),
  }
);

/** Diet, fluid, and sleep entries: the everyday habits a patient can log. */
const lifestyleEntry = table(
  { name: 'lifestyle_entry', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    kind: t.string(), // 'diet' | 'sleep'
    summary: t.string(),
    amount: t.string(), // fluids or portion, free text
    hours: t.f32(), // sleep only; 0 = not stated
    whenText: t.string(),
    source: t.string(), // 'form' | 'voice'
    createdBy: t.string(),
    createdAt: t.timestamp(),
  }
);

/** One reading or daily total from a wearable, an import, or a manual log (see health.ts METRICS). */
const healthSample = table(
  { name: 'health_sample', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    metric: t.string(),
    value: t.f64(), // canonical unit from the catalog
    label: t.string(), // medication name, workout type, mood word, ECG result
    startAt: t.timestamp(),
    endAt: t.timestamp(),
    source: t.string(), // apple_health | google_health | manual
    device: t.string(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

/** One workout: a slot in the weekly plan, or a session that was actually done. */
const exerciseEntry = table(
  { name: 'exercise_entry', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    status: t.string(), // 'planned' | 'done'
    activity: t.string(), // Run, Walk, Yoga, Swim, Strength, ...
    minutes: t.u32(),
    intensity: t.string(), // 'light' | 'moderate' | 'hard'
    day: t.u8(), // planned: weekday 0-6, Monday first; done: the day it happened
    note: t.string(),
    source: t.string(), // 'form' | 'voice'
    createdBy: t.string(),
    createdAt: t.timestamp(),
  }
);

/** A family member the patient has authorised. Status: invited | active | revoked. */
const familyAccess = table(
  { name: 'family_access', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    memberName: t.string(),
    relationship: t.string(),
    alertLevel: t.string(), // 'major' | 'urgent'
    canViewChart: t.bool(),
    status: t.string(),
    memberIdentity: t.option(t.identity()),
    createdAt: t.timestamp(),
    acceptedAt: t.option(t.timestamp()),
  }
);

/** Private: an unused invite code would let anyone join if it were readable. */
const familyInviteCode = table(
  { name: 'family_invite_code' },
  {
    code: t.string().primaryKey(),
    accessId: t.u64().unique(),
  }
);

/** One notice per family member per alert event, in plain language. */
const familyAlert = table(
  { name: 'family_alert', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    accessId: t.u64().index('btree'),
    patientId: t.u64().index('btree'),
    alertId: t.u64(),
    event: t.string(), // opened | raised | resolved
    priority: t.string(),
    title: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
    readAt: t.option(t.timestamp()),
  }
);

/**
 * Private: lets an authorised family member sign back in on another device.
 * Only a salted, stretched hash of the password is kept.
 */
const familyLogin = table(
  { name: 'family_login' },
  {
    email: t.string().primaryKey(),
    memberIdentity: t.identity().unique(),
    salt: t.string(),
    passwordHash: t.string(),
    failedCount: t.u32(),
    lockedUntil: t.option(t.timestamp()),
    createdAt: t.timestamp(),
  }
);

/**
 * Private: the last failed sign-in per browser. A failed attempt must still be counted,
 * so the reducer records it here instead of throwing (which would roll the count back).
 */
const familySigninAttempt = table(
  { name: 'family_signin_attempt' },
  {
    identity: t.identity().primaryKey(),
    message: t.string(),
    at: t.timestamp(),
  }
);

/** One private conversation per patient: the patient, the nurse, and approved family. */
const careMessage = table(
  { name: 'care_message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    author: t.identity(),
    authorName: t.string(),
    authorRole: t.string(), // 'patient' | 'nurse' | 'family'
    body: t.string(),
    createdAt: t.timestamp(),
    channel: t.string().default('team'), // 'team' | 'nurse' | 'family'
  }
);

/** Each signed-in user's own tab arrangement for their console (nurse, etc.). */
const userLayout = table(
  { name: 'user_layout', public: true },
  {
    identity: t.identity().primaryKey(),
    tabs: t.string(),
    updatedAt: t.timestamp(),
  }
);

const healthDevice = table(
  { name: 'health_device', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    kind: t.string(), // apple_watch | fitbit | pixel_watch | smart_scale | bp_cuff | glucose_monitor | apple_health | google_health
    name: t.string(),
    source: t.string(),
    demo: t.bool(),
    connectedAt: t.timestamp(),
    lastSyncAt: t.timestamp(),
  }
);

const HealthSampleInput = t.object('HealthSampleInput', {
  metric: t.string(),
  value: t.f64(),
  label: t.string(),
  startAt: t.timestamp(),
  endAt: t.timestamp(),
});

const spacetimedb = schema(
  {
    healthSample,
    healthDevice,
    medication,
    userProfile,
    patient,
    simState,
    symptomEntry,
    vitalSign,
    vitalSample,
    riskScore,
    alert,
    sbarReport,
    auditEvent,
    presence,
    simTimer,
    sbarJob,
    twinJob,
    twinStatus,
    medDose,
    medTimer,
    libraryEntry,
    librarySection,
    labResult,
    historyItem,
    assistiveDevice,
    systemAssessment,
    mentalHealthCheckIn,
    appointment,
    libImportJob,
    voiceDraft,
    voiceItem,
    voiceJob,
    patientLayout,
    lifestyleEntry,
    exerciseEntry,
    familyAccess,
    familyInviteCode,
    familyAlert,
    familyLogin,
    familySigninAttempt,
    careMessage,
    userLayout,
  },
  {
    env: {
      ANTHROPIC_API_KEY: t.option(t.string()),
      CLAUDE_MODEL: t.option(t.string()),
      MESHY_API_KEY: t.option(t.string()),
      MESHY_MODEL: t.option(t.string()),
      BITDEER_API_KEY: t.option(t.string()),
      BITDEER_MODEL: t.option(t.string()),
    },
  }
);
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIM_INTERVAL_MICROS = 5_000_000n;
const VITALS_KEPT_PER_PATIENT = 120;
const DAY_MICROS = 86_400_000_000n;
const MED_INTERVAL_MICROS = 60_000_000n;

function actorName(ctx: Ctx, who: Identity): string {
  return ctx.db.userProfile.identity.find(who)?.name ?? 'system';
}

function requireNurse(ctx: Ctx) {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (!me || me.role !== 'nurse') throw new SenderError('Nurse role required');
  return me;
}

function audit(ctx: Ctx, patientId: bigint, actor: string, action: string, detail: string) {
  ctx.db.auditEvent.insert({
    id: 0n,
    patientId,
    actorName: actor,
    action,
    detail,
    ts: ctx.timestamp,
  });
}

function scheduleSbar(ctx: Ctx, sbarId: bigint) {
  ctx.db.sbarJob.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch),
    sbarId,
  });
}

/** Open or upgrade one alert per patient; new reason codes merge into it. */
function raiseAlerts(ctx: Ctx, patientId: bigint, hits: RuleHit[]) {
  if (hits.length === 0) return;
  const active = [...ctx.db.alert.patientId.filter(patientId)].find(
    a => a.status === 'open' || a.status === 'acknowledged' || a.status === 'escalated'
  );
  const top = hits.reduce((a, b) => (priorityRank(b.priority) > priorityRank(a.priority) ? b : a));

  if (active) {
    const codes = new Set(active.reasonCodes.split(',').filter(Boolean));
    const newCodes = hits.map(h => h.code).filter(c => !codes.has(c));
    const upgrade = priorityRank(top.priority) > active.rank;
    if (newCodes.length === 0 && !upgrade) return;
    newCodes.forEach(c => codes.add(c));
    ctx.db.alert.id.update({
      ...active,
      reasonCodes: [...codes].join(','),
      priority: upgrade ? top.priority : active.priority,
      rank: upgrade ? priorityRank(top.priority) : active.rank,
      status: upgrade ? 'open' : active.status,
    });
    if (upgrade) notifyFamily(ctx, patientId, active.id, top.priority, [...codes].join(','), 'raised');
    audit(
      ctx,
      patientId,
      'rules',
      upgrade ? 'alert_upgraded' : 'alert_updated',
      newCodes.map(c => REASON_LABEL[c] ?? c).join('; ') || `Priority raised to ${top.priority}`
    );
    const report = ctx.db.sbarReport.alertId.find(active.id);
    if (report && report.status !== 'approved') {
      ctx.db.sbarReport.id.update({ ...report, status: 'pending', updatedAt: ctx.timestamp });
      scheduleSbar(ctx, report.id);
    }
    return;
  }

  const created = ctx.db.alert.insert({
    id: 0n,
    patientId,
    priority: top.priority,
    rank: priorityRank(top.priority),
    reasonCodes: hits.map(h => h.code).join(','),
    status: 'open',
    createdAt: ctx.timestamp,
    ackedAt: undefined,
    ackedByName: '',
    raisedBy: 'rules',
  });
  notifyFamily(ctx, patientId, created.id, created.priority, created.reasonCodes, 'opened');
  audit(
    ctx,
    patientId,
    'rules',
    'alert_opened',
    `${top.priority}: ${hits.map(h => REASON_LABEL[h.code] ?? h.code).join('; ')}`
  );
  const report = ctx.db.sbarReport.insert({
    id: 0n,
    alertId: created.id,
    patientId,
    status: 'pending',
    model: '',
    suggestedPriority: '',
    situation: '',
    background: '',
    assessment: '',
    recommendation: '',
    uncertainties: '',
    questions: '',
    draftSnapshot: '',
    editedByNurse: false,
    approvedByName: '',
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
  scheduleSbar(ctx, report.id);
}

/**
 * Tell each authorised family member about a major change. A resolution only goes to
 * people who heard about the alert in the first place, so nobody gets an all-clear
 * for something they never knew about.
 */
function notifyFamily(
  ctx: Ctx,
  patientId: bigint,
  alertId: bigint,
  priority: string,
  reasonCodes: string,
  event: 'opened' | 'raised' | 'resolved'
) {
  const p = ctx.db.patient.id.find(patientId);
  if (!p) return;
  const firstName = p.name.split(' ')[0] ?? p.name;
  let sent = 0;
  for (const access of ctx.db.familyAccess.patientId.filter(patientId)) {
    if (access.status !== 'active') continue;
    const earlier = [...ctx.db.familyAlert.accessId.filter(access.id)].filter(a => a.alertId === alertId);
    if (event === 'resolved') {
      if (earlier.length === 0 || earlier.some(a => a.event === 'resolved')) continue;
    } else {
      if (!shouldNotifyFamily(access.alertLevel, priority)) continue;
      if (earlier.some(a => a.event !== 'resolved' && a.priority === priority)) continue;
    }
    const message = familyMessage(event, priority, reasonCodes, firstName);
    ctx.db.familyAlert.insert({
      id: 0n,
      accessId: access.id,
      patientId,
      alertId,
      event,
      priority,
      title: message.title,
      body: message.body,
      createdAt: ctx.timestamp,
      readAt: undefined,
    });
    sent++;
  }
  if (sent > 0) {
    audit(ctx, patientId, 'system', 'family_notified', `${event} · ${priority} · ${sent} family member${sent === 1 ? '' : 's'}`);
  }
}

function recentVitals(ctx: Ctx, patientId: bigint) {
  return [...ctx.db.vitalSign.patientId.filter(patientId)].sort((a, b) =>
    a.ts.microsSinceUnixEpoch < b.ts.microsSinceUnixEpoch ? -1 : 1
  );
}

// The model reads hourly vitals; the demo pod compresses time so each 5 s reading counts as one hour.
const RISK_WINDOW = 48;
const RISK_HISTORY = 60;
const RISK_MIN_READINGS = 6;
const LEVEL_RANK: Record<string, number> = { low: 0, elevated: 1, high: 2 };

type VitalRow = ReturnType<typeof recentVitals>[number];

function updateRisk(ctx: Ctx, patientId: bigint, window: VitalRow[]) {
  const p = ctx.db.patient.id.find(patientId);
  if (!p || window.length === 0) return;
  const rows: HourRow[] = window
    .slice(-RISK_WINDOW)
    .map(v => [v.hr, v.spo2, v.tempC, v.systolic, v.diastolic, v.respRate]);
  const r = scoreRisk(RISK_MODEL, rows, p.age);
  const prev = ctx.db.riskScore.patientId.find(patientId);
  const history: number[] = prev ? JSON.parse(prev.history) : [];
  const recentPeak = Math.max(0, ...history.slice(-12).map(x => LEVEL_RANK[levelFor(RISK_MODEL, x)]!));
  const drivers: Driver[] = r.drivers.map(d => ({
    ...d,
    value: Math.round(d.value * 100) / 100,
    effect: Math.round(d.effect * 1000) / 1000,
  }));
  const row = {
    patientId,
    prob: r.prob,
    level: r.level,
    drivers: JSON.stringify(drivers),
    history: JSON.stringify([...history, Math.round(r.prob * 1e5) / 1e5].slice(-RISK_HISTORY)),
    hours: rows.length,
    updatedAt: ctx.timestamp,
  };
  if (prev) ctx.db.riskScore.patientId.update(row);
  else ctx.db.riskScore.insert(row);

  // Alert only when the level rises above anything seen in the last 12 readings, so it does not re-fire on flicker.
  const hit = ML_RISK_PRIORITY[r.level];
  if (hit && rows.length >= RISK_MIN_READINGS && LEVEL_RANK[r.level]! > recentPeak) raiseAlerts(ctx, patientId, [hit]);
}

function ensureSimTimer(ctx: Ctx) {
  // Published databases keep their timer row, so a changed interval is applied on the next connect.
  for (const timer of [...ctx.db.simTimer.iter()]) {
    const at = timer.scheduledAt;
    if (at.tag !== 'Interval' || at.value.micros !== SIM_INTERVAL_MICROS) {
      ctx.db.simTimer.scheduledId.delete(timer.scheduledId);
    }
  }
  if (ctx.db.simTimer.count() === 0n) {
    ctx.db.simTimer.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.interval(SIM_INTERVAL_MICROS),
    });
  }
  if (ctx.db.medTimer.count() === 0n) {
    ctx.db.medTimer.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.interval(MED_INTERVAL_MICROS),
    });
  }
}

/** Create dose rows as they come due, mark overdue ones missed, and prune old history. */
function syncDoses(ctx: Ctx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const m of ctx.db.medication.iter()) {
    if (!m.active) continue;
    const created = m.createdAt.microsSinceUnixEpoch - DUE_EARLY_MICROS;
    const from = now - MISSED_AFTER_MICROS > created ? now - MISSED_AFTER_MICROS : created;
    for (const slot of doseSlots(m.scheduleTimes, m.tzOffsetMin, from, now + DUE_EARLY_MICROS)) {
      const slotKey = `${m.id}:${slot}`;
      if (ctx.db.medDose.slotKey.find(slotKey)) continue;
      ctx.db.medDose.insert({
        id: 0n,
        slotKey,
        medicationId: m.id,
        patientId: m.patientId,
        scheduledFor: new Timestamp(slot),
        status: 'due',
        glucoseMgDl: 0,
        note: '',
        loggedAt: undefined,
        loggedBy: '',
      });
    }
  }
  for (const d of [...ctx.db.medDose.iter()]) {
    const age = now - d.scheduledFor.microsSinceUnixEpoch;
    if (age > DOSE_KEEP_MICROS) {
      ctx.db.medDose.id.delete(d.id);
    } else if (d.status === 'due' && age > MISSED_AFTER_MICROS) {
      ctx.db.medDose.id.update({ ...d, status: 'missed' });
      const m = ctx.db.medication.id.find(d.medicationId);
      audit(ctx, d.patientId, 'system', 'dose_missed', m ? `${m.name} ${m.dose}` : '');
      if (m) raiseAlerts(ctx, d.patientId, doseRules(m.kind, 'missed'));
    }
  }
}

function clearDueDoses(ctx: Ctx, medicationId: bigint) {
  for (const d of [...ctx.db.medDose.medicationId.filter(medicationId)]) {
    if (d.status === 'due') ctx.db.medDose.id.delete(d.id);
  }
}

function requireCareTeamOrPatient(ctx: Ctx, patientId: bigint) {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (!me || (me.role !== 'nurse' && !(me.role === 'patient' && me.patientId === patientId))) {
    throw new SenderError('Only the patient or a nurse can log this dose');
  }
  return me;
}

// Demo clinics run on Pacific time; real prescriptions carry the prescriber's offset.
const DEMO_TZ_OFFSET_MIN = 420;

function seedDiabetesMeds(ctx: Ctx, patientId: bigint) {
  for (const key of ['glargine', 'lispro', 'metformin']) {
    const p = MED_PRESETS.find(x => x.key === key)!;
    ctx.db.medication.insert({
      id: 0n,
      patientId,
      name: p.name,
      kind: p.kind,
      dose: p.dose,
      schedule: scheduleLabel(p.times),
      route: p.route,
      instructions: p.instructions,
      sideEffects: p.sideEffects.join('\n'),
      contraindications: p.contraindications.join('\n'),
      scheduleTimes: p.times,
      tzOffsetMin: DEMO_TZ_OFFSET_MIN,
      remindersOn: true,
      requiresGlucose: p.requiresGlucose,
      active: true,
      prescribedBy: 'Demo care team',
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  }
}

/**
 * Insert a simple { name, dose, schedule } prescription, filling in the dose-tracking columns
 * so every medication row carries both Isak's schedule label and our dose slots.
 */
function insertSimpleMed(
  ctx: Ctx,
  patientId: bigint,
  m: { name: string; dose: string; schedule: string },
  prescribedBy: string
) {
  ctx.db.medication.insert({
    id: 0n,
    patientId,
    name: m.name,
    dose: m.dose,
    schedule: m.schedule,
    kind: /insulin/i.test(m.name) ? 'insulin_long' : 'other',
    route: /inhaler/i.test(m.name) ? 'inhaled' : 'oral',
    instructions: '',
    sideEffects: '',
    contraindications: '',
    scheduleTimes: timesForSchedule(m.schedule),
    tzOffsetMin: DEMO_TZ_OFFSET_MIN,
    remindersOn: true,
    requiresGlucose: /insulin/i.test(m.name),
    active: true,
    prescribedBy,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

function seedPatients(ctx: Ctx) {
  if (ctx.db.patient.count() > 0n) return;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const seed: Array<[string, number, string, string, bigint, string]> = [
    ['Kadrian Ayarza', 22, 'Total knee replacement', 'right', 5n, 'normal'],
    ['Isak Smith', 22, 'Concussion', 'left', 12n, 'normal'],
    ['Jesus Allejandro', 59, 'Heart failure monitoring', 'right', 3n, 'fluid'],
    ['Tom Becker', 28, 'Diabetic foot wound care', 'left', 2n, 'normal'],
    ['Mei Lin Wu', 25, 'COPD monitoring', 'right', 8n, 'normal'],
    ['Elena Novak', 24, 'Spinal cord injury, wheelchair user', 'right', 30n, 'normal'],
  ];
  for (const [name, age, procedure, side, daysAgo, scenario] of seed) {
    const p = ctx.db.patient.insert({
      id: 0n,
      name,
      age,
      procedure,
      side,
      surgeryAt: new Timestamp(now - daysAgo * DAY_MICROS),
      twinUrl: '',
      createdAt: ctx.timestamp,
    });
    ctx.db.simState.insert({ patientId: p.id, scenario, tick: 0, steps: 0 });
    if (/diabet/i.test(procedure)) seedDiabetesMeds(ctx, p.id);
    seedExercisePlan(ctx, p.id);
  }
}

/** A gentle starter plan so a new patient sees the shape of the week, then makes it theirs. */
function seedExercisePlan(ctx: Ctx, patientId: bigint) {
  const seed: Array<[number, string, number, string]> = [
    [0, 'Walk', 30, 'moderate'],
    [2, 'Walk', 30, 'moderate'],
    [1, 'Stretch', 15, 'light'],
    [4, 'Walk', 30, 'moderate'],
    [5, 'Cycle', 20, 'light'],
  ];
  for (const [day, activity, minutes, intensity] of seed) {
    ctx.db.exerciseEntry.insert({
      id: 0n,
      patientId,
      status: 'planned',
      activity,
      minutes,
      intensity,
      day,
      note: '',
      source: 'form',
      createdBy: 'Starter plan',
      createdAt: ctx.timestamp,
    });
  }
}

/** Insert one curated entry with its sections when its slug is not on file yet. */
function seedLibraryEntry(ctx: Ctx, s: (typeof LIBRARY)[number]) {
  if (ctx.db.libraryEntry.slug.find(s.slug)) return;
  const e = ctx.db.libraryEntry.insert({
    id: 0n,
    slug: s.slug,
    kind: s.kind,
    name: s.name,
    aliases: s.aliases.join(','),
    category: s.category,
    summary: s.summary,
    patientSummary: s.patientSummary,
    unit: s.unit,
    refLow: s.refLow,
    refHigh: s.refHigh,
    criticalLow: s.criticalLow,
    criticalHigh: s.criticalHigh,
    related: s.related.join(','),
    sourceName: s.sourceName,
    sourceUrl: s.sourceUrl,
    curated: true,
    updatedBy: 'curated seed',
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
  s.sections.forEach((sec, i) => {
    ctx.db.librarySection.insert({
      id: 0n,
      entryId: e.id,
      position: i,
      heading: sec.heading,
      body: sec.body,
      patient: sec.patient,
    });
  });
}

function seedLibrary(ctx: Ctx) {
  if (ctx.db.libraryEntry.count() > 0n) return;
  for (const s of LIBRARY) seedLibraryEntry(ctx, s);
}

const SEED_HOUR_MICROS = 3_600_000_000n;

function seedLab(
  ctx: Ctx,
  patientId: bigint,
  slug: string,
  value: number,
  notes: string,
  hoursAgo: number
) {
  const e = ctx.db.libraryEntry.slug.find(slug);
  if (!e) return;
  ctx.db.labResult.insert({
    id: 0n,
    patientId,
    slug: e.slug,
    name: e.name,
    value,
    unit: e.unit,
    flag: labFlag(value, e),
    notes,
    resultedAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch - BigInt(hoursAgo) * SEED_HOUR_MICROS),
    enteredBy: 'Demo care team',
    createdAt: ctx.timestamp,
  });
}

function seedHistory(
  ctx: Ctx,
  patientId: bigint,
  category: string,
  title: string,
  detail: string,
  whenText: string
) {
  ctx.db.historyItem.insert({
    id: 0n,
    patientId,
    category,
    title,
    detail,
    whenText,
    slug: matchEntry([...ctx.db.libraryEntry.iter()], title, 'condition')?.slug ?? '',
    createdBy: 'Demo care team',
    createdAt: ctx.timestamp,
  });
}

/** Demo chart content: baseline labs and history for the seeded patients. */
function seedChart(ctx: Ctx) {
  if (ctx.db.labResult.count() > 0n) return;
  const find = (name: string) => [...ctx.db.patient.iter()].find(p => p.name === name);

  const tom = find('Tom Becker');
  if (tom) {
    seedLab(ctx, tom.id, 'a1c', 8.2, 'Above the < 7% goal agreed with Dr. Reyes', 96);
    seedLab(ctx, tom.id, 'glucose', 232, 'Fasting, morning of the last clinic visit', 6);
    seedLab(ctx, tom.id, 'creatinine', 1.5, 'Baseline 1.2; recheck in one week', 48);
    seedLab(ctx, tom.id, 'egfr', 46, 'CKD stage G3a; metformin dose reviewed against this', 48);
    seedLab(ctx, tom.id, 'wbc', 7.9, 'No signs of wound infection', 48);
    seedHistory(ctx, tom.id, 'medical', 'Type 2 diabetes', 'Diagnosed 2011; A1c usually 7.5-8.5', '2011');
    seedHistory(ctx, tom.id, 'medical', 'Diabetic foot ulcer', 'Left great toe, slowly healing; weekly podiatry visits', 'current');
    seedHistory(ctx, tom.id, 'medical', 'High blood pressure', 'On lisinopril 20 mg daily', '2013');
    seedHistory(ctx, tom.id, 'allergy', 'Sulfa antibiotics', 'Rash with trimethoprim/sulfamethoxazole', '');
    seedHistory(ctx, tom.id, 'family', 'Father: type 2 diabetes and a fatal stroke', 'Died at 78', '');
    seedHistory(ctx, tom.id, 'social', 'Retired machinist', 'Lives with spouse; walks 20 minutes daily; quit smoking in 1998', '');
  }

  const jesus = find('Jesus Allejandro');
  if (jesus) {
    seedLab(ctx, jesus.id, 'bnp', 620, 'Up from 480 last month; watching daily weights', 12);
    seedLab(ctx, jesus.id, 'potassium', 3.2, 'After the furosemide increase; starting a supplement', 12);
    seedLab(ctx, jesus.id, 'sodium', 133, 'Mild hyponatremia on diuretics', 12);
    seedLab(ctx, jesus.id, 'egfr', 52, 'Stable kidney function', 72);
    seedHistory(ctx, jesus.id, 'medical', 'Heart failure', 'HFpEF; daily weights; fluid watch', '2023');
    seedHistory(ctx, jesus.id, 'medical', 'Atrial fibrillation', 'On apixaban 5 mg twice daily', '2022');
    seedHistory(ctx, jesus.id, 'medical', 'High blood pressure', 'Long-standing', '2010');
    seedHistory(ctx, jesus.id, 'family', 'Brother: heart attack at 60', '', '');
    seedHistory(ctx, jesus.id, 'social', 'Lives alone', 'Daughter visits on weekends; former teacher; never smoked', '');
  }

  const mei = find('Mei Lin Wu');
  if (mei) {
    seedLab(ctx, mei.id, 'wbc', 12.8, 'During the prednisone burst for a flare last week', 72);
    seedLab(ctx, mei.id, 'potassium', 3.4, 'After prednisone and frequent albuterol use', 24);
    seedLab(ctx, mei.id, 'hemoglobin', 13.4, 'Stable', 24);
    seedHistory(ctx, mei.id, 'medical', 'COPD', '40 pack-years; quit in 2019; two flares last year', '2016');
    seedHistory(ctx, mei.id, 'medical', 'High blood pressure', '', '2018');
    seedHistory(ctx, mei.id, 'family', 'Father: emphysema', '', '');
    seedHistory(ctx, mei.id, 'social', 'Lives with her son', 'Maintenance inhalers; pulmonary rehab twice a week', '');
  }

  const kadrian = find('Kadrian Ayarza');
  if (kadrian) {
    seedLab(ctx, kadrian.id, 'hemoglobin', 10.8, 'Expected post-op drop; tolerating activity', 24);
    seedLab(ctx, kadrian.id, 'crp', 38, 'Expected post-op peak, trending down', 24);
    seedLab(ctx, kadrian.id, 'd-dimer', 1.2, 'Expected elevation on day 5 after surgery; no DVT signs on exam', 24);
    seedLab(ctx, kadrian.id, 'wbc', 9.6, 'Within the expected post-op range', 24);
    seedHistory(ctx, kadrian.id, 'medical', 'Knee osteoarthritis', 'Right knee, eight years of pain before surgery', '2018');
    seedHistory(ctx, kadrian.id, 'medical', 'High blood pressure', 'On amlodipine 5 mg', '2015');
    seedHistory(ctx, kadrian.id, 'allergy', 'No known drug allergies', '', '');
    seedHistory(ctx, kadrian.id, 'family', 'Mother: type 2 diabetes', '', '');
    seedHistory(ctx, kadrian.id, 'social', 'Postal worker', 'Walking with a cane; nonsmoker; no alcohol', '');
  }

}

/** Demo assistive devices (walkers, oxygen, wheelchairs...) for seeded patients that have none yet. */
function seedDevices(ctx: Ctx) {
  for (const p of ctx.db.patient.iter()) {
    const devices = DEMO_DEVICES[p.name];
    if (!devices || [...ctx.db.assistiveDevice.patientId.filter(p.id)].length > 0) continue;
    for (const [name, detail, sinceText] of devices) {
      ctx.db.assistiveDevice.insert({
        id: 0n,
        patientId: p.id,
        name,
        detail,
        sinceText,
        slug: matchEntry([...ctx.db.libraryEntry.iter()], name, 'device')?.slug ?? DEVICE_FALLBACK_SLUG,
        createdBy: 'Demo care team',
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
        confirmedBy: '',
        confirmedAt: new Timestamp(0n),
      });
    }
  }
}

/** Demo head-to-toe assessments for seeded patients that have none yet. */
function seedAssessments(ctx: Ctx) {
  for (const p of ctx.db.patient.iter()) {
    const rows = DEMO_ASSESSMENTS[p.name];
    if (!rows || [...ctx.db.systemAssessment.patientId.filter(p.id)].length > 0) continue;
    for (const a of rows) {
      ctx.db.systemAssessment.insert({
        id: 0n,
        patientId: p.id,
        system: a.system,
        status: a.status,
        findings: a.findings,
        region: a.region ?? '',
        assessedBy: 'Demo care team',
        assessedAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch - BigInt(a.hoursAgo) * SEED_HOUR_MICROS),
        createdAt: ctx.timestamp,
      });
    }
  }
}

/**
 * Mental-health demo patients: bipolar, depression, anxiety. Created only when their
 * name is not on file, so re-running the backfill on a live database is safe.
 */
function seedMentalHealthPatients(ctx: Ctx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const seed: Array<[string, number, string, string, bigint]> = [
    ['Maria Delgado', 34, 'Bipolar I maintenance', 'right', 120n],
    ['Daniel Cho', 27, 'Depression and anxiety follow-up', 'right', 60n],
    ['Priya Nair', 41, 'Generalized anxiety monitoring', 'right', 90n],
  ];
  for (const [name, age, procedure, side, daysAgo] of seed) {
    const known = [...ctx.db.patient.iter()].some(p => p.name === name);
    if (known) continue;
    const p = ctx.db.patient.insert({
      id: 0n,
      name,
      age,
      procedure,
      side,
      surgeryAt: new Timestamp(now - daysAgo * DAY_MICROS),
      twinUrl: '',
      createdAt: ctx.timestamp,
    });
    ctx.db.simState.insert({ patientId: p.id, scenario: 'normal', tick: 0, steps: 0 });
    seedExercisePlan(ctx, p.id);

    const demo = DEMO_MENTAL_HEALTH[name];
    if (!demo) continue;
    for (const key of demo.meds) {
      const preset = MED_PRESETS.find(x => x.key === key);
      if (!preset) continue;
      ctx.db.medication.insert({
        id: 0n,
        patientId: p.id,
        name: preset.name,
        kind: preset.kind,
        dose: preset.dose,
        schedule: scheduleLabel(preset.times),
        route: preset.route,
        instructions: preset.instructions,
        sideEffects: preset.sideEffects.join('\n'),
        contraindications: preset.contraindications.join('\n'),
        scheduleTimes: preset.times,
        tzOffsetMin: DEMO_TZ_OFFSET_MIN,
        remindersOn: true,
        requiresGlucose: preset.requiresGlucose,
        active: true,
        prescribedBy: 'Demo care team',
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
    }
    for (const [slug, value, notes, hoursAgo] of demo.labs ?? []) seedLab(ctx, p.id, slug, value, notes, hoursAgo);
    for (const [category, title, detail, whenText] of demo.history ?? []) {
      seedHistory(ctx, p.id, category, title, detail, whenText);
    }
  }
}

/**
 * Demo mental-health check-ins, oldest first so streak rules see real history.
 * Unlike the physical check-in seeds, these DO raise the red-flag alerts: Maria's
 * activation streak and Daniel's positive PHQ-9 item 9 are the demo of this feature.
 */
function seedMentalHealthCheckIns(ctx: Ctx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const p of ctx.db.patient.iter()) {
    const demo = DEMO_MENTAL_HEALTH[p.name];
    if (!demo || [...ctx.db.mentalHealthCheckIn.patientId.filter(p.id)].length > 0) continue;
    // Oldest first, so each entry's rules see the entries before it.
    const entries = [...demo.entries].sort((a, b) => b.hoursAgo - a.hoursAgo);
    for (const e of entries) {
      insertMhCheckIn(ctx, 'Demo care team', 'demo', p.id, {
        kind: e.kind,
        score: e.score,
        item9: e.item9 ?? 0,
        sleepHours: e.sleepHours ?? 0,
        notes: e.notes ?? '',
      }, new Timestamp(now - BigInt(e.hoursAgo) * SEED_HOUR_MICROS));
    }
  }
}

/**
 * Insert one mental-health check-in and run its red-flag rules. Shared by the reducer
 * and the seeds, so the alerts raised are exactly what a live check-in would raise.
 */
function insertMhCheckIn(
  ctx: Ctx,
  who: string,
  source: string,
  patientId: bigint,
  entry: { kind: string; score: number; item9: number; sleepHours: number; notes: string },
  at: Timestamp
) {
  const kind = isMhKind(entry.kind) ? entry.kind : 'mood';
  const max = MH_MAX_SCORE[kind];
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const score = clamp(Math.round(entry.score), kind === 'mood' ? -3 : 0, max);
  const item9 = kind === 'phq9' ? clamp(Math.round(entry.item9), 0, 3) : 0;
  const sleepHours = clamp(Number(entry.sleepHours.toFixed(1)), 0, 24);
  const notes = entry.notes.trim().slice(0, 500);

  ctx.db.mentalHealthCheckIn.insert({
    id: 0n,
    patientId,
    kind,
    score,
    band: kind === 'mood' ? '' : mhBand(kind, score),
    item9,
    sleepHours,
    notes,
    createdBy: who,
    source,
    createdAt: at,
  });

  // Streak rules need this patient's previous mood days, oldest first.
  const recentMood = [...ctx.db.mentalHealthCheckIn.patientId.filter(patientId)]
    .filter(r => r.kind === 'mood')
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : 1))
    .map(r => ({ score: r.score, sleepHours: r.sleepHours }));
  const hits = mhRules({ kind, score, item9, sleepHours, notes }, recentMood);
  raiseAlerts(ctx, patientId, hits);
  if (hits.length > 0) {
    audit(ctx, patientId, who, 'mh_red_flag', MH_KIND_LABEL[kind]);
  }
  return hits;
}

/**
 * Demo appointments for seeded patients, with past visits completed and future ones
 * booked. Guarded per patient, so re-running the backfill on a live chart adds nothing.
 */
function seedAppointments(ctx: Ctx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const p of ctx.db.patient.iter()) {
    const rows = EXAMPLE_APPOINTMENTS[p.name];
    if (!rows || [...ctx.db.appointment.patientId.filter(p.id)].length > 0) continue;
    for (const a of rows) {
      ctx.db.appointment.insert({
        id: 0n,
        patientId: p.id,
        title: a.title,
        kind: a.kind,
        whenAt: new Timestamp(demoWhen(a.days, a.hour, a.minute, now, DEMO_TZ_OFFSET_MIN)),
        durationMin: a.durationMin,
        mode: a.mode,
        location: a.location,
        notes: a.notes ?? '',
        status: a.status,
        createdBy: 'Demo care team',
        createdAt: ctx.timestamp,
      });
    }
  }
}

/** Adds the example history to seeded patients that have no check-ins yet. Runs no alert rules. */
function seedCheckIns(ctx: Ctx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const p of ctx.db.patient.iter()) {
    const examples = EXAMPLE_CHECK_INS[p.name];
    if (!examples || [...ctx.db.symptomEntry.patientId.filter(p.id)].length > 0) continue;
    for (const ex of examples) {
      const at = new Timestamp(now - BigInt(ex.minutesAgo) * 60_000_000n);
      const [x, y, z] = ex.point;
      ctx.db.symptomEntry.insert({
        id: 0n,
        patientId: p.id,
        region: ex.region,
        x,
        y,
        z,
        onset: ex.onset,
        provocation: ex.provocation,
        quality: ex.quality,
        radiation: ex.radiation,
        severity: ex.severity,
        timing: ex.timing,
        swelling: !!ex.swelling,
        warmth: !!ex.warmth,
        redness: !!ex.redness,
        shortnessOfBreath: false,
        chestPain: false,
        bodyTempC: ex.bodyTempC ?? 0,
        notes: ex.notes,
        source: 'tap',
        createdBy: ctx.databaseIdentity,
        createdAt: at,
      });
      ctx.db.auditEvent.insert({
        id: 0n,
        patientId: p.id,
        actorName: p.name,
        action: 'symptom_logged',
        detail: `${regionText(ex.region)} · ${ex.quality || 'pain'} ${ex.severity}/10 (tap)`,
        ts: at,
      });
    }
  }
}

function insertDemoSamples(ctx: Ctx, patientId: bigint, samples: DemoSample[]) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const s of samples) {
    const at = new Timestamp(now - BigInt(Math.round(s.minutesAgo)) * 60_000_000n);
    ctx.db.healthSample.insert({
      id: 0n,
      patientId,
      metric: s.metric,
      value: s.value,
      label: s.label,
      startAt: at,
      endAt: at,
      source: s.source,
      device: s.device,
      createdBy: ctx.databaseIdentity,
      createdAt: ctx.timestamp,
    });
  }
}

/** Four weeks of wearable history, paired demo devices and medication lists for seeded patients. */
function seedHealth(ctx: Ctx) {
  const rand = () => ctx.random();
  for (const p of ctx.db.patient.iter()) {
    const profile = DEMO_HEALTH[p.name];
    if (!profile) continue;
    if ([...ctx.db.healthSample.patientId.filter(p.id)].length > 0) continue;
    if ([...ctx.db.healthDevice.patientId.filter(p.id)].length > 0) continue;
    for (const d of profile.devices) {
      ctx.db.healthDevice.insert({
        id: 0n,
        patientId: p.id,
        kind: d.kind,
        name: d.name,
        source: DEVICE_KINDS[d.kind]?.source ?? 'demo',
        demo: true,
        connectedAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch - 30n * DAY_MICROS),
        lastSyncAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch - 20n * 60_000_000n),
      });
    }
    if ([...ctx.db.medication.patientId.filter(p.id)].length === 0) {
      for (const m of profile.medications) {
        insertSimpleMed(ctx, p.id, m, 'Demo care team');
      }
    }
    insertDemoSamples(ctx, p.id, profile.history(rand));
  }
}

const RULE_METRICS = new Set(['weight', 'resting_heart_rate', 'blood_oxygen', 'irregular_rhythm', 'blood_glucose']);

function healthPoints(ctx: Ctx, patientId: bigint, only?: Set<string>): HealthPoint[] {
  return [...ctx.db.healthSample.patientId.filter(patientId)]
    .filter(s => !only || only.has(s.metric))
    .map(s => ({ metric: s.metric, value: s.value, label: s.label, at: Number(s.startAt.microsSinceUnixEpoch) }));
}

function runHealthRules(ctx: Ctx, patientId: bigint) {
  raiseAlerts(ctx, patientId, healthRules(healthPoints(ctx, patientId, RULE_METRICS), Number(ctx.timestamp.microsSinceUnixEpoch)));
}

function requirePatientAccess(ctx: Ctx, patientId: bigint) {
  const p = ctx.db.patient.id.find(patientId);
  if (!p) throw new SenderError('Unknown patient');
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (me && me.role === 'patient' && me.patientId !== patientId) {
    throw new SenderError('Patients can only change their own health data');
  }
  return p;
}

function clearHealthData(ctx: Ctx) {
  for (const r of ctx.db.healthSample.iter()) ctx.db.healthSample.id.delete(r.id);
  for (const r of ctx.db.healthDevice.iter()) ctx.db.healthDevice.id.delete(r.id);
  for (const r of ctx.db.medication.iter()) ctx.db.medication.id.delete(r.id);
  for (const d of ctx.db.medDose.iter()) ctx.db.medDose.id.delete(d.id);
}

/**
 * Post to the patient's private thread. Patients post on their own chart, nurses on
 * any chart, and family only with an active, approved grant for that patient.
 */
export const postCareMessage = spacetimedb.reducer(
  { patientId: t.u64(), body: t.string(), channel: t.string() },
  (ctx, { patientId, body, channel }) => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    if (!me) throw new SenderError('Sign in to join the conversation');
    if (!isMessageChannel(channel)) throw new SenderError('Unknown conversation channel');
    let authorRole = '';
    if (me.role === 'patient' && me.patientId === patientId) {
      authorRole = 'patient';
    } else if (me.role === 'nurse') {
      authorRole = 'nurse';
    } else if (me.role === 'family') {
      const approved = [...ctx.db.familyAccess.patientId.filter(patientId)].some(
        a => a.status === 'active' && a.memberIdentity !== undefined && a.memberIdentity.equals(ctx.sender)
      );
      if (!approved) throw new SenderError('Only approved family members can join this conversation');
      authorRole = 'family';
    } else {
      throw new SenderError('You do not have access to this conversation');
    }
    if (!canPostToChannel(authorRole as 'patient' | 'nurse' | 'family', channel)) {
      throw new SenderError(
        channel === 'nurse'
          ? 'That conversation is private between the patient and the nurse'
          : 'That conversation is private between the patient and family'
      );
    }
    ctx.db.careMessage.insert({
      id: 0n,
      patientId,
      author: ctx.sender,
      authorName: me.name,
      authorRole,
      channel,
      body: cleanMessageBody(body),
      createdAt: ctx.timestamp,
    });
  }
);

function clearClinicalData(ctx: Ctx) {
  for (const r of ctx.db.symptomEntry.iter()) ctx.db.symptomEntry.id.delete(r.id);
  for (const r of ctx.db.vitalSign.iter()) ctx.db.vitalSign.id.delete(r.id);
  for (const r of ctx.db.vitalSample.iter()) ctx.db.vitalSample.id.delete(r.id);
  for (const r of ctx.db.riskScore.iter()) ctx.db.riskScore.patientId.delete(r.patientId);
  for (const r of ctx.db.alert.iter()) ctx.db.alert.id.delete(r.id);
  for (const r of ctx.db.sbarReport.iter()) ctx.db.sbarReport.id.delete(r.id);
  for (const r of ctx.db.auditEvent.iter()) ctx.db.auditEvent.id.delete(r.id);
  for (const r of ctx.db.sbarJob.iter()) ctx.db.sbarJob.scheduledId.delete(r.scheduledId);
  for (const r of ctx.db.medDose.iter()) ctx.db.medDose.id.delete(r.id);
  for (const r of ctx.db.familyAlert.iter()) ctx.db.familyAlert.id.delete(r.id);
  for (const r of ctx.db.mentalHealthCheckIn.iter()) ctx.db.mentalHealthCheckIn.id.delete(r.id);
  for (const r of ctx.db.appointment.iter()) ctx.db.appointment.id.delete(r.id);
  for (const r of ctx.db.careMessage.iter()) ctx.db.careMessage.id.delete(r.id);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  seedPatients(ctx);
  seedLibrary(ctx);
  seedChart(ctx);
  seedDevices(ctx);
  seedAssessments(ctx);
  seedMentalHealthPatients(ctx);
  seedMentalHealthCheckIns(ctx);
  seedAppointments(ctx);
  seedCheckIns(ctx);
  seedHealth(ctx);
  ensureSimTimer(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  ensureSimTimer(ctx);
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (me) ctx.db.userProfile.identity.update({ ...me, online: true });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (me) ctx.db.userProfile.identity.update({ ...me, online: false });
  const p = ctx.db.presence.identity.find(ctx.sender);
  if (p) ctx.db.presence.identity.delete(ctx.sender);
});

// ---------------------------------------------------------------------------
// Profiles and patients
// ---------------------------------------------------------------------------

export const setProfile = spacetimedb.reducer(
  { name: t.string(), role: t.string(), patientId: t.u64() },
  (ctx, { name, role, patientId }) => {
    if (role !== 'patient' && role !== 'nurse') throw new SenderError('Unknown role');
    if (role === 'patient' && !ctx.db.patient.id.find(patientId)) {
      throw new SenderError('Unknown patient');
    }
    const row = {
      identity: ctx.sender,
      name: name.trim() || (role === 'nurse' ? 'Nurse' : 'Patient'),
      role,
      patientId: role === 'patient' ? patientId : 0n,
      online: true,
    };
    if (ctx.db.userProfile.identity.find(ctx.sender)) ctx.db.userProfile.identity.update(row);
    else ctx.db.userProfile.insert(row);
  }
);

export const createPatient = spacetimedb.reducer(
  { name: t.string(), age: t.u32(), side: t.string(), daysSinceSurgery: t.u32() },
  (ctx, { name, age, side, daysSinceSurgery }) => {
    if (side !== 'left' && side !== 'right') throw new SenderError('Side must be left or right');
    const p = ctx.db.patient.insert({
      id: 0n,
      name: name.trim(),
      age,
      procedure: 'Total knee replacement',
      side,
      surgeryAt: new Timestamp(
        ctx.timestamp.microsSinceUnixEpoch - BigInt(daysSinceSurgery) * DAY_MICROS
      ),
      twinUrl: '',
      createdAt: ctx.timestamp,
    });
    ctx.db.simState.insert({ patientId: p.id, scenario: 'normal', tick: 0, steps: 0 });
    audit(ctx, p.id, actorName(ctx, ctx.sender), 'patient_created', p.name);
  }
);

export const setTwinUrl = spacetimedb.reducer(
  { patientId: t.u64(), twinUrl: t.string() },
  (ctx, { patientId, twinUrl }) => {
    const p = ctx.db.patient.id.find(patientId);
    if (!p) throw new SenderError('Unknown patient');
    requireTwinAccess(ctx, patientId);
    const status = ctx.db.twinStatus.patientId.find(patientId)?.status;
    if (status === 'queued' || status === 'generating') throw new SenderError('A twin is already being generated');
    ctx.db.patient.id.update({ ...p, twinUrl });
    if (!twinUrl) ctx.db.twinStatus.patientId.delete(patientId);
    audit(ctx, patientId, actorName(ctx, ctx.sender), 'twin_updated', twinUrl ? 'Personal twin' : 'Personal scan removed');
  }
);

const MAX_PHOTO_CHARS = 2_000_000;
const TWIN_POLL_MICROS = 5_000_000n;
const TWIN_MAX_POLLS = 180;

function requireTwinAccess(ctx: Ctx, patientId: bigint) {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (!me || (me.role !== 'nurse' && !(me.role === 'patient' && me.patientId === patientId))) {
    throw new SenderError('Only the patient or a nurse can update this twin');
  }
  return me;
}

function setTwinStatus(ctx: Ctx, patientId: bigint, status: string, detail: string) {
  const row = { patientId, status, detail, updatedAt: ctx.timestamp };
  if (ctx.db.twinStatus.patientId.find(patientId)) ctx.db.twinStatus.patientId.update(row);
  else ctx.db.twinStatus.insert(row);
}

export const requestTwin = spacetimedb.reducer(
  { patientId: t.u64(), photo: t.string() },
  (ctx, { patientId, photo }) => {
    const p = ctx.db.patient.id.find(patientId);
    if (!p) throw new SenderError('Unknown patient');
    const me = requireTwinAccess(ctx, patientId);
    if (!ctx.env.MESHY_API_KEY?.trim()) {
      throw new SenderError('Photo twins are not configured on this server (MESHY_API_KEY missing).');
    }
    if (photo.length > MAX_PHOTO_CHARS) throw new SenderError('Photo is too large');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) {
      throw new SenderError('Photo must be a JPEG, PNG or WebP');
    }
    const busy = ctx.db.twinStatus.patientId.find(patientId);
    if (busy && (busy.status === 'queued' || busy.status === 'generating')) {
      throw new SenderError('A twin is already being generated');
    }
    setTwinStatus(ctx, patientId, 'queued', 'Photo received');
    ctx.db.twinJob.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch),
      patientId,
      photo,
      statusUrl: '',
      responseUrl: '',
      attempt: 0,
    });
    audit(ctx, patientId, me.name, 'twin_requested', 'Photo submitted for 3D twin generation');
  }
);

export const runTwinJob = spacetimedb.procedure(
  { onSchedule: twinJob },
  { job: twinJob.rowType },
  t.unit(),
  (ctx, { job }) => {
    if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('Twin jobs must run on the scheduler');
    const active = (tx: Ctx) => {
      const status = tx.db.twinStatus.patientId.find(job.patientId)?.status;
      return !!tx.db.patient.id.find(job.patientId) && (status === 'queued' || status === 'generating');
    };
    if (!ctx.withTx(active)) return {};

    const finish = (status: string, detail: string, twinUrl?: string) =>
      ctx.withTx(tx => {
        if (!active(tx)) return;
        setTwinStatus(tx, job.patientId, status, detail);
        const p = tx.db.patient.id.find(job.patientId);
        if (twinUrl && p) {
          tx.db.patient.id.update({ ...p, twinUrl });
          audit(tx, job.patientId, 'system', 'twin_updated', 'Personal twin ready');
        } else if (status === 'error') {
          audit(tx, job.patientId, 'system', 'twin_failed', detail);
        }
      });
    const poll = (statusUrl: string, attempt: number, detail: string) =>
      ctx.withTx(tx => {
        if (!active(tx)) return;
        setTwinStatus(tx, job.patientId, 'generating', detail);
        tx.db.twinJob.insert({
          scheduledId: 0n,
          scheduledAt: ScheduleAt.time(tx.timestamp.microsSinceUnixEpoch + TWIN_POLL_MICROS),
          patientId: job.patientId,
          photo: '',
          statusUrl,
          responseUrl: '',
          attempt,
        });
      });

    const key = ctx.env.MESHY_API_KEY;
    if (!key) {
      finish('error', 'Photo twins are not configured on this server (MESHY_API_KEY missing).');
      return {};
    }
    const fetch: MeshyFetch = (url, options) => ctx.http.fetch(url, {
      ...options, timeout: TimeDuration.fromMillis(30_000),
    });

    try {
      if (!job.statusUrl) {
        const seated = ctx.withTx(tx => usesWheelchair(tx.db.patient.id.find(job.patientId)?.procedure ?? ''));
        const statusUrl = submitMeshyTask(fetch, key, job.photo, ctx.env.MESHY_MODEL || 'latest', seated);
        poll(statusUrl, 1, 'Your photo is in the queue.');
        return {};
      }

      const task = pollMeshyTask(fetch, key, job.statusUrl);
      if (task.status === 'generating') {
        if (job.attempt >= TWIN_MAX_POLLS) {
          throw new MeshyError('The 3D twin took too long. Check the 3D service dashboard before starting another task.');
        }
        poll(job.statusUrl, job.attempt + 1, task.detail);
        return {};
      }

      finish('ready', task.detail, task.twinUrl);
    } catch (e) {
      // Polls are safe to retry; never replay a potentially billable POST after a network error.
      if (job.statusUrl && job.attempt < TWIN_MAX_POLLS && (!(e instanceof MeshyError) || e.retryable)) {
        poll(job.statusUrl, job.attempt + 1, 'Waiting for the 3D service to reconnect…');
      } else {
        finish('error', e instanceof MeshyError ? e.message : 'Could not confirm the 3D twin request. Check the 3D service dashboard before trying again.');
      }
    }
    return {};
  }
);

// ---------------------------------------------------------------------------
// Symptoms
// ---------------------------------------------------------------------------

export const logSymptom = spacetimedb.reducer(
  {
    patientId: t.u64(),
    region: t.string(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    onset: t.string(),
    provocation: t.string(),
    quality: t.string(),
    radiation: t.string(),
    severity: t.u8(),
    timing: t.string(),
    swelling: t.bool(),
    warmth: t.bool(),
    redness: t.bool(),
    shortnessOfBreath: t.bool(),
    chestPain: t.bool(),
    bodyTempC: t.f32(),
    notes: t.string(),
    source: t.string(),
  },
  (ctx, args) => {
    insertSymptom(ctx, actorName(ctx, ctx.sender), args);
  }
);

export const deleteSymptom = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const s = ctx.db.symptomEntry.id.find(id);
  if (!s) return;
  if (!s.createdBy.equals(ctx.sender)) requireNurse(ctx);
  ctx.db.symptomEntry.id.delete(id);
  audit(ctx, s.patientId, actorName(ctx, ctx.sender), 'symptom_removed', s.region);
});

// ---------------------------------------------------------------------------
// Alerts and SBAR (nurse actions)
// ---------------------------------------------------------------------------

export const ackAlert = spacetimedb.reducer({ alertId: t.u64() }, (ctx, { alertId }) => {
  const me = requireNurse(ctx);
  const a = ctx.db.alert.id.find(alertId);
  if (!a) throw new SenderError('Unknown alert');
  ctx.db.alert.id.update({
    ...a,
    status: 'acknowledged',
    ackedAt: a.ackedAt ?? ctx.timestamp,
    ackedByName: me.name,
  });
  audit(ctx, a.patientId, me.name, 'alert_acknowledged', a.reasonCodes);
});

export const escalateAlert = spacetimedb.reducer(
  { alertId: t.u64(), note: t.string() },
  (ctx, { alertId, note }) => {
    const me = requireNurse(ctx);
    const a = ctx.db.alert.id.find(alertId);
    if (!a) throw new SenderError('Unknown alert');
    ctx.db.alert.id.update({
      ...a,
      status: 'escalated',
      ackedAt: a.ackedAt ?? ctx.timestamp,
      ackedByName: a.ackedByName || me.name,
    });
    audit(ctx, a.patientId, me.name, 'alert_escalated', note || 'Escalated to physician');
  }
);

export const resolveAlert = spacetimedb.reducer(
  { alertId: t.u64(), note: t.string() },
  (ctx, { alertId, note }) => {
    const me = requireNurse(ctx);
    const a = ctx.db.alert.id.find(alertId);
    if (!a) throw new SenderError('Unknown alert');
    ctx.db.alert.id.update({
      ...a,
      status: 'resolved',
      ackedAt: a.ackedAt ?? ctx.timestamp,
      ackedByName: a.ackedByName || me.name,
    });
    notifyFamily(ctx, a.patientId, a.id, a.priority, a.reasonCodes, 'resolved');
    audit(ctx, a.patientId, me.name, 'alert_resolved', note);
  }
);

export const approveSbar = spacetimedb.reducer(
  {
    sbarId: t.u64(),
    situation: t.string(),
    background: t.string(),
    assessment: t.string(),
    recommendation: t.string(),
  },
  (ctx, { sbarId, situation, background, assessment, recommendation }) => {
    const me = requireNurse(ctx);
    const r = ctx.db.sbarReport.id.find(sbarId);
    if (!r) throw new SenderError('Unknown report');
    const edited =
      [situation, background, assessment, recommendation].join('\n') !== r.draftSnapshot;
    ctx.db.sbarReport.id.update({
      ...r,
      situation,
      background,
      assessment,
      recommendation,
      status: 'approved',
      editedByNurse: edited,
      approvedByName: me.name,
      updatedAt: ctx.timestamp,
    });
    audit(ctx, r.patientId, me.name, 'sbar_approved', edited ? 'Edited before approval' : 'Approved as drafted');
  }
);

export const regenerateSbar = spacetimedb.reducer({ alertId: t.u64() }, (ctx, { alertId }) => {
  const me = requireNurse(ctx);
  const r = ctx.db.sbarReport.alertId.find(alertId);
  if (!r) throw new SenderError('No report for alert');
  ctx.db.sbarReport.id.update({ ...r, status: 'pending', updatedAt: ctx.timestamp });
  scheduleSbar(ctx, r.id);
  audit(ctx, r.patientId, me.name, 'sbar_regenerate_requested', '');
});

// ---------------------------------------------------------------------------
// Medications, dose schedule, and reminders
// ---------------------------------------------------------------------------

const MAX_MED_TEXT = 4000;

export const saveMedication = spacetimedb.reducer(
  {
    id: t.u64(), // 0 = new
    patientId: t.u64(),
    name: t.string(),
    kind: t.string(),
    dose: t.string(),
    route: t.string(),
    instructions: t.string(),
    sideEffects: t.string(),
    contraindications: t.string(),
    scheduleTimes: t.string(),
    tzOffsetMin: t.i32(),
    remindersOn: t.bool(),
    requiresGlucose: t.bool(),
  },
  (ctx, args) => {
    const me = requireNurse(ctx);
    if (!ctx.db.patient.id.find(args.patientId)) throw new SenderError('Unknown patient');
    const name = args.name.trim();
    const dose = args.dose.trim();
    if (!name) throw new SenderError('Medication name is required');
    if (!dose) throw new SenderError('Dose is required');
    if (!(MED_KINDS as readonly string[]).includes(args.kind)) throw new SenderError('Unknown medication type');
    if (Math.abs(args.tzOffsetMin) > 14 * 60) throw new SenderError('Invalid time zone offset');
    for (const text of [args.instructions, args.sideEffects, args.contraindications]) {
      if (text.length > MAX_MED_TEXT) throw new SenderError('Text is too long');
    }
    let scheduleTimes: string;
    try {
      scheduleTimes = normalizeTimes(args.scheduleTimes);
    } catch (e) {
      throw new SenderError((e as Error).message);
    }
    const tidy = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    const fields = {
      name,
      kind: args.kind,
      dose,
      route: args.route.trim(),
      instructions: args.instructions.trim(),
      sideEffects: tidy(args.sideEffects),
      contraindications: tidy(args.contraindications),
      scheduleTimes,
      schedule: scheduleLabel(scheduleTimes),
      tzOffsetMin: args.tzOffsetMin,
      remindersOn: args.remindersOn,
      requiresGlucose: args.requiresGlucose,
      updatedAt: ctx.timestamp,
    };

    if (args.id === 0n) {
      ctx.db.medication.insert({
        id: 0n,
        patientId: args.patientId,
        ...fields,
        active: true,
        prescribedBy: me.name,
        createdAt: ctx.timestamp,
      });
      audit(ctx, args.patientId, me.name, 'medication_added', `${name} ${dose} at ${scheduleTimes.replace(/,/g, ', ')}`);
    } else {
      const existing = ctx.db.medication.id.find(args.id);
      if (!existing || existing.patientId !== args.patientId) throw new SenderError('Unknown medication');
      ctx.db.medication.id.update({ ...existing, ...fields });
      clearDueDoses(ctx, existing.id);
      audit(ctx, args.patientId, me.name, 'medication_updated', `${name} ${dose} at ${scheduleTimes.replace(/,/g, ', ')}`);
    }
    syncDoses(ctx);
  }
);

export const stopMedication = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const me = requireNurse(ctx);
  const m = ctx.db.medication.id.find(id);
  if (!m) throw new SenderError('Unknown medication');
  if (!m.active) return;
  ctx.db.medication.id.update({ ...m, active: false, updatedAt: ctx.timestamp });
  clearDueDoses(ctx, id);
  audit(ctx, m.patientId, me.name, 'medication_stopped', `${m.name} ${m.dose}`);
});

export const logDose = spacetimedb.reducer(
  { doseId: t.u64(), status: t.string(), glucoseMgDl: t.f32(), note: t.string() },
  (ctx, { doseId, status, glucoseMgDl, note }) => {
    const d = ctx.db.medDose.id.find(doseId);
    if (!d) throw new SenderError('Unknown dose');
    const me = requireCareTeamOrPatient(ctx, d.patientId);
    applyDoseLog(ctx, me.name, doseId, status, glucoseMgDl, note);
  }
);

export const medTick = spacetimedb.reducer(
  { onSchedule: medTimer },
  { timer: medTimer.rowType },
  (ctx, _args) => {
    syncDoses(ctx);
  }
);
// ---------------------------------------------------------------------------
// Medical library, lab results, and health history
// ---------------------------------------------------------------------------

const LibSectionInput = t.object('LibSectionInput', {
  heading: t.string(),
  body: t.string(),
  patient: t.bool(),
});

export const saveLibraryEntry = spacetimedb.reducer(
  {
    id: t.u64(), // 0 = new
    kind: t.string(),
    name: t.string(),
    aliases: t.string(), // comma-separated
    category: t.string(),
    summary: t.string(),
    patientSummary: t.string(),
    unit: t.string(),
    refLow: t.f32(), // 0 = not set
    refHigh: t.f32(),
    criticalLow: t.f32(),
    criticalHigh: t.f32(),
    related: t.string(), // comma-separated slugs
    sourceName: t.string(),
    sourceUrl: t.string(),
    sections: t.array(LibSectionInput),
  },
  (ctx, args) => {
    const me = requireNurse(ctx);
    if (!(LIB_KINDS as readonly string[]).includes(args.kind)) throw new SenderError('Unknown library kind');
    const name = args.name.trim();
    if (!name) throw new SenderError('Name is required');
    for (const bound of [args.refLow, args.refHigh, args.criticalLow, args.criticalHigh]) {
      if (!Number.isFinite(bound)) throw new SenderError('Reference ranges must be numbers (0 = not set)');
    }
    if (args.refLow !== 0 && args.refHigh !== 0 && args.refLow >= args.refHigh) {
      throw new SenderError('Reference low must be below reference high');
    }
    if (args.criticalLow !== 0 && args.refLow !== 0 && args.criticalLow >= args.refLow) {
      throw new SenderError('Critical low must be below the reference low');
    }
    if (args.criticalHigh !== 0 && args.refHigh !== 0 && args.criticalHigh <= args.refHigh) {
      throw new SenderError('Critical high must be above the reference high');
    }
    if (args.summary.length > MAX_MED_TEXT || args.patientSummary.length > MAX_MED_TEXT) {
      throw new SenderError('Summary is too long');
    }
    if (args.sourceUrl && !/^https:\/\//.test(args.sourceUrl)) throw new SenderError('Source URL must use https');
    if (args.sections.length === 0) throw new SenderError('At least one section is required');
    if (args.sections.length > 12) throw new SenderError('At most 12 sections');
    for (const s of args.sections) {
      if (!s.heading.trim()) throw new SenderError('Section heading is required');
      if (!s.body.trim()) throw new SenderError('Section body is required');
      if (s.body.length > MAX_MED_TEXT) throw new SenderError('Section body is too long');
    }
    const known = new Set([...ctx.db.libraryEntry.iter()].map(x => x.slug));
    const tidy = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    const related = args.related.split(',').map(s => s.trim()).filter(s => s && known.has(s)).join(',');
    const existing = args.id === 0n ? undefined : ctx.db.libraryEntry.id.find(args.id);
    if (args.id !== 0n && !existing) throw new SenderError('Unknown library entry');

    let slug = existing?.slug ?? slugify(name);
    if (args.id === 0n) {
      if (!slug) throw new SenderError('Name is too short');
      const base = slug;
      for (let i = 2; known.has(slug) && i < 100; i++) slug = `${base}-${i}`;
      if (known.has(slug)) slug = `${base}-${ctx.timestamp.microsSinceUnixEpoch % 100_000n}`;
    }

    const fields = {
      kind: args.kind,
      name,
      aliases: args.aliases.split(',').map(s => s.trim()).filter(Boolean).join(','),
      category: args.category.trim(),
      summary: tidy(args.summary),
      patientSummary: tidy(args.patientSummary),
      unit: args.unit.trim(),
      refLow: args.refLow || undefined,
      refHigh: args.refHigh || undefined,
      criticalLow: args.criticalLow || undefined,
      criticalHigh: args.criticalHigh || undefined,
      related,
      sourceName: args.sourceName.trim(),
      sourceUrl: args.sourceUrl.trim(),
      updatedBy: me.name,
      updatedAt: ctx.timestamp,
    };

    let id: bigint;
    if (existing) {
      ctx.db.libraryEntry.id.update({ ...existing, ...fields });
      id = existing.id;
    } else {
      id = ctx.db.libraryEntry.insert({ id: 0n, slug, ...fields, curated: false, createdAt: ctx.timestamp }).id;
    }
    // Replace the whole write-up with what the form shows (FDA-imported sections included).
    for (const s of [...ctx.db.librarySection.entryId.filter(id)]) ctx.db.librarySection.id.delete(s.id);
    args.sections.forEach((s, i) => {
      ctx.db.librarySection.insert({
        id: 0n,
        entryId: id,
        position: i,
        heading: s.heading.trim(),
        body: s.body.trim(),
        patient: s.patient,
      });
    });
    audit(ctx, 0n, me.name, existing ? 'library_entry_updated' : 'library_entry_added', name);
  }
);

export const deleteLibraryEntry = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const me = requireNurse(ctx);
  const e = ctx.db.libraryEntry.id.find(id);
  if (!e) return;
  if (e.curated) throw new SenderError('Curated reference entries cannot be deleted; edit the entry instead');
  for (const s of [...ctx.db.librarySection.entryId.filter(id)]) ctx.db.librarySection.id.delete(s.id);
  ctx.db.libraryEntry.id.delete(id);
  audit(ctx, 0n, me.name, 'library_entry_deleted', e.name);
});

export const addLabResult = spacetimedb.reducer(
  { patientId: t.u64(), name: t.string(), value: t.f32(), unit: t.string(), notes: t.string(), resultedAt: t.timestamp() },
  (ctx, args) => {
    const me = requireNurse(ctx);
    insertLab(ctx, me.name, args);
  }
);

export const deleteLabResult = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const me = requireNurse(ctx);
  const r = ctx.db.labResult.id.find(id);
  if (!r) return;
  ctx.db.labResult.id.delete(id);
  audit(ctx, r.patientId, me.name, 'lab_removed', r.name);
});

export const saveHistoryItem = spacetimedb.reducer(
  { id: t.u64(), patientId: t.u64(), category: t.string(), title: t.string(), detail: t.string(), whenText: t.string() },
  (ctx, args) => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    if (me?.role === 'nurse') {
      saveHistory(ctx, me.name, args);
      return;
    }
    // Patients can add to their own history, and change only what they added.
    if (me?.role === 'patient' && me.patientId === args.patientId) {
      if (args.id !== 0n) {
        const existing = ctx.db.historyItem.id.find(args.id);
        if (!existing || existing.patientId !== me.patientId || existing.createdBy !== me.name) {
          throw new SenderError('You can only change history you added yourself');
        }
      }
      saveHistory(ctx, me.name, args);
      return;
    }
    throw new SenderError('Only the care team or the patient can change history');
  }
);

export const deleteHistoryItem = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const h = ctx.db.historyItem.id.find(id);
  if (!h) return;
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  // The care team can remove anything; patients only the notes they added.
  const mine = me?.role === 'patient' && me.patientId === h.patientId && h.createdBy === me.name;
  if (me?.role !== 'nurse' && !mine) {
    throw new SenderError('Only the care team, or you for notes you added, can remove history');
  }
  ctx.db.historyItem.id.delete(id);
  audit(ctx, h.patientId, me?.name ?? 'system', 'history_removed', h.title);
});

export const saveAssistiveDevice = spacetimedb.reducer(
  { id: t.u64(), patientId: t.u64(), name: t.string(), detail: t.string(), sinceText: t.string() },
  (ctx, args) => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    if (me?.role === 'nurse') {
      saveDevice(ctx, me.name, args);
      return;
    }
    // Patients can add devices to their own chart, and change only what they added.
    if (me?.role === 'patient' && me.patientId === args.patientId) {
      if (args.id !== 0n) {
        const existing = ctx.db.assistiveDevice.id.find(args.id);
        if (!existing || existing.patientId !== me.patientId || existing.createdBy !== me.name) {
          throw new SenderError('You can only change devices you added yourself');
        }
      }
      saveDevice(ctx, me.name, args);
      return;
    }
    throw new SenderError('Only the care team or the patient can change devices');
  }
);

export const deleteAssistiveDevice = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const d = ctx.db.assistiveDevice.id.find(id);
  if (!d) return;
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  // The care team can remove anything; patients only the devices they added.
  const mine = me?.role === 'patient' && me.patientId === d.patientId && d.createdBy === me.name;
  if (me?.role !== 'nurse' && !mine) {
    throw new SenderError('Only the care team, or you for devices you added, can remove a device');
  }
  ctx.db.assistiveDevice.id.delete(id);
  audit(ctx, d.patientId, me?.name ?? 'system', 'device_removed', d.name);
});

/**
 * Confirm a device on the chart is in use — the reconciliation step between the patient
 * and the care team. Either side can confirm; editing a device clears its confirmation.
 */
export const confirmAssistiveDevice = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const d = ctx.db.assistiveDevice.id.find(id);
  if (!d) return;
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (me?.role !== 'nurse' && !(me?.role === 'patient' && me.patientId === d.patientId)) {
    throw new SenderError('Only the care team or the patient can confirm devices');
  }
  ctx.db.assistiveDevice.id.update({ ...d, confirmedBy: me.name, confirmedAt: ctx.timestamp });
  audit(ctx, d.patientId, me.name, 'device_confirmed', d.name);
});

/** Record one head-to-toe system finding. `id` of 0n inserts; otherwise an existing row is corrected. */
export const saveSystemAssessment = spacetimedb.reducer(
  {
    id: t.u64(),
    patientId: t.u64(),
    system: t.string(),
    status: t.string(),
    findings: t.string(),
    region: t.string(),
    assessedAt: t.timestamp(),
  },
  (ctx, args) => {
    const me = requireNurse(ctx);
    const p = ctx.db.patient.id.find(args.patientId);
    if (!p) throw new SenderError('Unknown patient');
    if (!isAssessmentSystem(args.system)) throw new SenderError('Unknown system');
    if (!isAssessmentStatus(args.status)) throw new SenderError('Unknown status');
    if (args.findings.length > MAX_MED_TEXT) throw new SenderError('Findings are too long');
    if (args.region.length > 100) throw new SenderError('Region is too long');
    const fields = {
      patientId: p.id,
      system: args.system,
      status: args.status,
      findings: args.findings.trim(),
      region: args.region.trim(),
      assessedBy: me.name,
      assessedAt: args.assessedAt,
    };
    const what = `${assessmentLabel(args.system)} · ${statusLabel(args.status)}`;
    if (args.id === 0n) {
      ctx.db.systemAssessment.insert({ id: 0n, ...fields, createdAt: ctx.timestamp });
      audit(ctx, p.id, me.name, 'assessment_saved', what);
    } else {
      const existing = ctx.db.systemAssessment.id.find(args.id);
      if (!existing || existing.patientId !== p.id) throw new SenderError('Unknown assessment');
      ctx.db.systemAssessment.id.update({ ...existing, ...fields });
      audit(ctx, p.id, me.name, 'assessment_updated', what);
    }
  }
);

export const deleteSystemAssessment = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const me = requireNurse(ctx);
  const a = ctx.db.systemAssessment.id.find(id);
  if (!a) return;
  ctx.db.systemAssessment.id.delete(id);
  audit(ctx, a.patientId, me.name, 'assessment_removed', assessmentLabel(a.system));
});

/**
 * Record one mental-health check-in: a daily bipolar mood reading, or a PHQ-9 or
 * GAD-7 screening. Patients self-report on their own chart; the nurse can administer
 * on any chart. Red-flag rules run immediately: item 9 or crisis wording raises an
 * emergency alert that pushes crisis lines to the patient and notifies the family.
 */
export const logMentalHealthCheckIn = spacetimedb.reducer(
  { patientId: t.u64(), kind: t.string(), score: t.i32(), item9: t.u8(), sleepHours: t.f32(), notes: t.string() },
  (ctx, args) => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    const isNurse = me?.role === 'nurse';
    if (!isNurse && !(me?.role === 'patient' && me.patientId === args.patientId)) {
      throw new SenderError('Only the care team or the patient can log a mental-health check-in');
    }
    if (!isMhKind(args.kind)) throw new SenderError('Unknown check-in type');
    if (args.notes.length > 500) throw new SenderError('Notes are too long');
    const hits = insertMhCheckIn(ctx, me!.name, isNurse ? 'nurse' : 'patient', args.patientId, {
      kind: args.kind,
      score: args.score,
      item9: args.item9,
      sleepHours: args.sleepHours,
      notes: args.notes,
    }, ctx.timestamp);
    const kind = isMhKind(args.kind) ? args.kind : 'mood';
    const label = MH_KIND_LABEL[kind];
    audit(
      ctx,
      args.patientId,
      me!.name,
      'mh_check_in',
      hits.length > 0 ? `${label} · red flag raised` : label
    );
  }
);

/** Nurse can act on any chart; a patient only on their own chart. */
function apptAccess(ctx: Ctx, patientId: bigint): { me: { name: string }; isNurse: boolean } | null {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (!me) return null;
  if (me.role === 'nurse') return { me, isNurse: true };
  if (me.role === 'patient' && me.patientId === patientId) return { me, isNurse: false };
  return null;
}

/** Throw when another booked appointment for this patient overlaps the given time. */
function assertNoApptConflict(ctx: Ctx, patientId: bigint, whenAt: bigint, durationMin: number, skipId?: bigint) {
  const rows = [...ctx.db.appointment.patientId.filter(patientId)].filter(
    r => r.status === 'booked' && (skipId === undefined || r.id !== skipId)
  );
  for (const r of rows) {
    if (overlaps(whenAt, durationMin, r.whenAt.microsSinceUnixEpoch, r.durationMin)) {
      throw new SenderError('That time overlaps another appointment for this patient');
    }
  }
}

/** Shared validation for booking; returns the cleaned fields with narrow types. */
function validApptFields(args: { title: string; kind: string; mode: string; location: string; notes: string }): {
  title: string;
  kind: ApptKind;
  mode: ApptMode;
} {
  const title = args.title.trim();
  if (!title) throw new SenderError('Give the appointment a title');
  if (title.length > APPT_TITLE_MAX) throw new SenderError('Title is too long');
  if (!isApptKind(args.kind)) throw new SenderError('Unknown appointment type');
  if (!isApptMode(args.mode)) throw new SenderError('Unknown appointment mode');
  if (args.location.length > APPT_LOCATION_MAX) throw new SenderError('Location is too long');
  if (args.notes.length > APPT_NOTES_MAX) throw new SenderError('Notes are too long');
  return { title, kind: args.kind, mode: args.mode };
}

/**
 * Book one appointment. Patients book on their own chart, the nurse on any chart.
 * Booked times may not overlap an existing booked appointment for the same patient,
 * so a double-booking is stopped at the source instead of being discovered later.
 */
export const bookAppointment = spacetimedb.reducer(
  {
    patientId: t.u64(),
    title: t.string(),
    kind: t.string(),
    whenAt: t.i64(),
    durationMin: t.u32(),
    mode: t.string(),
    location: t.string(),
    notes: t.string(),
  },
  (ctx, args) => {
    const access = apptAccess(ctx, args.patientId);
    if (!access) throw new SenderError('Only the care team or the patient can book appointments');
    const f = validApptFields(args);
    if (!(APPT_DURATIONS as readonly number[]).includes(args.durationMin)) {
      throw new SenderError('Pick a duration from the menu');
    }
    if (args.whenAt < ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('Pick a time in the future');
    assertNoApptConflict(ctx, args.patientId, args.whenAt, args.durationMin);
    ctx.db.appointment.insert({
      id: 0n,
      patientId: args.patientId,
      title: f.title,
      kind: f.kind,
      whenAt: new Timestamp(args.whenAt),
      durationMin: args.durationMin,
      mode: f.mode,
      location: args.location.trim(),
      notes: args.notes.trim(),
      status: 'booked',
      createdBy: access.me.name,
      createdAt: ctx.timestamp,
    });
    audit(ctx, args.patientId, access.me.name, 'appointment_booked', `${APPT_KIND_LABEL[f.kind]}: ${f.title}`);
  }
);

/** Move or re-lengthen one appointment; the conflict check excludes the row itself. */
export const rescheduleAppointment = spacetimedb.reducer(
  { id: t.u64(), whenAt: t.i64(), durationMin: t.u32() },
  (ctx, args) => {
    const row = ctx.db.appointment.id.find(args.id);
    if (!row) throw new SenderError('Unknown appointment');
    const access = apptAccess(ctx, row.patientId);
    if (!access) throw new SenderError('Only the care team or the patient can reschedule appointments');
    if (row.status !== 'booked') throw new SenderError('Only booked appointments can be rescheduled');
    if (!(APPT_DURATIONS as readonly number[]).includes(args.durationMin)) {
      throw new SenderError('Pick a duration from the menu');
    }
    if (args.whenAt < ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('Pick a time in the future');
    assertNoApptConflict(ctx, row.patientId, args.whenAt, args.durationMin, row.id);
    ctx.db.appointment.id.update({ ...row, whenAt: new Timestamp(args.whenAt), durationMin: args.durationMin });
    audit(ctx, row.patientId, access.me.name, 'appointment_rescheduled', row.title);
  }
);

/**
 * Mark one appointment completed (nurse only) or cancel it (either side). Completed
 * rows stay on the schedule as history; cancelled rows stop counting for conflicts.
 */
export const setAppointmentStatus = spacetimedb.reducer({ id: t.u64(), status: t.string() }, (ctx, args) => {
  const row = ctx.db.appointment.id.find(args.id);
  if (!row) throw new SenderError('Unknown appointment');
  if (!isApptStatus(args.status)) throw new SenderError('Unknown status');
  const access = apptAccess(ctx, row.patientId);
  if (!access) throw new SenderError('Only the care team or the patient can change an appointment');
  if (args.status === 'done' && !access.isNurse) {
    throw new SenderError('Only the care team can mark an appointment completed');
  }
  if (row.status === args.status) return;
  ctx.db.appointment.id.update({ ...row, status: args.status });
  audit(ctx, row.patientId, access.me.name, `appointment_${args.status}`, `${row.title}`);
});

export const importFdaLabel = spacetimedb.reducer({ entryId: t.u64() }, (ctx, { entryId }) => {
  const me = requireNurse(ctx);
  const e = ctx.db.libraryEntry.id.find(entryId);
  if (!e) throw new SenderError('Unknown library entry');
  if (e.kind !== 'medication') throw new SenderError('Only medication entries can import an FDA label');
  const queued = [...ctx.db.libImportJob.iter()].some(j => j.entryId === entryId);
  if (queued) throw new SenderError('An import is already running for this entry');
  ctx.db.libImportJob.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch),
    entryId,
  });
  audit(ctx, 0n, me.name, 'library_import_requested', e.name);
});

export const runLibImport = spacetimedb.procedure(
  { onSchedule: libImportJob },
  { job: libImportJob.rowType },
  t.unit(),
  (ctx, { job }) => {
    if (!ctx.sender.isEqual(ctx.databaseIdentity)) {
      throw new SenderError('Library imports must run on the scheduler');
    }
    const entry = ctx.withTx(tx => tx.db.libraryEntry.id.find(job.entryId));
    if (!entry || entry.kind !== 'medication') return {};

    const finish = (sections: LibSectionData[], detail: string) =>
      ctx.withTx(tx => {
        const e = tx.db.libraryEntry.id.find(entry.id);
        if (!e) return;
        // Only the FDA-authored sections are replaced; curated text stays put.
        for (const s of [...tx.db.librarySection.entryId.filter(e.id)]) {
          if (s.heading.startsWith(FDA_SECTION_PREFIX)) tx.db.librarySection.id.delete(s.id);
        }
        const kept = [...tx.db.librarySection.entryId.filter(e.id)].sort((a, b) => a.position - b.position);
        kept.forEach((s, i) => {
          if (s.position !== i) tx.db.librarySection.id.update({ ...s, position: i });
        });
        sections.forEach((sec, i) => {
          tx.db.librarySection.insert({
            id: 0n,
            entryId: e.id,
            position: kept.length + i,
            heading: sec.heading,
            body: sec.body,
            patient: sec.patient,
          });
        });
        tx.db.libraryEntry.id.update({ ...e, updatedBy: 'openFDA import', updatedAt: tx.timestamp });
        audit(tx, 0n, 'openFDA', 'library_imported', detail);
      });

    try {
      const res = ctx.http.fetch(fdaLabelUrl(entry.name), { timeout: TimeDuration.fromMillis(30_000) });
      const text = res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text) as { results?: FdaLabelResult[] };
      const result = pickFdaResult(body.results ?? [], entry.name);
      if (!result) throw new Error('No FDA label found for this medication');
      const sections = fdaSections(result);
      if (sections.length === 0) throw new Error('The FDA label had no readable sections');
      const setid = result.openfda?.spl_setid?.[0];
      finish(sections, `${entry.name}: ${sections.length} label sections${setid ? ` (DailyMed set ${setid})` : ''}`);
    } catch (e) {
      ctx.withTx(tx => audit(tx, 0n, 'openFDA', 'library_import_failed', String(e).slice(0, 200)));
    }
    return {};
  }
);

// ---------------------------------------------------------------------------
// Co-viewing pointer
// ---------------------------------------------------------------------------

export const updatePointer = spacetimedb.reducer(
  { patientId: t.u64(), x: t.f32(), y: t.f32(), z: t.f32(), pointing: t.bool() },
  (ctx, { patientId, x, y, z, pointing }) => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    const row = {
      identity: ctx.sender,
      name: me?.name ?? 'Guest',
      role: me?.role ?? 'guest',
      patientId,
      x,
      y,
      z,
      pointing,
      updatedAt: ctx.timestamp,
    };
    if (ctx.db.presence.identity.find(ctx.sender)) ctx.db.presence.identity.update(row);
    else ctx.db.presence.insert(row);
  }
);

// ---------------------------------------------------------------------------
// Demo controls and simulated Twin Pod
// ---------------------------------------------------------------------------

export const setScenario = spacetimedb.reducer(
  { patientId: t.u64(), scenario: t.string() },
  (ctx, { patientId, scenario }) => {
    if (!(SCENARIOS as readonly string[]).includes(scenario)) {
      throw new SenderError('Unknown scenario');
    }
    const s = ctx.db.simState.patientId.find(patientId);
    if (!s) throw new SenderError('Unknown patient');
    ctx.db.simState.patientId.update({ ...s, scenario, tick: 0 });
    audit(ctx, patientId, actorName(ctx, ctx.sender), 'demo_scenario', scenario);
  }
);

export const resetDemo = spacetimedb.reducer(ctx => {
  clearClinicalData(ctx);
  clearHealthData(ctx);
  for (const s of ctx.db.simState.iter()) {
    ctx.db.simState.patientId.update({
      ...s,
      scenario: s.scenario === 'fluid' ? 'fluid' : 'normal',
      tick: 0,
      steps: 0,
    });
  }
  seedCheckIns(ctx);
  seedMentalHealthCheckIns(ctx);
  seedAppointments(ctx);
  seedHealth(ctx);
});

/** Fills in the example history on databases published before it existed. */
export const loadExampleCheckIns = spacetimedb.reducer(ctx => {
  seedCheckIns(ctx);
});

export const loadExampleHealth = spacetimedb.reducer(ctx => {
  seedHealth(ctx);
});

/** Fills in the demo assistive devices on databases published before they existed. */
export const loadExampleDevices = spacetimedb.reducer(ctx => {
  seedDevices(ctx);
});

/** Fills in the demo head-to-toe assessments on databases published before they existed. */
export const loadExampleAssessments = spacetimedb.reducer(ctx => {
  seedAssessments(ctx);
});

/** Adds the demo appointment schedule on databases published before it existed. */
export const loadExampleAppointments = spacetimedb.reducer(ctx => {
  seedAppointments(ctx);
});

/**
 * Adds the mental-health demo (patients, chart entries, screening history and its
 * red-flag alerts) on databases published before it existed.
 */
export const loadExampleMentalHealth = spacetimedb.reducer(ctx => {
  for (const s of LIBRARY) seedLibraryEntry(ctx, s);
  seedMentalHealthPatients(ctx);
  seedMentalHealthCheckIns(ctx);
});

/** Adds curated library entries that are missing, on databases published before they existed. */
export const loadCuratedLibrary = spacetimedb.reducer(ctx => {
  for (const s of LIBRARY) seedLibraryEntry(ctx, s);
});

// ---------------------------------------------------------------------------
// Health tracking: wearables, imports, manual logs, medications
// ---------------------------------------------------------------------------

const MAX_IMPORT = 4000;

/** Bulk upsert from an Apple Health export or a Google Health sync. Re-syncing replaces matching readings. */
export const importHealthSamples = spacetimedb.reducer(
  {
    patientId: t.u64(),
    kind: t.string(),
    device: t.string(),
    source: t.string(),
    samples: t.array(HealthSampleInput),
  },
  (ctx, { patientId, kind, device, source, samples }) => {
    const p = requirePatientAccess(ctx, patientId);
    if (source !== 'apple_health' && source !== 'google_health') throw new SenderError('Unknown source');
    if (samples.length > MAX_IMPORT) throw new SenderError(`Send at most ${MAX_IMPORT} readings at a time`);
    const name = device.trim().slice(0, 80) || (source === 'apple_health' ? 'Apple Health' : 'Google Health');

    const existing = new Map<string, bigint>();
    for (const s of ctx.db.healthSample.patientId.filter(p.id)) {
      if (s.source === source && s.device === name) existing.set(`${s.metric}|${s.startAt.microsSinceUnixEpoch}|${s.label}`, s.id);
    }
    let added = 0;
    for (const s of samples) {
      const m = METRIC[s.metric];
      if (!m || !Number.isFinite(s.value) || s.value < m.min || s.value > m.max) continue;
      const row = {
        id: 0n,
        patientId: p.id,
        metric: s.metric,
        value: s.value,
        label: s.label.slice(0, 80),
        startAt: s.startAt,
        endAt: s.endAt,
        source,
        device: name,
        createdBy: ctx.sender,
        createdAt: ctx.timestamp,
      };
      const key = `${s.metric}|${s.startAt.microsSinceUnixEpoch}|${row.label}`;
      const prior = existing.get(key);
      if (prior !== undefined) ctx.db.healthSample.id.update({ ...row, id: prior });
      else {
        const inserted = ctx.db.healthSample.insert(row);
        existing.set(key, inserted.id);
      }
      added++;
    }

    const known = [...ctx.db.healthDevice.patientId.filter(p.id)].find(d => d.name === name && d.source === source);
    if (known) ctx.db.healthDevice.id.update({ ...known, lastSyncAt: ctx.timestamp });
    else {
      ctx.db.healthDevice.insert({
        id: 0n,
        patientId: p.id,
        kind,
        name,
        source,
        demo: false,
        connectedAt: ctx.timestamp,
        lastSyncAt: ctx.timestamp,
      });
    }
    audit(ctx, p.id, actorName(ctx, ctx.sender), 'health_synced', `${added} readings from ${name}`);
    runHealthRules(ctx, p.id);
  }
);

/** A single reading entered by hand ("Add Data"), a medication dose, a mood or a period day. */
export const logHealthSample = spacetimedb.reducer(
  { patientId: t.u64(), metric: t.string(), value: t.f64(), label: t.string(), at: t.timestamp() },
  (ctx, { patientId, metric, value, label, at }) => {
    const p = requirePatientAccess(ctx, patientId);
    const m = METRIC[metric];
    if (!m || !m.manual) throw new SenderError('This measurement cannot be entered by hand');
    if (!Number.isFinite(value) || value < m.min || value > m.max) {
      throw new SenderError(`${m.label} must be between ${m.min} and ${m.max} ${m.unit}`);
    }
    const when = at.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch ? ctx.timestamp : at;
    ctx.db.healthSample.insert({
      id: 0n,
      patientId: p.id,
      metric,
      value,
      label: label.slice(0, 80),
      startAt: when,
      endAt: when,
      source: 'manual',
      device: actorName(ctx, ctx.sender) === 'system' ? 'Entered by hand' : `Entered by ${actorName(ctx, ctx.sender)}`,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    const shown = metric === 'medication' ? `${label}: ${value ? 'taken' : 'skipped'}` : `${m.label} ${Math.round(value * 10) / 10} ${m.unit}`;
    audit(ctx, p.id, actorName(ctx, ctx.sender), 'health_logged', shown);
    runHealthRules(ctx, p.id);
  }
);

export const deleteHealthSample = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const s = ctx.db.healthSample.id.find(id);
  if (!s) return;
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  const own = s.createdBy.equals(ctx.sender) || (me?.role === 'patient' && me.patientId === s.patientId);
  if (!own) requireNurse(ctx);
  ctx.db.healthSample.id.delete(id);
});

/** Pairs a simulated device for the demo and backfills four weeks of typical readings. */
export const pairDemoDevice = spacetimedb.reducer(
  { patientId: t.u64(), kind: t.string() },
  (ctx, { patientId, kind }) => {
    const p = requirePatientAccess(ctx, patientId);
    const k = DEVICE_KINDS[kind];
    if (!k) throw new SenderError('Unknown device');
    const name = `${k.name} (demo)`;
    if ([...ctx.db.healthDevice.patientId.filter(p.id)].some(d => d.name === name)) return;
    ctx.db.healthDevice.insert({
      id: 0n,
      patientId: p.id,
      kind,
      name,
      source: k.source,
      demo: true,
      connectedAt: ctx.timestamp,
      lastSyncAt: ctx.timestamp,
    });
    insertDemoSamples(ctx, p.id, pairedDeviceHistory(kind, name, () => ctx.random()));
    audit(ctx, p.id, actorName(ctx, ctx.sender), 'device_paired', name);
  }
);

/** Disconnects a source and deletes the readings it contributed. */
export const removeHealthDevice = spacetimedb.reducer({ deviceId: t.u64() }, (ctx, { deviceId }) => {
  const d = ctx.db.healthDevice.id.find(deviceId);
  if (!d) return;
  requirePatientAccess(ctx, d.patientId);
  for (const s of [...ctx.db.healthSample.patientId.filter(d.patientId)]) {
    if (s.device === d.name && s.source === d.source) ctx.db.healthSample.id.delete(s.id);
  }
  ctx.db.healthDevice.id.delete(d.id);
  audit(ctx, d.patientId, actorName(ctx, ctx.sender), 'device_removed', d.name);
});

const SCHEDULES = ['Once daily', 'Twice daily', 'Three times daily', 'As needed'];

export const addMedication = spacetimedb.reducer(
  { patientId: t.u64(), name: t.string(), dose: t.string(), schedule: t.string() },
  (ctx, { patientId, name, dose, schedule }) => {
    const p = requirePatientAccess(ctx, patientId);
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new SenderError('Medication name required');
    if (!SCHEDULES.includes(schedule)) throw new SenderError('Unknown schedule');
    insertSimpleMed(ctx, p.id, { name: clean, dose: dose.trim().slice(0, 80), schedule }, actorName(ctx, ctx.sender));
    audit(ctx, p.id, actorName(ctx, ctx.sender), 'medication_added', `${clean} · ${schedule}`);
  }
);

export const removeMedication = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const m = ctx.db.medication.id.find(id);
  if (!m) return;
  requirePatientAccess(ctx, m.patientId);
  for (const d of [...ctx.db.medDose.medicationId.filter(id)]) ctx.db.medDose.id.delete(d.id);
  ctx.db.medication.id.delete(id);
  audit(ctx, m.patientId, actorName(ctx, ctx.sender), 'medication_removed', m.name);
});

export const simTick = spacetimedb.reducer(
  { onSchedule: simTimer },
  { timer: simTimer.rowType },
  (ctx, _args) => {
    const noise = () => ctx.random() * 2 - 1;
    for (const s of ctx.db.simState.iter()) {
      const tick = s.tick + 1;
      const v = simulateVitals(s.scenario, tick, noise);
      ctx.db.simState.patientId.update({ ...s, tick });
      ctx.db.vitalSign.insert({
        id: 0n,
        patientId: s.patientId,
        ts: ctx.timestamp,
        ...v,
        glucoseMgDl: 0,
        source: 'sim',
      });

      const window = recentVitals(ctx, s.patientId);
      for (const old of window.slice(0, Math.max(0, window.length - VITALS_KEPT_PER_PATIENT))) {
        ctx.db.vitalSign.id.delete(old.id);
      }
      if (tick % 2 === 0) {
        raiseAlerts(ctx, s.patientId, vitalRules(window.slice(-60)));
      }
      updateRisk(ctx, s.patientId, window);
    }
  }
);

// ---------------------------------------------------------------------------
// Claude triage + SBAR (scheduled procedure, the only place with network I/O)
// ---------------------------------------------------------------------------

type TriageInput = {
  sbarId: bigint;
  alertPriority: string;
  payload: string;
  fallback: TriageResult;
  /** Left out of the payload; the template draft still names the patient. */
  patientName: string;
};

type TriageResult = {
  priority: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  uncertainties: string[];
  questions_for_patient: string[];
};

function riskSummary(risk: { prob: number; level: string; drivers: string; hours: number }) {
  const drivers: Driver[] = JSON.parse(risk.drivers);
  return {
    output: 'Calibrated chance of sepsis onset within the next 6 hours, from vital-sign trends',
    probability_pct: Math.round(risk.prob * 1000) / 10,
    level: risk.level,
    level_thresholds_pct: {
      elevated: Math.round(RISK_MODEL.THRESHOLDS.elevated * 1000) / 10,
      high: Math.round(RISK_MODEL.THRESHOLDS.high * 1000) / 10,
    },
    top_drivers: drivers.map(d => `${d.label} ${d.value} (${d.effect > 0 ? 'raises' : 'lowers'} risk)`),
    readings_used: risk.hours,
    limitations: `Advisory only. Gradient-boosted trees trained on ICU stays (PhysioNet 2019, hospital A); AUROC ${RISK_MODEL.MODEL_CARD.auroc} on an unseen hospital versus ${RISK_MODEL.MODEL_CARD.aurocNews2} for NEWS2. Not validated for home monitoring. Pod vitals are simulated, and each 5-second reading stands in for one hour.`,
  };
}

function gatherTriageInput(ctx: Ctx, sbarId: bigint): TriageInput | null {
  const report = ctx.db.sbarReport.id.find(sbarId);
  if (!report) return null;
  const a = ctx.db.alert.id.find(report.alertId);
  const p = ctx.db.patient.id.find(report.patientId);
  if (!a || !p) return null;

  const day = Number(
    (ctx.timestamp.microsSinceUnixEpoch - p.surgeryAt.microsSinceUnixEpoch) / DAY_MICROS
  );
  const symptoms = [...ctx.db.symptomEntry.patientId.filter(p.id)]
    .sort((x, y) => (x.createdAt.microsSinceUnixEpoch < y.createdAt.microsSinceUnixEpoch ? 1 : -1))
    .slice(0, 8)
    .map(s => ({
      region: regionText(s.region),
      onset: s.onset,
      provocation: s.provocation,
      quality: s.quality,
      radiation: s.radiation,
      severity: s.severity,
      timing: s.timing,
      swelling: s.swelling,
      warmth: s.warmth,
      redness: s.redness,
      shortness_of_breath: s.shortnessOfBreath,
      chest_pain: s.chestPain,
      body_temp_c: s.bodyTempC || null,
      notes: s.notes,
      source: s.source,
    }));
  const vitals = recentVitals(ctx, p.id).slice(-60);
  const stat = (f: (v: (typeof vitals)[number]) => number) => {
    if (vitals.length === 0) return null;
    const xs = vitals.map(f);
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      latest: r(xs[xs.length - 1]!),
      min: r(Math.min(...xs)),
      max: r(Math.max(...xs)),
      avg: r(xs.reduce((s, n) => s + n, 0) / xs.length),
    };
  };
  const meds = [...ctx.db.medication.patientId.filter(p.id)].filter(m => m.active);
  const medName = new Map(meds.map(m => [m.id, m.name]));
  const medications = meds.map(m => ({
    name: m.name,
    type: MED_KIND_LABEL[m.kind] ?? m.kind,
    dose: m.dose,
    route: m.route,
    daily_times_local: m.scheduleTimes.split(','),
    contraindications: m.contraindications.split('\n').filter(Boolean),
  }));
  const recentDoses = [...ctx.db.medDose.patientId.filter(p.id)]
    .filter(d => d.status !== 'due' && medName.has(d.medicationId))
    .sort((x, y) => (x.scheduledFor.microsSinceUnixEpoch < y.scheduledFor.microsSinceUnixEpoch ? 1 : -1))
    .slice(0, 12)
    .map(d => ({
      medication: medName.get(d.medicationId),
      status: d.status,
      hours_ago: Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - d.scheduledFor.microsSinceUnixEpoch) / 360_000_000) / 10,
      glucose_mg_dl: d.glucoseMgDl || null,
    }));
  const recentLabs = [...ctx.db.labResult.patientId.filter(p.id)]
    .sort((x, y) => (x.resultedAt.microsSinceUnixEpoch < y.resultedAt.microsSinceUnixEpoch ? 1 : -1))
    .slice(0, 8)
    .map(l => ({
      name: l.name,
      value: l.value,
      unit: l.unit,
      flag: l.flag || 'no_reference_range',
      notes: l.notes,
      hours_ago: Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - l.resultedAt.microsSinceUnixEpoch) / 360_000_000) / 10,
    }));
  const healthHistory = [...ctx.db.historyItem.patientId.filter(p.id)].map(h => ({
    category: h.category,
    title: h.title,
    detail: h.detail,
    when: h.whenText,
  }));
  const assistiveDevices = [...ctx.db.assistiveDevice.patientId.filter(p.id)].map(d => ({
    name: d.name,
    notes: d.detail,
    since: d.sinceText,
    confirmed_by: d.confirmedBy === '' ? false : d.confirmedBy,
  }));
  const nursingAssessment = [...latestBySystem([...ctx.db.systemAssessment.patientId.filter(p.id)]).values()].map(
    a => ({
      system: assessmentLabel(a.system),
      status: a.status,
      findings: a.findings,
      hours_ago: Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - a.assessedAt.microsSinceUnixEpoch) / 3_600_000) / 10,
    })
  );
  // Mental-health state: latest screenings plus the bipolar mood trail with sleep.
  const mhRows = [...ctx.db.mentalHealthCheckIn.patientId.filter(p.id)].sort((x, y) =>
    x.createdAt.microsSinceUnixEpoch < y.createdAt.microsSinceUnixEpoch ? 1 : -1
  );
  const mhHoursAgo = (r: (typeof mhRows)[number]) =>
    Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - r.createdAt.microsSinceUnixEpoch) / 3_600_000) / 10;
  const latestByMhKind = (kind: string) => mhRows.find(r => r.kind === kind);
  const mentalHealth = {
    latest_phq9: (() => {
      const r = latestByMhKind('phq9');
      return r ? { score: r.score, band: r.band, item9_self_harm: r.item9, hours_ago: mhHoursAgo(r) } : null;
    })(),
    latest_gad7: (() => {
      const r = latestByMhKind('gad7');
      return r ? { score: r.score, band: r.band, hours_ago: mhHoursAgo(r) } : null;
    })(),
    mood_days_oldest_first: mhRows
      .filter(r => r.kind === 'mood')
      .slice(0, 7)
      .reverse()
      .map(r => ({ mood: r.score, sleep_hours: r.sleepHours, note: r.notes || undefined })),
    red_flag_note:
      'A positive PHQ-9 item 9 (thoughts of self-harm) or crisis wording means contact the patient now; 988 (call/text) is the national crisis line.',
  };
  const codes = a.reasonCodes.split(',').filter(Boolean);
  const risk = ctx.db.riskScore.patientId.find(p.id);
  const payload = JSON.stringify(
    {
      patient: {
        age: p.age,
        procedure: p.procedure,
        side: p.side,
        days_since_monitoring_start: day,
      },
      rule_results: {
        priority_floor: a.priority,
        reasons: codes.map(c => REASON_LABEL[c] ?? c),
      },
      recent_symptoms_newest_first: symptoms,
      active_medications: medications,
      recent_medication_doses_newest_first: recentDoses,
      recent_labs_newest_first: recentLabs,
      health_history: healthHistory,
      assistive_devices: assistiveDevices,
      nursing_assessment_latest_by_system: nursingAssessment,
      mental_health: mentalHealth,
      pod_vitals_last_5_minutes: {
        note: 'Simulated Twin Pod data for the prototype',
        heart_rate_bpm: stat(v => v.hr),
        systolic_bp_mmhg: stat(v => v.systolic),
        diastolic_bp_mmhg: stat(v => v.diastolic),
        respiratory_rate_per_min: stat(v => v.respRate),
        spo2_pct: stat(v => v.spo2),
        temperature_c: stat(v => v.tempC),
      },
      wearables_and_home_logs: healthDigest(healthPoints(ctx, p.id), Number(ctx.timestamp.microsSinceUnixEpoch)),
      deterioration_model: risk ? riskSummary(risk) : null,
    },
    null,
    2
  );

  const latest = symptoms[0];
  const fallback: TriageResult = {
    priority: a.priority === 'emergency' ? 'same_day' : a.priority,
    situation: `${p.name}, day ${day} at home (${p.procedure.toLowerCase()}). Rules flagged: ${codes
      .map(c => REASON_LABEL[c] ?? c)
      .join('; ')}.`,
    background: `${p.age}-year-old monitored at home. ${symptoms.length} recent check-in(s).`,
    assessment: latest
      ? `Most recent report: ${latest.quality || 'pain'} at ${latest.region}, ${latest.severity}/10.`
      : 'Flag raised from pod vitals; no recent symptom report.',
    recommendation: 'Nurse to review and contact patient.',
    uncertainties: ['Template draft: the AI draft was not available.'],
    questions_for_patient: [],
  };
  return { sbarId, alertPriority: a.priority, payload, fallback, patientName: p.name };
}

export const runSbarJob = spacetimedb.procedure(
  { onSchedule: sbarJob },
  { job: sbarJob.rowType },
  t.unit(),
  (ctx, { job }) => {
    const input = ctx.withTx(tx => gatherTriageInput(tx, job.sbarId));
    if (!input) return {};

    const apiKey = ctx.env.ANTHROPIC_API_KEY;
    const model = ctx.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
    let result = input.fallback;
    let modelUsed = 'template';
    let status = 'draft';

    if (apiKey) {
      try {
        const res = ctx.http.fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1500,
            system: TRIAGE_SYSTEM_PROMPT,
            tools: [TRIAGE_TOOL],
            tool_choice: { type: 'tool', name: TRIAGE_TOOL.name },
            messages: [{ role: 'user', content: input.payload }],
          }),
          timeout: TimeDuration.fromMillis(45_000),
        });
        const text = res.text();
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const body = JSON.parse(text) as {
          content?: Array<{ type: string; name?: string; input?: Partial<TriageResult> }>;
        };
        const block = body.content?.find(c => c.type === 'tool_use' && c.name === TRIAGE_TOOL.name);
        const out = block?.input;
        if (!out || !out.situation || !out.assessment) throw new Error('Missing tool output');
        result = {
          priority: ['routine', 'review_24h', 'same_day'].includes(out.priority ?? '')
            ? out.priority!
            : input.fallback.priority,
          situation: out.situation,
          background: out.background ?? '',
          assessment: out.assessment,
          recommendation: out.recommendation ?? '',
          uncertainties: Array.isArray(out.uncertainties) ? out.uncertainties.map(String) : [],
          questions_for_patient: Array.isArray(out.questions_for_patient)
            ? out.questions_for_patient.map(String)
            : [],
        };
        modelUsed = model;
      } catch (e) {
        console.error(`Claude triage failed: ${String(e)}`);
        result = {
          ...input.fallback,
          uncertainties: ['The AI draft failed, so this is the template draft.'],
        };
        status = 'error';
      }
    }

    // A second model (DeepSeek on Bitdeer) reviews the draft and lists its uncertainties.
    const bitdeerKey = ctx.env.BITDEER_API_KEY?.trim();
    const anonymize = (text: string) => (input.patientName ? text.split(input.patientName).join('The patient') : text);
    if (bitdeerKey) {
      try {
        const res = ctx.http.fetch(BITDEER_CHAT_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${bitdeerKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(
            uncertaintyRequestBody(ctx.env.BITDEER_MODEL || DEFAULT_UNCERTAINTY_MODEL, input.payload, {
              situation: anonymize(result.situation),
              background: anonymize(result.background),
              assessment: anonymize(result.assessment),
              recommendation: anonymize(result.recommendation),
            })
          ),
          timeout: TimeDuration.fromMillis(30_000),
        });
        const text = res.text();
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
        const list = parseUncertainties(body.choices?.[0]?.message?.content ?? '');
        if (!list) throw new Error('No uncertainties in the reply');
        // Keep the note that the AI draft failed; the template's "not available" note is replaced.
        result = { ...result, uncertainties: status === 'error' ? [...result.uncertainties, ...list] : list };
      } catch (e) {
        console.error(`Uncertainty review failed: ${String(e)}`);
      }
    }

    ctx.withTx(tx => {
      const report = tx.db.sbarReport.id.find(input.sbarId);
      if (!report || report.status === 'approved') return;
      tx.db.sbarReport.id.update({
        ...report,
        status,
        model: modelUsed,
        suggestedPriority: result.priority,
        situation: result.situation,
        background: result.background,
        assessment: result.assessment,
        recommendation: result.recommendation,
        uncertainties: result.uncertainties.join('\n'),
        questions: result.questions_for_patient.join('\n'),
        draftSnapshot: [
          result.situation,
          result.background,
          result.assessment,
          result.recommendation,
        ].join('\n'),
        updatedAt: tx.timestamp,
      });
      // Claude may raise the priority above the rule floor, never lower it.
      const a = tx.db.alert.id.find(report.alertId);
      if (a && a.status !== 'resolved' && priorityRank(result.priority) > a.rank) {
        tx.db.alert.id.update({
          ...a,
          priority: result.priority,
          rank: priorityRank(result.priority),
          raisedBy: 'rules+claude',
          status: 'open',
        });
      }
      audit(
        tx,
        report.patientId,
        modelUsed === 'template' ? 'system' : 'AI',
        'sbar_drafted',
        `${modelUsed === 'template' ? 'template' : 'AI draft'} · suggested ${result.priority}`
      );
    });
    return {};
  }
);

// ---------------------------------------------------------------------------
// Shared record writes
//
// These hold the one write path for each record type so the manual forms and the
// confirmed voice updates cannot drift apart.
// ---------------------------------------------------------------------------

type SymptomInput = {
  patientId: bigint;
  region: string;
  x: number;
  y: number;
  z: number;
  onset: string;
  provocation: string;
  quality: string;
  radiation: string;
  severity: number;
  timing: string;
  swelling: boolean;
  warmth: boolean;
  redness: boolean;
  shortnessOfBreath: boolean;
  chestPain: boolean;
  bodyTempC: number;
  notes: string;
  source: string;
};

/** Insert one check-in and raise whatever rules it trips. */
function insertSymptom(ctx: Ctx, who: string, input: SymptomInput) {
  const p = ctx.db.patient.id.find(input.patientId);
  if (!p) throw new SenderError('Unknown patient');
  if (input.severity > 10) throw new SenderError('Severity must be 0-10');

  const previous = [...ctx.db.symptomEntry.patientId.filter(p.id)].sort((a, b) =>
    a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
  )[0];

  const entry = ctx.db.symptomEntry.insert({
    id: 0n,
    ...input,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
  });
  audit(
    ctx,
    p.id,
    who,
    'symptom_logged',
    `${regionText(entry.region)} · ${entry.quality || 'pain'} ${entry.severity}/10 (${entry.source})`
  );
  raiseAlerts(ctx, p.id, [
    ...symptomRules(p.side, entry, previous),
    // Someone describing a mental-health crisis in a plain check-in note needs the same
    // urgent path as a screening flag: emergency alert, crisis lines pushed, family told.
    ...(isCrisisNote(entry.notes) ? [{ code: 'CRISIS_LANGUAGE', priority: 'emergency' }] : []),
  ]);
}

/** Log one scheduled dose as taken or skipped, with the rules that follow. */
function applyDoseLog(
  ctx: Ctx,
  who: string,
  doseId: bigint,
  status: string,
  glucoseMgDl: number,
  note: string
) {
  const d = ctx.db.medDose.id.find(doseId);
  if (!d) throw new SenderError('Unknown dose');
  if (status !== 'taken' && status !== 'skipped') throw new SenderError('Status must be taken or skipped');
  if (d.status === 'taken' || d.status === 'skipped') throw new SenderError('This dose is already logged');
  if (!(glucoseMgDl >= 0 && glucoseMgDl <= 900)) {
    throw new SenderError('Glucose must be between 0 and 900 mg/dL');
  }
  if (note.length > 500) throw new SenderError('Note is too long');
  const m = ctx.db.medication.id.find(d.medicationId);
  if (m?.requiresGlucose && status === 'taken' && !(glucoseMgDl > 0)) {
    throw new SenderError('Enter a blood sugar reading before logging this dose');
  }
  ctx.db.medDose.id.update({
    ...d,
    status,
    glucoseMgDl,
    note: note.trim(),
    loggedAt: ctx.timestamp,
    loggedBy: who,
  });
  const late = d.status === 'missed' ? ' (late)' : '';
  const glucose = glucoseMgDl > 0 ? ` · glucose ${Math.round(glucoseMgDl)} mg/dL` : '';
  audit(
    ctx,
    d.patientId,
    who,
    status === 'taken' ? 'dose_taken' : 'dose_skipped',
    `${m?.name ?? 'Dose'} ${m?.dose ?? ''}${late}${glucose}`
  );
  raiseAlerts(ctx, d.patientId, [
    ...glucoseRules(glucoseMgDl),
    ...(m && d.status !== 'missed' ? doseRules(m.kind, status) : []),
  ]);
}

/** Enter one lab result and raise a critical-value alert when the library flags it. */
function insertLab(
  ctx: Ctx,
  who: string,
  args: { patientId: bigint; name: string; value: number; unit: string; notes: string; resultedAt: Timestamp }
) {
  const p = ctx.db.patient.id.find(args.patientId);
  if (!p) throw new SenderError('Unknown patient');
  if (!Number.isFinite(args.value)) throw new SenderError('Value must be a number');
  const name = args.name.trim();
  if (!name) throw new SenderError('Lab name is required');
  if (args.notes.length > 500) throw new SenderError('Notes are too long');
  const entry = matchEntry([...ctx.db.libraryEntry.iter()], name, 'lab');
  const flag = entry ? labFlag(args.value, entry) : '';
  ctx.db.labResult.insert({
    id: 0n,
    patientId: p.id,
    slug: entry?.slug ?? '',
    name: entry?.name ?? name,
    value: args.value,
    unit: args.unit.trim() || entry?.unit || '',
    flag,
    notes: args.notes.trim(),
    resultedAt: args.resultedAt,
    enteredBy: who,
    createdAt: ctx.timestamp,
  });
  const unit = (args.unit.trim() || entry?.unit || '').trim();
  const shown = `${Math.round(args.value * 10) / 10}${unit ? ` ${unit}` : ''}`;
  audit(
    ctx,
    p.id,
    who,
    'lab_entered',
    `${entry?.name ?? name} ${shown}${flag ? ` (${flag.replace('_', ' ')})` : ''}`
  );
  if (entry && isCritical(flag)) {
    raiseAlerts(ctx, p.id, [{ code: 'CRITICAL_LAB', priority: 'emergency' }]);
  }
}

/** Add or update one health-history item. `id` of 0n inserts. */
function saveHistory(
  ctx: Ctx,
  who: string,
  args: { id: bigint; patientId: bigint; category: string; title: string; detail: string; whenText: string }
) {
  const p = ctx.db.patient.id.find(args.patientId);
  if (!p) throw new SenderError('Unknown patient');
  if (!(HISTORY_CATEGORIES as readonly string[]).includes(args.category)) {
    throw new SenderError('Unknown history category');
  }
  const title = args.title.trim();
  if (!title) throw new SenderError('Title is required');
  if (args.detail.length > MAX_MED_TEXT) throw new SenderError('Detail is too long');
  if (args.whenText.length > 100) throw new SenderError('When text is too long');
  const fields = {
    patientId: p.id,
    category: args.category,
    title,
    detail: args.detail.trim(),
    whenText: args.whenText.trim(),
    slug: matchEntry([...ctx.db.libraryEntry.iter()], title, 'condition')?.slug ?? '',
  };
  if (args.id === 0n) {
    ctx.db.historyItem.insert({ id: 0n, ...fields, createdBy: who, createdAt: ctx.timestamp });
    audit(ctx, p.id, who, 'history_added', title);
  } else {
    const existing = ctx.db.historyItem.id.find(args.id);
    if (!existing || existing.patientId !== p.id) throw new SenderError('Unknown history item');
    ctx.db.historyItem.id.update({ ...existing, ...fields });
    audit(ctx, p.id, who, 'history_updated', title);
  }
}

/** Add or update one assistive device on the chart. `id` of 0n inserts. */
function saveDevice(
  ctx: Ctx,
  who: string,
  args: { id: bigint; patientId: bigint; name: string; detail: string; sinceText: string }
) {
  const p = ctx.db.patient.id.find(args.patientId);
  if (!p) throw new SenderError('Unknown patient');
  const name = args.name.trim();
  if (!name) throw new SenderError('Device name is required');
  if (args.detail.length > MAX_MED_TEXT) throw new SenderError('Detail is too long');
  if (args.sinceText.length > 100) throw new SenderError('Since text is too long');
  const fields = {
    patientId: p.id,
    name,
    detail: args.detail.trim(),
    sinceText: args.sinceText.trim(),
    // Unknown equipment still gets the general assistive-device guidance.
    slug: matchEntry([...ctx.db.libraryEntry.iter()], name, 'device')?.slug ?? DEVICE_FALLBACK_SLUG,
  };
  if (args.id === 0n) {
    ctx.db.assistiveDevice.insert({
      id: 0n,
      ...fields,
      createdBy: who,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      confirmedBy: '',
      confirmedAt: new Timestamp(0n),
    });
    audit(ctx, p.id, who, 'device_added', name);
  } else {
    const existing = ctx.db.assistiveDevice.id.find(args.id);
    if (!existing || existing.patientId !== p.id) throw new SenderError('Unknown device');
    // An edited device states something new, so it goes back to needing confirmation.
    ctx.db.assistiveDevice.id.update({
      ...existing,
      ...fields,
      updatedAt: ctx.timestamp,
      confirmedBy: '',
      confirmedAt: new Timestamp(0n),
    });
    audit(ctx, p.id, who, 'device_updated', name);
  }
}

/** Store a self-reported set of vital signs and run the same rules as the pod. */
function insertVitals(
  ctx: Ctx,
  who: string,
  patientId: bigint,
  reading: {
    hr: number;
    systolic: number;
    diastolic: number;
    respRate: number;
    spo2: number;
    tempC: number;
    glucoseMgDl: number;
  }
) {
  const p = ctx.db.patient.id.find(patientId);
  if (!p) throw new SenderError('Unknown patient');
  ctx.db.vitalSign.insert({
    id: 0n,
    patientId,
    ts: ctx.timestamp,
    ...reading,
    source: 'voice',
  });
  const parts = [
    reading.hr > 0 && `HR ${Math.round(reading.hr)}`,
    reading.systolic > 0 && `BP ${Math.round(reading.systolic)}/${Math.round(reading.diastolic)}`,
    reading.respRate > 0 && `resp ${Math.round(reading.respRate)}`,
    reading.spo2 > 0 && `SpO2 ${Math.round(reading.spo2)}%`,
    reading.tempC > 0 && `temp ${Math.round(reading.tempC * 10) / 10}°C`,
    reading.glucoseMgDl > 0 && `glucose ${Math.round(reading.glucoseMgDl)} mg/dL`,
  ].filter((s): s is string => typeof s === 'string');
  audit(ctx, patientId, who, 'vitals_reported', parts.join(' · '));
  raiseAlerts(ctx, patientId, [
    ...vitalRules(recentVitals(ctx, patientId)),
    ...glucoseRules(reading.glucoseMgDl),
  ]);
}

// ---------------------------------------------------------------------------
// Voice capture
//
// A spoken sentence becomes a draft of proposed updates. The speaker confirms each
// proposal, and only then is it written to the record.
// ---------------------------------------------------------------------------

function scheduleVoice(ctx: Ctx, draftId: bigint) {
  ctx.db.voiceJob.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch),
    draftId,
  });
}

/** Start a capture. Patients record for themselves; nurses record for any patient. */
export const startVoiceDraft = spacetimedb.reducer(
  { patientId: t.u64(), transcript: t.string() },
  (ctx, { patientId, transcript }) => {
    const me = requireCareTeamOrPatient(ctx, patientId);
    const text = transcript.trim();
    if (!text) throw new SenderError('Nothing was said');
    if (text.length > VOICE_MAX_TRANSCRIPT) throw new SenderError('That is too long to record at once');
    const draft = ctx.db.voiceDraft.insert({
      id: 0n,
      patientId,
      transcript: text,
      status: 'parsing',
      model: '',
      note: '',
      createdBy: ctx.sender,
      createdByName: me.name,
      createdAt: ctx.timestamp,
      reply: '',
    });
    scheduleVoice(ctx, draft.id);
    audit(ctx, patientId, me.name, 'voice_capture_started', text.slice(0, 120));
  }
);

/** Answer one proposal: confirm writes it to the record, reject discards it. */
export const decideVoiceItem = spacetimedb.reducer(
  { itemId: t.u64(), confirmed: t.bool() },
  (ctx, { itemId, confirmed }) => {
    const item = ctx.db.voiceItem.id.find(itemId);
    if (!item) throw new SenderError('Unknown proposed update');
    if (item.decision !== 'pending') throw new SenderError('That update was already answered');
    const draft = ctx.db.voiceDraft.id.find(item.draftId);
    if (!draft) throw new SenderError('Unknown voice capture');
    const me = requireCareTeamOrPatient(ctx, draft.patientId);

    if (confirmed) {
      // A patient may report their own symptoms and doses, but not chart facts.
      if (me.role !== 'nurse' && NURSE_ONLY_KINDS.includes(item.kind as VoiceItemKind)) {
        throw new SenderError('Only a nurse can add that to the chart');
      }
      applyVoiceItem(ctx, me.name, draft.patientId, item.kind, item.detail);
    }

    ctx.db.voiceItem.id.update({
      ...item,
      decision: confirmed ? 'confirmed' : 'rejected',
      decidedByName: me.name,
      decidedAt: ctx.timestamp,
    });
    audit(
      ctx,
      draft.patientId,
      me.name,
      confirmed ? 'voice_item_confirmed' : 'voice_item_rejected',
      item.label
    );
  }
);

/** Abandon a capture, discarding every proposal still unanswered. */
export const dismissVoiceDraft = spacetimedb.reducer({ draftId: t.u64() }, (ctx, { draftId }) => {
  const draft = ctx.db.voiceDraft.id.find(draftId);
  if (!draft) return;
  const me = requireCareTeamOrPatient(ctx, draft.patientId);
  for (const item of [...ctx.db.voiceItem.draftId.filter(draftId)]) {
    if (item.decision === 'pending') ctx.db.voiceItem.id.delete(item.id);
  }
  ctx.db.voiceDraft.id.update({ ...draft, status: 'dismissed' });
  audit(ctx, draft.patientId, me.name, 'voice_capture_dismissed', '');
});

/** Save one tab arrangement, or the goal from the initial assessment, for a patient. */
export const savePatientLayout = spacetimedb.reducer(
  { patientId: t.u64(), tabs: t.string(), goal: t.string(), assessed: t.bool() },
  (ctx, { patientId, tabs, goal, assessed }) => {
    const me = requireCareTeamOrPatient(ctx, patientId);
    if (tabs.length > 4000) throw new SenderError('That tab arrangement is too large');
    if (goal.length > 500) throw new SenderError('That goal is too long');
    // Round-trip through the parser so only known tabs and priorities are stored.
    const clean = serializeLayout(parseLayout(tabs));
    const existing = ctx.db.patientLayout.patientId.find(patientId);
    const fields = {
      patientId,
      tabs: clean,
      goal: goal.trim(),
      assessed,
      updatedBy: me.name,
      updatedAt: ctx.timestamp,
    };
    if (existing) {
      ctx.db.patientLayout.patientId.update(fields);
    } else {
      ctx.db.patientLayout.insert(fields);
    }
    audit(ctx, patientId, me.name, 'layout_saved', `${parseLayout(tabs).tabs.filter(t => t.on).length} tabs on`);
  }
);

/** Save the signed-in user's own tab arrangement for their console. */
export const saveUserLayout = spacetimedb.reducer(
  { tabs: t.string() },
  (ctx, { tabs }) => {
    if (!ctx.db.userProfile.identity.find(ctx.sender)) throw new SenderError('Sign in to arrange your app');
    if (tabs.length > 4000) throw new SenderError('That tab arrangement is too large');
    // Round-trip through the parser so only known tabs and priorities are stored.
    const clean = serializeLayout(parseLayout(tabs));
    const existing = ctx.db.userLayout.identity.find(ctx.sender);
    if (existing) {
      ctx.db.userLayout.identity.update({ ...existing, tabs: clean, updatedAt: ctx.timestamp });
    } else {
      ctx.db.userLayout.insert({ identity: ctx.sender, tabs: clean, updatedAt: ctx.timestamp });
    }
  }
);

/** Add or remove one diet, fluid, or sleep entry. */
export const saveLifestyleEntry = spacetimedb.reducer(
  {
    id: t.u64(), // 0 = new
    patientId: t.u64(),
    kind: t.string(),
    summary: t.string(),
    amount: t.string(),
    hours: t.f32(),
    whenText: t.string(),
    source: t.string(),
  },
  (ctx, args) => {
    const me = requireCareTeamOrPatient(ctx, args.patientId);
    if (!ctx.db.patient.id.find(args.patientId)) throw new SenderError('Unknown patient');
    if (args.kind !== 'diet' && args.kind !== 'sleep') throw new SenderError('Unknown entry type');
    const summary = args.summary.trim();
    if (!summary) throw new SenderError('Add a short description');
    if (summary.length > 500) throw new SenderError('That description is too long');
    if (!(args.hours >= 0 && args.hours <= 24)) throw new SenderError('Hours must be between 0 and 24');
    const fields = {
      patientId: args.patientId,
      kind: args.kind,
      summary,
      amount: args.amount.trim().slice(0, 80),
      hours: args.kind === 'sleep' ? args.hours : 0,
      whenText: args.whenText.trim().slice(0, 60),
      source: args.source === 'voice' ? 'voice' : 'form',
      createdBy: me.name,
    };
    if (args.id === 0n) {
      ctx.db.lifestyleEntry.insert({ id: 0n, ...fields, createdAt: ctx.timestamp });
      audit(ctx, args.patientId, me.name, `${args.kind}_logged`, summary.slice(0, 120));
    } else {
      const existing = ctx.db.lifestyleEntry.id.find(args.id);
      if (!existing || existing.patientId !== args.patientId) throw new SenderError('Unknown entry');
      ctx.db.lifestyleEntry.id.update({ ...existing, ...fields });
      audit(ctx, args.patientId, me.name, `${args.kind}_updated`, summary.slice(0, 120));
    }
  }
);

export const deleteLifestyleEntry = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const e = ctx.db.lifestyleEntry.id.find(id);
  if (!e) return;
  const me = requireCareTeamOrPatient(ctx, e.patientId);
  ctx.db.lifestyleEntry.id.delete(id);
  audit(ctx, e.patientId, me.name, `${e.kind}_removed`, e.summary.slice(0, 120));
});

/** The weekday of ctx.timestamp, Monday as 0, matching the exercise plan's day column. */
function todayWeekday(ctx: Ctx): number {
  const days = Math.floor(Number(ctx.timestamp.microsSinceUnixEpoch / 1000n) / 86_400_000);
  return (days + 3) % 7; // 1970-01-01 was a Thursday.
}

export const saveExerciseEntry = spacetimedb.reducer(
  {
    id: t.u64(), // 0 = new
    patientId: t.u64(),
    status: t.string(),
    activity: t.string(),
    minutes: t.u32(),
    intensity: t.string(),
    day: t.u8(), // planned: weekday 0-6, Monday first; ignored for done sessions
    note: t.string(),
    source: t.string(),
  },
  (ctx, args) => {
    const me = requireCareTeamOrPatient(ctx, args.patientId);
    if (!ctx.db.patient.id.find(args.patientId)) throw new SenderError('Unknown patient');
    const status = args.status === 'planned' ? 'planned' : 'done';
    const activity = args.activity.trim();
    if (!activity) throw new SenderError('Name the activity');
    if (activity.length > 60) throw new SenderError('Keep the activity name short');
    if (!(args.minutes >= 1 && args.minutes <= 600)) throw new SenderError('Minutes must be between 1 and 600');
    if (!(EXERCISE_INTENSITIES as readonly string[]).includes(args.intensity)) {
      throw new SenderError('Intensity must be light, moderate, or hard');
    }
    if (args.day > 6) throw new SenderError('Day must be a weekday from 0 to 6');
    // Done sessions are stamped with today; the plan owns the weekday column.
    const fields = {
      patientId: args.patientId,
      status,
      activity,
      minutes: args.minutes,
      intensity: args.intensity,
      day: status === 'planned' ? args.day : todayWeekday(ctx),
      note: args.note.trim().slice(0, 200),
      source: args.source === 'voice' ? 'voice' : 'form',
      createdBy: me.name,
    };
    if (args.id === 0n) {
      ctx.db.exerciseEntry.insert({ id: 0n, ...fields, createdAt: ctx.timestamp });
      audit(
        ctx,
        args.patientId,
        me.name,
        status === 'planned' ? 'exercise_planned' : 'exercise_logged',
        `${activity} ${args.minutes} min`
      );
    } else {
      const existing = ctx.db.exerciseEntry.id.find(args.id);
      if (!existing || existing.patientId !== args.patientId) throw new SenderError('Unknown workout');
      ctx.db.exerciseEntry.id.update({ ...existing, ...fields });
      audit(ctx, args.patientId, me.name, 'exercise_updated', `${activity} ${args.minutes} min`);
    }
  }
);

export const deleteExerciseEntry = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const e = ctx.db.exerciseEntry.id.find(id);
  if (!e) return;
  const me = requireCareTeamOrPatient(ctx, e.patientId);
  ctx.db.exerciseEntry.id.delete(id);
  audit(ctx, e.patientId, me.name, 'exercise_removed', `${e.activity} ${e.minutes} min`);
});

/** Write one confirmed proposal into the record it belongs to. */
function applyVoiceItem(ctx: Ctx, who: string, patientId: bigint, kind: string, rawDetail: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDetail);
  } catch {
    throw new SenderError('That update is unreadable; please record it again');
  }
  const detail = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const num = (key: string) => (typeof detail[key] === 'number' && Number.isFinite(detail[key]) ? (detail[key] as number) : 0);
  const str = (key: string, fallback = '') => (typeof detail[key] === 'string' ? (detail[key] as string) : fallback);
  const flag = (key: string) => detail[key] === true;

  switch (kind) {
    case 'symptom': {
      const region = str('region', 'abdomen');
      const [x, y, z] = regionPoint(region);
      insertSymptom(ctx, who, {
        patientId,
        region,
        x,
        y,
        z,
        onset: '',
        provocation: '',
        quality: str('quality', 'pain'),
        radiation: '',
        severity: num('severity'),
        timing: '',
        swelling: flag('swelling'),
        warmth: flag('warmth'),
        redness: flag('redness'),
        shortnessOfBreath: flag('shortnessOfBreath'),
        chestPain: flag('chestPain'),
        bodyTempC: num('bodyTempC'),
        notes: str('notes'),
        source: 'voice',
      });
      return;
    }
    case 'vitals': {
      const reading = {
        hr: num('hr'),
        systolic: num('systolic'),
        diastolic: num('diastolic'),
        respRate: num('respRate'),
        spo2: num('spo2'),
        tempC: num('tempC'),
        glucoseMgDl: num('glucoseMgDl'),
      };
      if (Object.values(reading).every(v => v <= 0)) {
        throw new SenderError('That update has no measurement to save');
      }
      insertVitals(ctx, who, patientId, reading);
      return;
    }
    case 'dose': {
      const medName = str('medicationName');
      const dose = nearestOpenDose(ctx, patientId, medName);
      if (!dose) throw new SenderError(`No open dose of ${medName || 'that medicine'} to log`);
      applyDoseLog(ctx, who, dose.id, str('status', 'taken'), num('glucoseMgDl'), 'Logged from a voice note');
      return;
    }
    case 'lab':
      insertLab(ctx, who, {
        patientId,
        name: str('name'),
        value: num('value'),
        unit: str('unit'),
        notes: 'Recorded from a voice note',
        resultedAt: ctx.timestamp,
      });
      return;
    case 'history':
      saveHistory(ctx, who, {
        id: 0n,
        patientId,
        category: str('category', 'medical'),
        title: str('title'),
        detail: str('detail'),
        whenText: str('whenText'),
      });
      return;
    case 'diet':
    case 'sleep': {
      const summary = str('summary');
      if (!summary) throw new SenderError('That update has nothing to save');
      ctx.db.lifestyleEntry.insert({
        id: 0n,
        patientId,
        kind,
        summary,
        amount: str('amount').slice(0, 80),
        hours: kind === 'sleep' ? num('hours') : 0,
        whenText: str('whenText').slice(0, 60),
        source: 'voice',
        createdBy: who,
        createdAt: ctx.timestamp,
      });
      audit(ctx, patientId, who, `${kind}_logged`, summary.slice(0, 120));
      return;
    }
    case 'exercise': {
      const activity = str('activity').trim();
      if (!activity) throw new SenderError('That update has nothing to save');
      const planned = str('status') === 'planned';
      const spokenDay = typeof detail.day === 'number' && detail.day >= 0 && detail.day <= 6 ? detail.day : undefined;
      const intensityRaw = str('intensity', 'moderate');
      const minutes = num('minutes');
      ctx.db.exerciseEntry.insert({
        id: 0n,
        patientId,
        status: planned ? 'planned' : 'done',
        activity: activity.slice(0, 60),
        minutes: minutes >= 1 && minutes <= 600 ? Math.round(minutes) : 30,
        intensity: (EXERCISE_INTENSITIES as readonly string[]).includes(intensityRaw) ? intensityRaw : 'moderate',
        day: planned && spokenDay !== undefined ? spokenDay : todayWeekday(ctx),
        note: '',
        source: 'voice',
        createdBy: who,
        createdAt: ctx.timestamp,
      });
      audit(ctx, patientId, who, planned ? 'exercise_planned' : 'exercise_logged', activity.slice(0, 120));
      return;
    }
    default:
      throw new SenderError('Unsupported update');
  }
}

/** The due or missed dose closest to now for one medication. */
function nearestOpenDose(ctx: Ctx, patientId: bigint, medicationName: string) {
  const med = [...ctx.db.medication.patientId.filter(patientId)].find(
    m => m.active && m.name === medicationName
  );
  if (!med) return undefined;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  return [...ctx.db.medDose.medicationId.filter(med.id)]
    .filter(d => d.status === 'due' || d.status === 'missed')
    .sort((a, b) => {
      const da = a.scheduledFor.microsSinceUnixEpoch - now;
      const db = b.scheduledFor.microsSinceUnixEpoch - now;
      return Number(da < 0n ? -da : da) - Number(db < 0n ? -db : db);
    })[0];
}

type VoiceJobInput = {
  draftId: bigint;
  transcript: string;
  payload: string;
  context: VoiceContext;
  fallback: VoiceCandidate[];
  allowChartKinds: boolean;
};

/** Read everything the parser needs inside one transaction. */
function gatherVoiceInput(tx: Ctx, draftId: bigint): VoiceJobInput | undefined {
  const draft = tx.db.voiceDraft.id.find(draftId);
  if (!draft || draft.status !== 'parsing') return undefined;
  const patient = tx.db.patient.id.find(draft.patientId);
  if (!patient) return undefined;

  const meds = [...tx.db.medication.patientId.filter(patient.id)].filter(m => m.active);
  const labs = [...tx.db.libraryEntry.iter()].filter(e => e.kind === 'lab');
  // Medicine cards and open alerts, so spoken questions can be answered from the record.
  const medFacts: VoiceMedFact[] = meds.map(m => ({
    name: m.name,
    instructions: m.instructions,
    sideEffects: m.sideEffects
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
  }));
  const alerts: VoiceAlertFact[] = [...tx.db.alert.patientId.filter(patient.id)]
    .filter(a => a.status !== 'resolved')
    .map(a => ({
      priority: a.priority,
      reasons: a.reasonCodes
        .split(',')
        .map(c => REASON_LABEL[c.trim()] ?? c.trim())
        .filter(Boolean),
    }));
  const vitals = recentVitals(tx, patient.id).slice(-5);
  const author = tx.db.userProfile.identity.find(draft.createdBy);
  const allowChartKinds = author?.role === 'nurse';
  const layout = tx.db.patientLayout.patientId.find(patient.id);
  const onTabs = layout
    ? parseLayout(layout.tabs)
        .tabs.filter(t => t.on)
        .map(t => t.id)
    : [];

  const context: VoiceContext = {
    side: patient.side === 'left' ? 'left' : 'right',
    medications: meds.map(m => m.name),
    labs: labs.map(l => l.name),
    medFacts,
    alerts,
  };

  const vitalsLine =
    vitals.length === 0
      ? 'no recent readings'
      : vitals
          .map(
            v =>
              `HR ${Math.round(v.hr)}, BP ${Math.round(v.systolic)}/${Math.round(v.diastolic)}, resp ${Math.round(
                v.respRate
              )}, SpO2 ${Math.round(v.spo2)}%, temp ${Math.round(v.tempC * 10) / 10}C`
          )
          .join(' | ');

  const payload = [
    `Speaker role: ${allowChartKinds ? 'nurse' : 'patient'}`,
    `Patient: ${patient.name}, ${patient.age}y, ${careLabelText(patient)}, surgical side ${context.side}`,
    `Active medications: ${context.medications.join(', ') || 'none'}`,
    `Medicine details they may ask about: ${
      medFacts
        .map(
          f =>
            `${f.name} - ${f.instructions.trim().slice(0, 220) || 'no instructions recorded'}${
              f.sideEffects.length > 0 ? ` (side effects: ${f.sideEffects.join(', ').slice(0, 220)})` : ''
            }`
        )
        .join(' | ') || 'none'
    }`,
    `Lab names on file: ${context.labs.join(', ') || 'none'}`,
    `Open alerts, and why the care team was notified: ${
      alerts.map(a => `${a.priority} - ${a.reasons.join('; ')}`).join(' | ') || 'none'
    }`,
    `Recent pod vitals (oldest first): ${vitalsLine}`,
    `What the patient wants from the app: ${layout?.goal?.trim() || 'not stated'}`,
    `Tabs the patient has switched on: ${onTabs.join(', ') || 'none'}`,
    `Update kinds allowed for this speaker: ${
      allowChartKinds ? VOICE_ITEM_KINDS.join(', ') : 'symptom, vitals, dose, diet, sleep'
    }`,
    '',
    `Spoken sentence: "${draft.transcript}"`,
  ].join('\n');

  return {
    draftId,
    transcript: draft.transcript,
    payload,
    context,
    // Patients never propose chart facts, whichever parser runs.
    fallback: parseVoiceLocally(draft.transcript, context).filter(
      c => allowChartKinds || !NURSE_ONLY_KINDS.includes(c.kind)
    ),
    allowChartKinds,
  };
}

function careLabelText(p: { procedure: string; side: string }) {
  const procedure = p.procedure.trim();
  if (!procedure) return 'monitored at home';
  if (!/knee|hip|shoulder/i.test(procedure)) return procedure;
  const side = p.side === 'left' ? 'left' : 'right';
  return `${side} ${procedure.replace(/^total\s+/i, '').toLowerCase()}`;
}

export const runVoiceJob = spacetimedb.procedure(
  { onSchedule: voiceJob },
  { job: voiceJob.rowType },
  t.unit(),
  (ctx, { job }) => {
    const input = ctx.withTx(tx => gatherVoiceInput(tx, job.draftId));
    if (!input) return {};

    const apiKey = ctx.env.ANTHROPIC_API_KEY;
    const model = ctx.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
    let candidates = input.fallback;
    let modelUsed = 'simple matching';
    let status = 'ready';
    let note = '';
    // Questions get an answer even when no language model is available.
    let reply = replyVoiceLocally(input.transcript, input.context);

    if (apiKey) {
      try {
        const res = ctx.http.fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1500,
            system: VOICE_SYSTEM_PROMPT,
            tools: [VOICE_TOOL],
            tool_choice: { type: 'tool', name: VOICE_TOOL.name },
            messages: [{ role: 'user', content: input.payload }],
          }),
          timeout: TimeDuration.fromMillis(45_000),
        });
        const text = res.text();
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const body = JSON.parse(text) as {
          content?: Array<{ type: string; name?: string; input?: { items?: unknown; reply?: unknown } }>;
        };
        const block = body.content?.find(c => c.type === 'tool_use' && c.name === VOICE_TOOL.name);
        const modelReply =
          typeof block?.input?.reply === 'string' ? block.input.reply.trim().slice(0, VOICE_MAX_REPLY) : '';
        const parsed = normalizeCandidates({ items: block?.input?.items }, input.context).filter(
          c => input.allowChartKinds || !NURSE_ONLY_KINDS.includes(c.kind)
        );
        // A question turn carries no items, just the spoken answer.
        if (parsed.length === 0 && !modelReply) throw new Error('No usable updates in the model response');
        candidates = parsed;
        reply = modelReply;
        modelUsed = model;
      } catch (e) {
        console.error(`Claude voice parse failed: ${String(e)}`);
        if (input.fallback.length === 0 && !reply) {
          status = 'error';
          note = `Could not read that. Try saying it a different way. (${String(e).slice(0, 100)})`;
        } else {
          note =
            input.fallback.length > 0
              ? 'Used simple matching because the language model was unavailable.'
              : '';
        }
      }
    } else if (input.fallback.length === 0 && !reply) {
      status = 'error';
      note = 'No language model is configured and nothing recognizable was said.';
    }

    ctx.withTx(tx => {
      const draft = tx.db.voiceDraft.id.find(input.draftId);
      if (!draft || draft.status !== 'parsing') return;
      for (const old of [...tx.db.voiceItem.draftId.filter(input.draftId)]) {
        tx.db.voiceItem.id.delete(old.id);
      }
      candidates.slice(0, VOICE_MAX_ITEMS).forEach((candidate, index) => {
        tx.db.voiceItem.insert({
          id: 0n,
          draftId: input.draftId,
          position: index,
          kind: candidate.kind,
          label: candidate.label,
          target: candidate.target,
          detail: JSON.stringify(candidate.detail),
          confidence: candidate.confidence,
          decision: 'pending',
          decidedByName: '',
          decidedAt: undefined,
        });
      });
      tx.db.voiceDraft.id.update({ ...draft, status, model: modelUsed, note, reply });
      audit(
        tx,
        draft.patientId,
        modelUsed === 'simple matching' ? 'system' : 'Claude',
        'voice_capture_parsed',
        `${candidates.length} proposed update${candidates.length === 1 ? '' : 's'} · ${modelUsed}`
      );
    });
    return {};
  }
);

// ---------------------------------------------------------------------------
// Family access
// ---------------------------------------------------------------------------

function requirePatientSelf(ctx: Ctx) {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  if (!me || me.role !== 'patient') throw new SenderError('Only the patient can manage family access');
  return me;
}

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, FAMILY_MAX_NAME);
}

function dropInviteCode(ctx: Ctx, accessId: bigint) {
  const row = ctx.db.familyInviteCode.accessId.find(accessId);
  if (row) ctx.db.familyInviteCode.code.delete(row.code);
}

/** The patient's own unused invite codes; nobody else can read them. */
export const myFamilyInvites = spacetimedb.view(
  { name: 'my_family_invites', public: true },
  t.array(familyInviteCode.rowType),
  ctx => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    if (!me || me.role !== 'patient') return [];
    const out = [];
    for (const access of ctx.db.familyAccess.patientId.filter(me.patientId)) {
      if (access.status !== 'invited') continue;
      const row = ctx.db.familyInviteCode.accessId.find(access.id);
      if (row) out.push(row);
    }
    return out;
  }
);

export const inviteFamilyMember = spacetimedb.reducer(
  { memberName: t.string(), relationship: t.string(), alertLevel: t.string(), canViewChart: t.bool() },
  (ctx, { memberName, relationship, alertLevel, canViewChart }) => {
    const me = requirePatientSelf(ctx);
    const name = cleanName(memberName);
    if (!name) throw new SenderError('Add the family member’s name');
    if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) throw new SenderError('Pick a relationship');
    if (!isFamilyAlertLevel(alertLevel)) throw new SenderError('Pick which alerts they get');
    const current = [...ctx.db.familyAccess.patientId.filter(me.patientId)].filter(a => a.status !== 'revoked');
    if (current.length >= FAMILY_MAX_MEMBERS) {
      throw new SenderError(`You can authorise up to ${FAMILY_MAX_MEMBERS} people. Remove someone first.`);
    }

    const access = ctx.db.familyAccess.insert({
      id: 0n,
      patientId: me.patientId,
      memberName: name,
      relationship,
      alertLevel,
      canViewChart,
      status: 'invited',
      memberIdentity: undefined,
      createdAt: ctx.timestamp,
      acceptedAt: undefined,
    });
    let code = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = makeInviteCode(max => ctx.random.integerInRange(0, max - 1));
      if (!ctx.db.familyInviteCode.code.find(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new SenderError('Could not make an invite code. Try again.');
    ctx.db.familyInviteCode.insert({ code, accessId: access.id });
    audit(ctx, me.patientId, me.name, 'family_invited', `${name} (${relationship}) · ${alertLevel}${canViewChart ? ' · chart' : ''}`);
  }
);

export const redeemFamilyInvite = spacetimedb.reducer(
  { code: t.string(), displayName: t.string() },
  (ctx, { code, displayName }) => {
    const invite = ctx.db.familyInviteCode.code.find(normalizeInviteCode(code));
    if (!invite) throw new SenderError('That code did not work. Check it with the person who invited you.');
    const access = ctx.db.familyAccess.id.find(invite.accessId);
    if (!access || access.status !== 'invited') {
      throw new SenderError('That invite is no longer active. Ask for a new one.');
    }
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    if (me && me.role !== 'family') throw new SenderError('This browser is signed in as a patient or nurse');

    const name = cleanName(displayName) || access.memberName;
    const row = { identity: ctx.sender, name, role: 'family', patientId: access.patientId, online: true };
    if (me) ctx.db.userProfile.identity.update(row);
    else ctx.db.userProfile.insert(row);

    ctx.db.familyAccess.id.update({
      ...access,
      status: 'active',
      memberIdentity: ctx.sender,
      acceptedAt: ctx.timestamp,
    });
    ctx.db.familyInviteCode.code.delete(invite.code);
    audit(ctx, access.patientId, name, 'family_joined', `${access.relationship}`);
  }
);

export const updateFamilyAccess = spacetimedb.reducer(
  { accessId: t.u64(), alertLevel: t.string(), canViewChart: t.bool() },
  (ctx, { accessId, alertLevel, canViewChart }) => {
    const me = requirePatientSelf(ctx);
    const access = ctx.db.familyAccess.id.find(accessId);
    if (!access || access.patientId !== me.patientId) throw new SenderError('Unknown family member');
    if (!isFamilyAlertLevel(alertLevel)) throw new SenderError('Pick which alerts they get');
    ctx.db.familyAccess.id.update({ ...access, alertLevel, canViewChart });
    audit(ctx, me.patientId, me.name, 'family_updated', `${access.memberName} · ${alertLevel}${canViewChart ? ' · chart' : ' · alerts only'}`);
  }
);

/** The patient, or a nurse on their behalf, can withdraw access at any time. */
export const revokeFamilyAccess = spacetimedb.reducer({ accessId: t.u64() }, (ctx, { accessId }) => {
  const me = ctx.db.userProfile.identity.find(ctx.sender);
  const access = ctx.db.familyAccess.id.find(accessId);
  if (!access) throw new SenderError('Unknown family member');
  const allowed = me && (me.role === 'nurse' || (me.role === 'patient' && me.patientId === access.patientId));
  if (!allowed) throw new SenderError('Only the patient or a nurse can remove family access');
  ctx.db.familyAccess.id.update({ ...access, status: 'revoked' });
  dropInviteCode(ctx, access.id);
  audit(ctx, access.patientId, me.name, 'family_revoked', access.memberName);
});

/** Which email this browser's family member signs in with, if they set one up. */
export const myFamilyLogin = spacetimedb.view(
  { name: 'my_family_login', public: true },
  t.array(t.object('FamilyLoginInfo', { email: t.string() })),
  ctx => {
    const row = ctx.db.familyLogin.memberIdentity.find(ctx.sender);
    return row ? [{ email: row.email }] : [];
  }
);

/** Why this browser's last sign-in failed. */
export const myFamilySignin = spacetimedb.view(
  { name: 'my_family_signin', public: true },
  t.array(t.object('FamilySigninNotice', { message: t.string(), at: t.timestamp() })),
  ctx => {
    const row = ctx.db.familySigninAttempt.identity.find(ctx.sender);
    return row ? [{ message: row.message, at: row.at }] : [];
  }
);

function grantsOf(ctx: Ctx, who: Identity) {
  return [...ctx.db.familyAccess.iter()].filter(a => a.memberIdentity && a.memberIdentity.isEqual(who));
}

function noteSigninFailure(ctx: Ctx, message: string) {
  const row = { identity: ctx.sender, message, at: ctx.timestamp };
  if (ctx.db.familySigninAttempt.identity.find(ctx.sender)) ctx.db.familySigninAttempt.identity.update(row);
  else ctx.db.familySigninAttempt.insert(row);
}

export const setFamilyLogin = spacetimedb.reducer(
  { email: t.string(), password: t.string() },
  (ctx, { email, password }) => {
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    const grants = grantsOf(ctx, ctx.sender).filter(a => a.status === 'active');
    if (!me || me.role !== 'family' || grants.length === 0) {
      throw new SenderError('Join with the invite code first, then save a login.');
    }
    const clean = normalizeEmail(email);
    if (!isValidEmail(clean)) throw new SenderError('Enter a valid email address');
    const problem = passwordProblem(password);
    if (problem) throw new SenderError(problem);
    const taken = ctx.db.familyLogin.email.find(clean);
    if (taken && !taken.memberIdentity.isEqual(ctx.sender)) {
      throw new SenderError('That email already has a family login. Sign in with it instead.');
    }
    const existing = ctx.db.familyLogin.memberIdentity.find(ctx.sender);
    if (existing) ctx.db.familyLogin.email.delete(existing.email);
    const salt = bytesToHex(ctx.random.fill(new Uint8Array(16)));
    ctx.db.familyLogin.insert({
      email: clean,
      memberIdentity: ctx.sender,
      salt,
      passwordHash: hashFamilyPassword(password, salt),
      failedCount: 0,
      lockedUntil: undefined,
      createdAt: ctx.timestamp,
    });
    for (const pid of new Set(grants.map(g => g.patientId))) {
      audit(ctx, pid, me.name, 'family_login_set', existing ? 'login changed' : 'login created');
    }
  }
);

/**
 * Sign an authorised family member in on this browser. Their access moves here, so a
 * lost or shared device stops working once they sign in somewhere else.
 */
export const signInFamily = spacetimedb.reducer(
  { email: t.string(), password: t.string() },
  (ctx, { email, password }) => {
    const wrong = 'That email and password did not match. Check them and try again.';
    const me = ctx.db.userProfile.identity.find(ctx.sender);
    if (me && me.role !== 'family') throw new SenderError('This browser is signed in as a patient or nurse');

    const login = ctx.db.familyLogin.email.find(normalizeEmail(email));
    if (!login) {
      // Same path as a wrong password, so the reply does not reveal which emails exist.
      hashFamilyPassword(password, '00');
      noteSigninFailure(ctx, wrong);
      return;
    }
    const now = ctx.timestamp.microsSinceUnixEpoch;
    if (login.lockedUntil && login.lockedUntil.microsSinceUnixEpoch > now) {
      noteSigninFailure(ctx, 'Too many tries. Wait 15 minutes, or ask for a new invite code.');
      return;
    }
    if (!sameDigest(hashFamilyPassword(password, login.salt), login.passwordHash)) {
      const failed = login.failedCount + 1;
      const lock = failed >= FAMILY_MAX_FAILED_LOGINS;
      ctx.db.familyLogin.email.update({
        ...login,
        failedCount: lock ? 0 : failed,
        lockedUntil: lock ? new Timestamp(now + FAMILY_LOCK_MICROS) : undefined,
      });
      noteSigninFailure(ctx, lock ? 'Too many tries. Wait 15 minutes, or ask for a new invite code.' : wrong);
      return;
    }

    const other = ctx.db.familyLogin.memberIdentity.find(ctx.sender);
    if (other && other.email !== login.email) {
      noteSigninFailure(ctx, 'This browser already uses a different family login. Sign out first.');
      return;
    }

    const old = login.memberIdentity;
    const grants = grantsOf(ctx, old);
    const oldProfile = ctx.db.userProfile.identity.find(old);
    if (!old.isEqual(ctx.sender)) {
      for (const g of grants) ctx.db.familyAccess.id.update({ ...g, memberIdentity: ctx.sender });
      if (oldProfile) ctx.db.userProfile.identity.delete(old);
    }
    const newest = [...grants].sort((a, b) => {
      if ((a.status === 'active') !== (b.status === 'active')) return a.status === 'active' ? -1 : 1;
      return a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1;
    })[0];
    const name = oldProfile?.name || me?.name || newest?.memberName || 'Family member';
    const row = { identity: ctx.sender, name, role: 'family', patientId: newest?.patientId ?? me?.patientId ?? 0n, online: true };
    if (me) ctx.db.userProfile.identity.update(row);
    else ctx.db.userProfile.insert(row);

    ctx.db.familyLogin.email.update({ ...login, memberIdentity: ctx.sender, failedCount: 0, lockedUntil: undefined });
    if (ctx.db.familySigninAttempt.identity.find(ctx.sender)) ctx.db.familySigninAttempt.identity.delete(ctx.sender);
    for (const pid of new Set(grants.map(g => g.patientId))) audit(ctx, pid, name, 'family_signed_in', 'login');
  }
);
export const markFamilyAlertsRead = spacetimedb.reducer(ctx => {
  for (const access of ctx.db.familyAccess.iter()) {
    if (!access.memberIdentity || !access.memberIdentity.isEqual(ctx.sender)) continue;
    for (const a of [...ctx.db.familyAlert.accessId.filter(access.id)]) {
      if (!a.readAt) ctx.db.familyAlert.id.update({ ...a, readAt: ctx.timestamp });
    }
  }
});
