import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Patient } from '../module_bindings/types';
import { activeAlertFor, chartUsesWheelchair, devicesFor, layoutFor, symptomsFor, useData, vitalsFor } from '../lib/data';
import { careLabel, daysSince, timeAgo, usesWheelchair } from '../lib/format';
import { visibleTabs, type TabId } from '../lib/voice';
import { PAGE_TABS, useTabNavigator } from '../lib/navigate';
import { CareMessagesCard } from '../components/CareMessagesCard';
import { PageNav, useShellPage } from '../components/PageNav';
import { TwinViewer, type TwinDevice, type TwinPin, type TwinPointer } from '../twin/TwinViewer';
import { regionLabel } from '../twin/bodyModel';
import { buildHotspots } from '../twin/hotspots';
import { hasKneeImplant } from '../twin/focus';
import { PodVitals } from '../components/PodVitals';
import { Brand, Panel, SeverityHex } from '../components/ui';
import { CustomizePanel } from '../components/CustomizePanel';
import { LifestyleCard } from '../components/LifestyleCard';
import { ExerciseCard } from '../components/ExerciseCard';
import { DevicesCard } from '../components/DevicesCard';
import { DeviceSheet } from '../components/DeviceSheet';
import { MentalHealthCard } from '../components/MentalHealthCard';
import { ScheduleCard } from '../components/ScheduleCard';
import { CRISIS_LINES, isMhCrisisAlert } from '../lib/mentalHealth';
import { VoiceAssistant } from '../components/VoiceAssistant';
import { SymptomSheet, type SymptomDraft } from './SymptomSheet';
import { TwinPhotoCard } from './TwinPhotoCard';
import { MedicationCard, useDoseReminders } from './MedicationCard';
import { HealthRecordCard } from './HealthRecordCard';
import { HistoryCard } from './HistoryCard';
import { FamilyAccessCard } from './FamilyAccessCard';
import { LibraryDrawer } from '../library/LibraryDrawer';
import { RoleSwitch } from '../components/RoleSwitch';
import { PatientSwitch } from '../components/PatientSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { AgentChat } from '../agent/AgentChat';
import { patientAgentContext } from '../agent/context';
import { HealthApp, type Page } from '../health/HealthApp';
import { HealthButton } from '../health/HealthButton';
import { HealthGlance } from '../health/HealthGlance';

/** Returning from Google sign-in lands on Sources so the sync can finish. */
const returningFromGoogle = () => new URLSearchParams(window.location.search).get('health')?.startsWith('google-') ?? false;

export function PatientView({ patient }: { patient: Patient }) {
  const data = useData();
  const logSymptom = useReducer(reducers.logSymptom);
  const updatePointer = useReducer(reducers.updatePointer);
  const [pending, setPending] = useState<{ region: string; point: [number, number, number] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [libSlug, setLibSlug] = useState<string | null>(null);
  const [devicePick, setDevicePick] = useState<string | null>(null);
  const [showTwin, setShowTwin] = useState(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((message: string, ms = 2500) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);
  useDoseReminders(patient.id, useCallback((message: string) => flash(message, 6000), [flash]));
  const [health, setHealth] = useState<Page | null>(() => (returningFromGoogle() ? { kind: 'sources' } : null));

  // Keep the full body clear of the header, banner and hint that overlay the stage.
  const stageRef = useRef<HTMLElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const [fitTop, setFitTop] = useState(140);

  const symptoms = symptomsFor(data, patient.id);
  const vitals = vitalsFor(data, patient.id);
  const alert = activeAlertFor(data, patient.id);
  const layout = layoutFor(data, patient.id);
  const navigateTab = useTabNavigator(patient.id, 'patient');
  const [page, setPage] = useShellPage();
  const day = daysSince(patient.surgeryAt);
  const firstName = patient.name.split(' ')[0];
  const twinEnabled = layout.tabs.find(t => t.id === 'twin')?.on !== false;

  const pins: TwinPin[] = useMemo(() => {
    const list: TwinPin[] = symptoms.slice(0, 12).map(s => ({
      id: String(s.id),
      x: s.x,
      y: s.y,
      z: s.z,
      severity: s.severity,
      label: `${regionLabel(s.region)} · ${s.severity}/10`,
    }));
    if (pending) {
      list.push({
        id: 'pending',
        x: pending.point[0],
        y: pending.point[1],
        z: pending.point[2],
        severity: 0,
        label: regionLabel(pending.region),
        pending: true,
      });
    }
    return list;
  }, [symptoms, pending]);

  const pointers: TwinPointer[] = data.presence
    .filter(p => p.patientId === patient.id && p.pointing && p.role === 'nurse')
    .map(p => ({ id: p.identity.toHexString(), name: p.name, x: p.x, y: p.y, z: p.z,     color: '#9b6bff' }));

  // Equipment on the chart becomes 3D props around the twin; tapping one opens its sheet.
  const devices = devicesFor(data, patient.id);
  const twinDevices = useMemo<TwinDevice[]>(
    () =>
      devices.map(d => ({
        id: String(d.id),
        slug: d.slug,
        name: d.name,
        confirmed: !!d.confirmedBy,
      })),
    [devices]
  );
  const pickedDevice = devicePick ? devices.find(d => String(d.id) === devicePick) : undefined;

  const submit = (d: SymptomDraft) => {
    if (!pending) return;
    const f = parseFloat(d.bodyTempF);
    const bodyTempC = Number.isFinite(f) && f > 90 ? ((f - 32) * 5) / 9 : 0;
    void logSymptom({
      patientId: patient.id,
      region: pending.region,
      x: pending.point[0],
      y: pending.point[1],
      z: pending.point[2],
      onset: d.onset,
      provocation: d.provocation,
      quality: d.quality.toLowerCase(),
      radiation: d.radiation,
      severity: d.severity,
      timing: d.timing,
      swelling: d.swelling,
      warmth: d.warmth,
      redness: d.redness,
      shortnessOfBreath: d.shortnessOfBreath,
      chestPain: d.chestPain,
      bodyTempC,
      notes: d.notes,
      source: 'tap',
    }).catch(e => setToast(`Could not send: ${String(e)}`));
    setPending(null);
    flash('Sent to your nurse');
  };

  const status = (() => {
    if (!alert) return null;
    if (alert.priority === 'emergency' && alert.status === 'open') return 'emergency';
    if (alert.status === 'open') return 'notified';
    return 'reviewed';
  })();

  // Check-ins and vitals keep their fixed places; the other enabled tabs follow the patient's chosen order.
  const order = visibleTabs(layout.tabs, 'patient');
  const FIXED: TabId[] = ['check-ins', 'vitals', 'twin'];
  const extras: Array<{ id: TabId; node: ReactNode }> = order
    .filter(id => !FIXED.includes(id) && !PAGE_TABS.has(id))
    .map(id => ({ id, node: renderTab(id) }));

  function renderTab(id: TabId): ReactNode {
    switch (id) {
      case 'check-ins':
        return (
          <Panel
            key="check-ins"
            title="Your check-ins"
            code={`${symptoms.length} sent`}
            collapsible
          >
            {symptoms.length === 0 ? (
              <p className="muted">No check-ins yet. Tap your twin where you feel something.</p>
            ) : (
              <ul className="list">
                {symptoms.slice(0, 6).map(s => (
                  <li key={String(s.id)} className="list__row">
                    <SeverityHex severity={s.severity} />
                    <span className="list__main">
                      {regionLabel(s.region)}
                      <span className="muted small">{s.quality || 'pain'}</span>
                    </span>
                    <span className="mono muted small">{timeAgo(s.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      case 'vitals':
        return <PodVitals key="vitals" vitals={vitals} />;
      case 'medications':
        return <MedicationCard key="medications" patient={patient} />;
      case 'health-record':
        return <HealthRecordCard key="health-record" patient={patient} onOpenLibrary={setLibSlug} />;
      case 'diet':
        return <LifestyleCard key="diet" patientId={patient.id} kind="diet" />;
      case 'sleep':
        return <LifestyleCard key="sleep" patientId={patient.id} kind="sleep" />;
      case 'exercise':
        return <ExerciseCard key="exercise" patientId={patient.id} />;
      case 'twin':
        return <TwinPhotoCard key="twin" patient={patient} />;
      case 'history':
        return <HistoryCard key="history" patient={patient} onOpenLibrary={setLibSlug} />;
      case 'devices':
        return <DevicesCard key="devices" patient={patient} onOpenLibrary={setLibSlug} />;
      case 'mood':
        return <MentalHealthCard key="mood" patientId={patient.id} patientName={patient.name} mode="patient" />;
      default:
        return null;
    }
  }

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const hint = hintRef.current;
    if (!stage || !hint) return;
    const measure = () =>
      setFitTop(Math.round(hint.getBoundingClientRect().bottom - stage.getBoundingClientRect().top) + 10);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [status, showTwin, twinEnabled]);

  return (
    <div className="patient">
      <header className="topbar">
        <Brand />
        <div className="topbar__who">
          <strong>Hi {firstName}</strong>
          <span className="mono">
            Day {String(day).padStart(2, '0')} · {careLabel(patient)}
          </span>
        </div>
        <HealthButton onClick={() => setHealth({ kind: 'summary' })} />
        <ThemeSwitch />
        <PatientSwitch currentId={patient.id} />
        <RoleSwitch to="nurse" />
      </header>

      <PageNav page={page} onChange={setPage} tabs={order} />

      {status && (
        <div className="patient__banner">
          {status === 'emergency' &&
            (alert && isMhCrisisAlert(alert.reasonCodes) ? (
              <div className="banner banner--crisis" role="alert">
                <span className="banner__title">You are not alone - help is available right now</span>
                <span>
                  Your latest check-in raised a concern about your safety, and your care team has been alerted
                  and will reach out. You do not have to wait for them:
                </span>
                <ul className="banner__crisis-lines">
                  {CRISIS_LINES.map(line => (
                    <li key={line.label}>
                      <strong>{line.label}</strong>
                      <span className="muted"> — {line.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="banner banner--emergency" role="alert">
                <span className="banner__title">Call 911 now</span>
                <span>If you have chest pain or trouble breathing, call 911. Your nurse has been alerted.</span>
              </div>
            ))}
          {status === 'notified' && (
            <div className="banner banner--info" role="status">
              Your care team has been notified and will review your check-in.
            </div>
          )}
          {status === 'reviewed' && (
            <div className="banner banner--ok" role="status">
              {alert?.ackedByName || 'Your nurse'} has reviewed your check-in
              {alert?.status === 'escalated' ? ' and is contacting your doctor.' : '.'}
            </div>
          )}
        </div>
      )}

      {page !== 'home' && (
        <main className="pageview" data-tab={page}>
          {page === 'schedule' ? (
            <ScheduleCard patientId={patient.id} patientName={patient.name} mode="patient" />
          ) : page === 'messages' ? (
            <CareMessagesCard patientId={patient.id} patientName={patient.name} mode="patient" />
          ) : (
            <CustomizePanel patientId={patient.id} />
          )}
        </main>
      )}

      {page === 'home' && showTwin && twinEnabled ? (
        <main className="patient__stage" data-tab="twin-stage" ref={stageRef}>
          <div className="hint" aria-hidden ref={hintRef}>
            Tap your twin where it hurts
          </div>
          <TwinViewer
            fitTop={fitTop}
            side={patient.side === 'left' ? 'left' : 'right'}
            pins={pins}
            pointers={pointers}
            devices={twinDevices}
            twinUrl={patient.twinUrl}
            seated={usesWheelchair(patient) || chartUsesWheelchair(data, patient.id)}
            procedure={patient.procedure}
            hotspots={buildHotspots({ vitals, audience: 'patient', kneeImplant: hasKneeImplant(patient.procedure) })}
            onTap={(region, point) => setPending({ region, point })}
            onSelectDevice={setDevicePick}
            onHover={p =>
              void updatePointer({
                patientId: patient.id,
                x: p?.[0] ?? 0,
                y: p?.[1] ?? 0,
                z: p?.[2] ?? 0,
                pointing: !!p,
              }).catch(() => {})
            }
          />
        </main>
      ) : null}

      {page === 'home' && (
      <button
        className="twin-toggle"
        aria-pressed={showTwin && twinEnabled}
        disabled={!twinEnabled}
        title={twinEnabled ? 'Show or hide the 3D model' : 'The 3D twin tab is switched off'}
        onClick={() => setShowTwin(v => !v)}
      >
        {showTwin && twinEnabled ? 'Hide 3D model' : 'Show 3D model'}
      </button>
      )}

      {page === 'home' && (
      <aside className="patient__left">
        {order.includes('check-ins') && (
          <div data-tab="check-ins" className="tabslot">
            {renderTab('check-ins')}
          </div>
        )}
        <TwinPhotoCard patient={patient} />
        <HealthGlance patient={patient} variant="patient" onOpen={p => setHealth(p ?? { kind: 'summary' })} />
      </aside>
      )}

      {page === 'home' && (
      <aside className="patient__right">
        {order.includes('vitals') && (
          <div data-tab="vitals" className="tabslot">
            {renderTab('vitals')}
          </div>
        )}
        {extras.map(card => (
          <div key={card.id} data-tab={card.id} className="tabslot">
            {card.node}
          </div>
        ))}
        <div data-tab="family" className="tabslot">
          <FamilyAccessCard patientId={patient.id} />
        </div>
      </aside>
      )}

      <AgentChat
        audience="patient"
        threadKey={`patient-${patient.id}`}
        title="Your health agent"
        subtitle="Knows your twin and recent readings"
        greeting={`Hi ${firstName}, I'm your health agent. I can see your twin's vitals and your check-ins. Ask me how you're doing, what a number means, or what to watch for.`}
        suggestions={['How am I doing today?', 'What do my vitals mean?', 'Take me to my appointments']}
        disclaimer="Not a diagnosis. In an emergency, call 911."
        buildContext={() => patientAgentContext(data, patient)}
        onNavigate={navigateTab}
      />

      {health && <HealthApp key={String(patient.id)} patient={patient} viewer="patient" initial={health} onClose={() => setHealth(null)} />}
      {pending && <SymptomSheet region={pending.region} onCancel={() => setPending(null)} onSubmit={submit} />}
      {pickedDevice && (
        <DeviceSheet
          device={pickedDevice}
          patientName={patient.name}
          mode="patient"
          onOpenLibrary={setLibSlug}
          onClose={() => setDevicePick(null)}
        />
      )}
      {libSlug && (
        <LibraryDrawer
          slug={libSlug}
          audience="patient"
          onNavigate={setLibSlug}
          onClose={() => setLibSlug(null)}
        />
      )}
      <VoiceAssistant patientId={patient.id} audience="patient" />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
