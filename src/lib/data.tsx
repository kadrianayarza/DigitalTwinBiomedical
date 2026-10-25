import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { Identity } from 'spacetimedb';
import { defaultLayout, parseLayout, type Layout } from '../../spacetimedb/src/layout.ts';

function useAllTables() {
  const [patientRows, patientsReady] = useTable(tables.patient);
  // Roster order is the seed order (Kadrian, Isak, ...) in every list.
  const patients = useMemo(() => [...patientRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [patientRows]);
  const [profiles] = useTable(tables.userProfile);
  const [symptoms] = useTable(tables.symptomEntry);
  const [vitals] = useTable(tables.vitalSign);
  const [alerts] = useTable(tables.alert);
  const [reports] = useTable(tables.sbarReport);
  const [audit] = useTable(tables.auditEvent);
  const [presence] = useTable(tables.presence);
  const [sims] = useTable(tables.simState);
  const [twinStatuses] = useTable(tables.twinStatus);
  const [medications] = useTable(tables.medication);
  const [doses] = useTable(tables.medDose);
  const [libraryEntries] = useTable(tables.libraryEntry);
  const [librarySections] = useTable(tables.librarySection);
  const [labResults] = useTable(tables.labResult);
  const [historyItems] = useTable(tables.historyItem);
  const [assistiveDevices] = useTable(tables.assistiveDevice);
  const [systemAssessments] = useTable(tables.systemAssessment);
  const [mhCheckIns] = useTable(tables.mentalHealthCheckIn);
  const [appointments] = useTable(tables.appointment);
  const [messages] = useTable(tables.careMessage);
  const [userLayouts] = useTable(tables.userLayout);
  const [voiceDrafts] = useTable(tables.voiceDraft);
  const [voiceItems] = useTable(tables.voiceItem);
  const [layouts] = useTable(tables.patientLayout);
  const [lifestyle] = useTable(tables.lifestyleEntry);
  const [exercise] = useTable(tables.exerciseEntry);
  const [familyAccess] = useTable(tables.familyAccess);
  const [familyAlerts] = useTable(tables.familyAlert);
  const [familyInvites] = useTable(tables.myFamilyInvites);
  const [familyLogin] = useTable(tables.myFamilyLogin);
  const [familySignin] = useTable(tables.myFamilySignin);
  const [healthSamples] = useTable(tables.healthSample);
  const [healthDevices] = useTable(tables.healthDevice);
  const [risks] = useTable(tables.riskScore);
  return {
    patients,
    patientsReady,
    profiles,
    symptoms,
    vitals,
    alerts,
    reports,
    audit,
    presence,
    sims,
    twinStatuses,
    medications,
    doses,
    libraryEntries,
    librarySections,
    labResults,
    historyItems,
    assistiveDevices,
    systemAssessments,
    mhCheckIns,
    appointments,
    messages,
    userLayouts,
    voiceDrafts,
    voiceItems,
    layouts,
    lifestyle,
    exercise,
    familyAccess,
    familyAlerts,
    familyInvites,
    familyLogin,
    familySignin,
    healthSamples,
    healthDevices,
    risks,
  };
}

export type TwinData = ReturnType<typeof useAllTables> & {
  identity: Identity | undefined;
  connected: boolean;
  me: ReturnType<typeof useAllTables>['profiles'][number] | undefined;
};

const DataContext = createContext<TwinData | null>(null);

/** One subscription set for the whole app, shared through context. */
export function DataProvider({ children }: { children: ReactNode }) {
  const { isActive, identity } = useSpacetimeDB();
  const data = useAllTables();
  const me = useMemo(
    () => data.profiles.find(p => identity && p.identity.isEqual(identity)),
    [data.profiles, identity]
  );
  const value = useMemo(
    () => ({ ...data, identity, connected: isActive, me }),
    [data, identity, isActive, me]
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}

const ACTIVE = new Set(['open', 'acknowledged', 'escalated']);

export function activeAlertFor(data: TwinData, patientId: bigint) {
  return data.alerts
    .filter(a => a.patientId === patientId && ACTIVE.has(a.status))
    .sort((a, b) => b.rank - a.rank)[0];
}

export function vitalsFor(data: TwinData, patientId: bigint) {
  return data.vitals
    .filter(v => v.patientId === patientId)
    .sort((a, b) => (a.ts.microsSinceUnixEpoch < b.ts.microsSinceUnixEpoch ? -1 : 1));
}

export function medicationsFor(data: TwinData, patientId: bigint) {
  return data.medications
    .filter(m => m.patientId === patientId && m.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Newest first. */
export function dosesFor(data: TwinData, patientId: bigint) {
  return data.doses
    .filter(d => d.patientId === patientId)
    .sort((a, b) => (a.scheduledFor.microsSinceUnixEpoch < b.scheduledFor.microsSinceUnixEpoch ? 1 : -1));
}

export function riskFor(data: TwinData, patientId: bigint) {
  return data.risks.find(r => r.patientId === patientId);
}

export function symptomsFor(data: TwinData, patientId: bigint) {
  return data.symptoms
    .filter(s => s.patientId === patientId)
    .sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
    );
}

/** Library sections for one entry, in stored order. */
export function sectionsFor(data: TwinData, entryId: bigint) {
  return data.librarySections
    .filter(s => s.entryId === entryId)
    .sort((a, b) => a.position - b.position);
}

/** Lab results for one patient, newest first. */
export function labsFor(data: TwinData, patientId: bigint) {
  return data.labResults
    .filter(l => l.patientId === patientId)
    .sort((a, b) => (a.resultedAt.microsSinceUnixEpoch < b.resultedAt.microsSinceUnixEpoch ? 1 : -1));
}

/** History items for one patient, oldest first. */
export function historyFor(data: TwinData, patientId: bigint) {
  return data.historyItems
    .filter(h => h.patientId === patientId)
    .sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : 1
    );
}

/** Assistive devices for one patient, oldest first. */
export function devicesFor(data: TwinData, patientId: bigint) {
  return data.assistiveDevices
    .filter(d => d.patientId === patientId)
    .sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : 1
    );
}

/** True when the chart lists a wheelchair, so the twin should be shown seated. */
export function chartUsesWheelchair(data: TwinData, patientId: bigint) {
  return devicesFor(data, patientId).some(d => d.slug === 'wheelchair');
}

/** Head-to-toe assessment rows for one patient, newest first. */
export function assessmentsFor(data: TwinData, patientId: bigint) {
  return data.systemAssessments
    .filter(a => a.patientId === patientId)
    .sort((a, b) =>
      a.assessedAt.microsSinceUnixEpoch < b.assessedAt.microsSinceUnixEpoch ? 1 : -1
    );
}

/** Mental-health check-ins for one patient, newest first. */
export function mentalHealthFor(data: TwinData, patientId: bigint) {
  return data.mhCheckIns
    .filter(r => r.patientId === patientId)
    .sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
    );
}

/** Diet and sleep entries for one patient, newest first. */
export function lifestyleFor(data: TwinData, patientId: bigint, kind: 'diet' | 'sleep') {
  return data.lifestyle
    .filter(l => l.patientId === patientId && l.kind === kind)
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));
}

/** One patient's workouts — the weekly plan plus logged sessions — newest first. */
export function exerciseFor(data: TwinData, patientId: bigint) {
  return data.exercise
    .filter(e => e.patientId === patientId)
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));
}

/** Voice captures for one patient, newest first. */
export function voiceDraftsFor(data: TwinData, patientId: bigint) {
  return data.voiceDrafts
    .filter(d => d.patientId === patientId && d.status !== 'dismissed')
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));
}

/** Proposed updates for one draft, in the order they were suggested. */
export function voiceItemsFor(data: TwinData, draftId: bigint) {
  return data.voiceItems
    .filter(i => i.draftId === draftId)
    .sort((a, b) => a.position - b.position);
}

/** The patient's tab arrangement, falling back to the catalogue default. */
export function layoutFor(data: TwinData, patientId: bigint): Layout {
  const row = data.layouts.find(l => l.patientId === patientId);
  return row ? parseLayout(row.tabs) : defaultLayout();
}

/** The signed-in user's own console arrangement; the catalogue default until they arrange it. */
export function userLayoutFor(data: TwinData, identity: Identity | undefined): Layout {
  const row = identity ? data.userLayouts.find(l => l.identity.toHexString() === identity.toHexString()) : undefined;
  return { tabs: row ? parseLayout(row.tabs).tabs : defaultLayout().tabs, goal: '', assessed: true };
}

/** Everyone the patient has invited or authorised, oldest first. Revoked people drop off. */
export function familyFor(data: TwinData, patientId: bigint) {
  return data.familyAccess
    .filter(a => a.patientId === patientId && a.status !== 'revoked')
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : 1));
}

/** The invite code for one pending invite. Only the patient's own browser can see it. */
export function inviteCodeFor(data: TwinData, accessId: bigint) {
  return data.familyInvites.find(c => c.accessId === accessId)?.code;
}

/** The signed-in family member's grant, newest first when they follow more than one person. */
export function myFamilyAccess(data: TwinData) {
  const id = data.identity;
  if (!id) return undefined;
  return data.familyAccess
    .filter(a => a.memberIdentity && a.memberIdentity.isEqual(id))
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1))[0];
}

/** Notices for one family member, newest first. */
export function familyAlertsFor(data: TwinData, accessId: bigint) {
  return data.familyAlerts
    .filter(a => a.accessId === accessId)
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));
}

/** All appointments for one patient, earliest first, past visits included. */
export function appointmentsFor(data: TwinData, patientId: bigint) {
  return data.appointments
    .filter(a => a.patientId === patientId)
    .sort((a, b) =>
      a.whenAt.microsSinceUnixEpoch < b.whenAt.microsSinceUnixEpoch ? -1 : a.whenAt.microsSinceUnixEpoch > b.whenAt.microsSinceUnixEpoch ? 1 : 0
    );
}

/** Booked appointments for one patient that have not happened yet, earliest first. */
export function upcomingAppointmentsFor(data: TwinData, patientId: bigint, nowMs = Date.now()) {
  return appointmentsFor(data, patientId).filter(
    a => a.status === 'booked' && Number(a.whenAt.microsSinceUnixEpoch / 1000n) >= nowMs
  );
}

/** The care thread for one patient, oldest first, optionally one channel only. */
export function messagesFor(data: TwinData, patientId: bigint, channel?: string) {
  return data.messages
    .filter(m => m.patientId === patientId && (channel === undefined || m.channel === channel))
    .sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch
        ? -1
        : a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch
          ? 1
          : 0
    );
}
