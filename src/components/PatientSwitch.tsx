import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { useData } from '../lib/data';
import { careLabel } from '../lib/format';

/** Small dropdown in the patient topbar for switching which patient this browser checks in as. */
export function PatientSwitch({ currentId }: { currentId: bigint }) {
  const data = useData();
  const setProfile = useReducer(reducers.setProfile);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: bigint, name: string) => {
    setOpen(false);
    if (id === currentId) return;
    setPending(true);
    setProfile({ name, role: 'patient', patientId: id })
      .catch(e => console.warn('Could not switch patient', e))
      .finally(() => setPending(false));
  };

  return (
    <div className="pswitch" ref={root}>
      <button
        className="roleswitch pswitch__btn"
        onClick={() => setOpen(o => !o)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch patient"
        title="Switch patient"
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
          <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 13.8c1.8.8 3 2.7 3 5.2" />
        </svg>
        <svg className="pswitch__chev" viewBox="0 0 24 24" aria-hidden>
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="pswitch__menu" role="menu" aria-label="Patients">
          {data.patients.map(p => (
            <button
              key={String(p.id)}
              role="menuitemradio"
              aria-checked={p.id === currentId}
              className={`pswitch__item ${p.id === currentId ? 'pswitch__item--on' : ''}`}
              onClick={() => choose(p.id, p.name)}
            >
              <span className="pswitch__name">{p.name}</span>
              <span className="pswitch__care">{careLabel(p)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
