import { useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Patient } from '../module_bindings/types';
import { useData } from '../lib/data';
import { Panel } from '../components/ui';

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
    <Panel title="Your twin" code={patient.twinUrl ? 'Personal scan' : 'Reference body'} className="twinphoto">
      <p className="muted small">
        {patient.twinUrl
          ? 'Your twin was made from your photo. The shape is approximate.'
          : 'Add a full-body photo (standing, arms slightly out) and we will shape the twin to look like you.'}
      </p>

      {busy && (
        <div className="twinphoto__status" role="status">
          <span className="spinner" aria-hidden />
          {uploading || status?.status === 'queued'
            ? 'Submitting your photo…'
            : status?.detail || 'Building your 3D twin. This can take several minutes.'}
        </div>
      )}
      {status?.status === 'error' && <div className="twinphoto__error">Couldn’t build your twin: {status.detail}</div>}
      {error && <div className="twinphoto__error">{error}</div>}

      <div className="twinphoto__actions">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {patient.twinUrl ? 'Use a new photo' : 'Make my twin from a photo'}
        </button>
        {patient.twinUrl && (
          <button
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void setTwinUrl({ patientId: patient.id, twinUrl: '' }).catch(e => setError(String(e)))}
          >
            Use reference body
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Full-body photo for your twin"
        disabled={busy}
        hidden
        onChange={e => void onFile(e.target.files?.[0])}
      />
      <p className="muted tiny">
        Your photo becomes an approximate outside view. Your care team sees the twin. The inside layers are a
        reference model, not your scan. Use non-sensitive photos for this demo.
      </p>
    </Panel>
  );
}
