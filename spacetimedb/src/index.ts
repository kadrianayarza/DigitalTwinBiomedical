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
import { EXAMPLE_CHECK_INS } from './examples';
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

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const userProfile = table(
  { name: 'user_profile', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    role: t.string(), // 'patient' | 'nurse'
    patientId: t.u64(), // 0 when not a patient
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
    source: t.string(), // 'sim' | 'phone'
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

const medication = table(
  { name: 'medication', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    patientId: t.u64().index('btree'),
    name: t.string(),
    dose: t.string(),
    schedule: t.string(), // Once daily | Twice daily | Three times daily | As needed
    createdAt: t.timestamp(),
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
    alert,
    sbarReport,
    auditEvent,
    presence,
    simTimer,
    sbarJob,
    twinJob,
    twinStatus,
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

function recentVitals(ctx: Ctx, patientId: bigint) {
  return [...ctx.db.vitalSign.patientId.filter(patientId)].sort((a, b) =>
    a.ts.microsSinceUnixEpoch < b.ts.microsSinceUnixEpoch ? -1 : 1
  );
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
        ctx.db.medication.insert({ id: 0n, patientId: p.id, ...m, createdAt: ctx.timestamp });
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
}

function clearClinicalData(ctx: Ctx) {
  for (const r of ctx.db.symptomEntry.iter()) ctx.db.symptomEntry.id.delete(r.id);
  for (const r of ctx.db.vitalSign.iter()) ctx.db.vitalSign.id.delete(r.id);
  for (const r of ctx.db.vitalSample.iter()) ctx.db.vitalSample.id.delete(r.id);
  for (const r of ctx.db.alert.iter()) ctx.db.alert.id.delete(r.id);
  for (const r of ctx.db.sbarReport.iter()) ctx.db.sbarReport.id.delete(r.id);
  for (const r of ctx.db.auditEvent.iter()) ctx.db.auditEvent.id.delete(r.id);
  for (const r of ctx.db.sbarJob.iter()) ctx.db.sbarJob.scheduledId.delete(r.scheduledId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  seedPatients(ctx);
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
    const p = ctx.db.patient.id.find(args.patientId);
    if (!p) throw new SenderError('Unknown patient');
    if (args.severity > 10) throw new SenderError('Severity must be 0-10');

    const previous = [...ctx.db.symptomEntry.patientId.filter(p.id)].sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
    )[0];

    const entry = ctx.db.symptomEntry.insert({
      id: 0n,
      ...args,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
    audit(
      ctx,
      p.id,
      actorName(ctx, ctx.sender),
      'symptom_logged',
      `${regionText(entry.region)} · ${entry.quality || 'pain'} ${entry.severity}/10 (${entry.source})`
    );
    raiseAlerts(ctx, p.id, symptomRules(p.side, entry, previous));
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
  seedHealth(ctx);
});

/** Fills in the example history on databases published before it existed. */
export const loadExampleCheckIns = spacetimedb.reducer(ctx => {
  seedCheckIns(ctx);
});

export const loadExampleHealth = spacetimedb.reducer(ctx => {
  seedHealth(ctx);
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
    ctx.db.medication.insert({ id: 0n, patientId: p.id, name: clean, dose: dose.trim().slice(0, 80), schedule, createdAt: ctx.timestamp });
    audit(ctx, p.id, actorName(ctx, ctx.sender), 'medication_added', `${clean} · ${schedule}`);
  }
);

export const removeMedication = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const m = ctx.db.medication.id.find(id);
  if (!m) return;
  requirePatientAccess(ctx, m.patientId);
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
      ctx.db.vitalSign.insert({ id: 0n, patientId: s.patientId, ts: ctx.timestamp, ...v, source: 'sim' });

      const window = recentVitals(ctx, s.patientId);
      for (const old of window.slice(0, Math.max(0, window.length - VITALS_KEPT_PER_PATIENT))) {
        ctx.db.vitalSign.id.delete(old.id);
      }
      if (tick % 2 === 0) {
        raiseAlerts(ctx, s.patientId, vitalRules(window.slice(-60)));
      }
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
  const codes = a.reasonCodes.split(',').filter(Boolean);
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
