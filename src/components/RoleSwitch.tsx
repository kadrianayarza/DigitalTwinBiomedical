import { useEffect, useRef } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { useData } from '../lib/data';
import { goToRole, type Role } from '../lib/role';

const PATIENT_PARAM = 'patient';

/**
 * Each role keeps its own identity (see main.tsx), so switching never edits the current
 * profile: the patient view adopts the patient named in `?patient=` on arrival.
 */
export function useAdoptPatientParam(role: Role) {
  const data = useData();
  const setProfile = useReducer(reducers.setProfile);
  const sent = useRef(false);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(PATIENT_PARAM);
    if (role !== 'patient' || !raw || !data.connected || !data.patientsReady) return;
    const clearParam = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete(PATIENT_PARAM);
      window.history.replaceState(null, '', url);
    };
    const patient = data.patients.find(p => String(p.id) === raw);
    if (!patient) return clearParam();
    if (data.me?.role === 'patient' && data.me.patientId === patient.id) return clearParam();
    if (sent.current) return;
    sent.current = true;
    setProfile({ name: patient.name, role: 'patient', patientId: patient.id }).catch(clearParam);
  }, [role, data.connected, data.patientsReady, data.patients, data.me, setProfile]);
}

type Props = { to: 'patient'; patientId: bigint; patientName: string } | { to: 'nurse' };

/** Small corner button that flips this browser between the nurse console and a patient's view. */
export function RoleSwitch(props: Props) {
  const label =
    props.to === 'patient' ? `Switch to ${props.patientName.split(' ')[0]}'s patient view` : 'Switch to nurse console';
  const go = () =>
    props.to === 'patient' ? goToRole('patient', { [PATIENT_PARAM]: String(props.patientId) }) : goToRole('nurse');

  return (
    <button className="roleswitch" onClick={go} aria-label={label} title={label}>
      {props.to === 'patient' ? (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="7.5" r="3.5" />
          <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3.5l7 3v5.2c0 4.3-2.9 7.6-7 8.8-4.1-1.2-7-4.5-7-8.8V6.5l7-3z" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      )}
    </button>
  );
}
