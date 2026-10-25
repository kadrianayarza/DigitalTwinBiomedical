import type { Patient } from '../module_bindings/types';
import { activeAlertFor, symptomsFor, vitalsFor, type TwinData } from '../lib/data';
import { PRIORITY_LABEL, REASON_LABEL, SCENARIO_LABEL, careLabel, daysSince, timeAgo } from '../lib/format';
import { regionLabel } from '../twin/bodyModel';

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function vitalsSummary(data: TwinData, patientId: bigint) {
  const all = vitalsFor(data, patientId);
  if (all.length === 0) return null;
  const recent = all.slice(-5);
  const last = all[all.length - 1];
  const mean = (f: (v: (typeof all)[number]) => number) => round(recent.reduce((s, v) => s + f(v), 0) / recent.length);
  return {
    latest: {
      heart_rate_bpm: last.hr,
      blood_pressure_mmhg: `${Math.round(last.systolic)}/${Math.round(last.diastolic)}`,
      respiratory_rate_per_min: round(last.respRate),
      spo2_pct: round(last.spo2),
      temperature_c: round(last.tempC),
      measured: `${timeAgo(last.ts)} ago`,
    },
    mean_of_last_5: {
      heart_rate_bpm: mean(v => v.hr),
      systolic_mmhg: mean(v => v.systolic),
      respiratory_rate_per_min: mean(v => v.respRate),
      spo2_pct: mean(v => v.spo2),
      temperature_c: mean(v => v.tempC),
    },
  };
}

function checkIns(data: TwinData, patientId: bigint, limit: number) {
  return symptomsFor(data, patientId)
    .slice(0, limit)
    .map(s => ({
      when: `${timeAgo(s.createdAt)} ago`,
      where: regionLabel(s.region),
      severity_0_to_10: s.severity,
      quality: s.quality || undefined,
      onset: s.onset || undefined,
      timing: s.timing || undefined,
      worse_with: s.provocation || undefined,
      swelling: s.swelling || undefined,
      warmth: s.warmth || undefined,
      redness: s.redness || undefined,
      shortness_of_breath: s.shortnessOfBreath || undefined,
      chest_pain: s.chestPain || undefined,
      notes: s.notes || undefined,
    }));
}

function alertSummary(data: TwinData, patientId: bigint) {
  const a = activeAlertFor(data, patientId);
  if (!a) return null;
  return {
    priority: PRIORITY_LABEL[a.priority] ?? a.priority,
    status: a.status,
    reasons: a.reasonCodes.split(',').filter(Boolean).map(c => REASON_LABEL[c] ?? c),
    raised: `${timeAgo(a.createdAt)} ago`,
  };
}

/** What the patient's agent may see: only this patient's own record. */
export function patientAgentContext(data: TwinData, patient: Patient) {
  const alert = alertSummary(data, patient.id);
  return {
    patient: {
      first_name: patient.name.split(' ')[0],
      age: patient.age,
      condition: careLabel(patient),
      monitoring_day: daysSince(patient.surgeryAt),
      has_personal_3d_scan: !!patient.twinUrl,
    },
    pod_vitals: vitalsSummary(data, patient.id),
    recent_check_ins_newest_first: checkIns(data, patient.id, 6),
    care_team_flag: alert ? { priority: alert.priority, status: alert.status, raised: alert.raised } : null,
  };
}

/** What the nurse's agent sees: the whole census plus the open chart. */
export function nurseAgentContext(data: TwinData, selected: Patient | undefined) {
  const census = data.patients.map(p => {
    const v = vitalsSummary(data, p.id);
    return {
      id: String(p.id),
      name: p.name,
      age: p.age,
      condition: careLabel(p),
      monitoring_day: daysSince(p.surgeryAt),
      latest_vitals: v?.latest ?? null,
      active_alert: alertSummary(data, p.id),
      check_ins: symptomsFor(data, p.id).length,
    };
  });
  let open = null;
  if (selected) {
    const report = data.reports
      .filter(r => r.patientId === selected.id)
      .sort((a, b) => (a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? 1 : -1))[0];
    const sim = data.sims.find(s => s.patientId === selected.id);
    open = {
      id: String(selected.id),
      name: selected.name,
      age: selected.age,
      condition: careLabel(selected),
      monitoring_day: daysSince(selected.surgeryAt),
      pod_vitals: vitalsSummary(data, selected.id),
      recent_check_ins_newest_first: checkIns(data, selected.id, 8),
      active_alert: alertSummary(data, selected.id),
      latest_sbar: report
        ? {
            status: report.status,
            suggested_priority: PRIORITY_LABEL[report.suggestedPriority] ?? report.suggestedPriority,
            situation: report.situation,
            background: report.background,
            assessment: report.assessment,
            recommendation: report.recommendation,
          }
        : null,
      simulated_pod_pattern: sim ? (SCENARIO_LABEL[sim.scenario] ?? sim.scenario) : undefined,
    };
  }
  return { census, open_chart: open };
}
