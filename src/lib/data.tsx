import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { Identity } from 'spacetimedb';

function useAllTables() {
  const [patients, patientsReady] = useTable(tables.patient);
  const [profiles] = useTable(tables.userProfile);
  const [symptoms] = useTable(tables.symptomEntry);
  const [vitals] = useTable(tables.vitalSample);
  const [alerts] = useTable(tables.alert);
  const [reports] = useTable(tables.sbarReport);
  const [audit] = useTable(tables.auditEvent);
  const [presence] = useTable(tables.presence);
  const [sims] = useTable(tables.simState);
  const [twinStatuses] = useTable(tables.twinStatus);
  return { patients, patientsReady, profiles, symptoms, vitals, alerts, reports, audit, presence, sims, twinStatuses };
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

export function symptomsFor(data: TwinData, patientId: bigint) {
  return data.symptoms
    .filter(s => s.patientId === patientId)
    .sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
    );
}
