import { useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Patient } from '../module_bindings/types';
import { useData } from '../lib/data';

const MAX_SIDE = 1024;

/** Downscale to a JPEG data URI so the reducer payload stays small. */
async function toJpegDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function TwinPhotoCard({ patient }: { patient: Patient }) {
  const data = useData();
  const requestTwin = useReducer(reducers.requestTwin);
  const setTwinUrl = useReducer(reducers.setTwinUrl);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const status = data.twinStatuses.find(s => s.patientId === patient.id);
  const busy = uploading || status?.status === 'queued' || status?.status === 'generating';

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setUploading(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('Choose a JPEG, PNG or WebP photo.');
      }
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
      const photo = await toJpegDataUri(file);
      await requestTwin({ patientId: patient.id, photo });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div
      className="twinphoto"
      title="Use a full-body photo, standing with arms slightly out. The shape is approximate, your care team sees the twin, and the anatomy layers are a reference model. Use non-sensitive photos."
    >
      {busy ? (
        <div className="twinphoto__status" role="status">
          <span className="spinner" aria-hidden />
          {uploading || status?.status === 'queued'
            ? 'Submitting your photo…'
            : status?.detail || 'Building your 3D twin. This can take several minutes.'}
        </div>
      ) : (
        <div className="twinphoto__row">
          <span>{patient.twinUrl ? 'Twin made from your photo' : 'Twin shows the anatomy view'}</span>
          <button className="twinphoto__link" onClick={() => input.current?.click()}>
            {patient.twinUrl ? 'Change photo' : 'Add a photo'}
          </button>
          {patient.twinUrl && (
            <button
              className="twinphoto__link"
              onClick={() => void setTwinUrl({ patientId: patient.id, twinUrl: '' }).catch(e => setError(String(e)))}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {status?.status === 'error' && <div className="twinphoto__error">Couldn’t build your twin: {status.detail}</div>}
      {error && <div className="twinphoto__error">{error}</div>}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Full-body photo for your twin"
        disabled={busy}
        hidden
        onChange={e => void onFile(e.target.files?.[0])}
      />
    </div>
  );
}
