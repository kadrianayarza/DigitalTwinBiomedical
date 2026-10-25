import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { AssistiveDevice } from '../module_bindings/types';
import { timeAgo } from '../lib/format';

type Props = {
  /** The tapped chart device. */
  device: AssistiveDevice;
  patientName: string;
  mode: 'patient' | 'nurse';
  onOpenLibrary: (slug: string) => void;
  onClose: () => void;
};

/**
 * Review one assistive device, tapped on its 3D prop. Either side can confirm the
 * device is in use; the guide opens from here too, so the patient and nurse are
 * looking at the same object and the same answer.
 */
export function DeviceSheet({ device, patientName, mode, onOpenLibrary, onClose }: Props) {
  const confirm = useReducer(reducers.confirmAssistiveDevice);
  const del = useReducer(reducers.deleteAssistiveDevice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmedBy = device.confirmedBy || '';
  const confirmed = confirmedBy !== '';
  // Patients can change only the devices they added; the nurse can change anything.
  const canTouch = mode === 'nurse' || device.createdBy === patientName;

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet devicesheet" onClick={e => e.stopPropagation()}>
        <header className="sheet__head">
          <div>
            <div className="kicker">Assistive device · {patientName}</div>
            <h2 className="sheet__title">{device.name}</h2>
            <p className="muted small">
              Since {device.sinceText || 'unknown'} · added by {device.createdBy}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {device.detail && <p className="devicesheet__detail">{device.detail}</p>}

        <div className="devicesheet__status">
          {confirmed ? (
            <span className="tag tag--ok">
              Confirmed by {confirmedBy} · {timeAgo(device.confirmedAt)}
            </span>
          ) : (
            <span className="chip chip--warn">Needs confirmation</span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <footer className="sheet__foot">
          <div className="devicesheet__actions">
            <button type="button" className="btn btn--ghost" onClick={() => onOpenLibrary(device.slug)}>
              Read the full guide
            </button>
            {canTouch && (
              <button
                type="button"
                className="btn btn--ghost chart__del"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await del({ id: device.id });
                    onClose();
                  });
                }}
              >
                Remove
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={busy}
            onClick={() => void run(() => confirm({ id: device.id }))}
          >
            {confirmed ? 'Confirm again' : 'Confirm in use'}
          </button>
        </footer>
      </div>
    </div>
  );
}
