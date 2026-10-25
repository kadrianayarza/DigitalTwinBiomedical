import { useEffect, useRef, useState } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer } from 'spacetimedb/react';
import { DEVICE_KINDS } from '../../spacetimedb/src/health';
import { reducers } from '../module_bindings';
import { timeAgo } from '../lib/format';
import type { ImportSample } from './appleParse';
import { batches, readAppleExport, type ImportProgress } from './appleImport';
import { CategoryIcon } from './icons';
import type { HealthCtx } from './HealthApp';

const SOURCE_LABEL: Record<string, string> = { apple_health: 'Apple Health', google_health: 'Google Health', manual: 'Entered by hand' };
const DEMO_KINDS = ['apple_watch', 'fitbit', 'pixel_watch', 'smart_scale', 'bp_cuff', 'glucose_monitor'];

type GoogleStatus = { configured: boolean; connected: boolean } | null;

const toInput = (s: ImportSample) => ({
  metric: s.metric,
  value: s.value,
  label: s.label,
  startAt: Timestamp.fromDate(new Date(s.start)),
  endAt: Timestamp.fromDate(new Date(s.end)),
});

export function Sources({ ctx }: { ctx: HealthCtx }) {
  const { h, patient, toast } = ctx;
  const importSamples = useReducer(reducers.importHealthSamples);
  const pair = useReducer(reducers.pairDemoDevice);
  const removeDevice = useReducer(reducers.removeHealthDevice);
  const file = useRef<HTMLInputElement>(null);
  const [days, setDays] = useState(90);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [google, setGoogle] = useState<GoogleStatus>(null);
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState<bigint | null>(null);
  const autoSynced = useRef(false);

  const counts = new Map<string, number>();
  for (const list of h.byMetric.values()) for (const s of list) counts.set(s.device, (counts.get(s.device) ?? 0) + 1);

  const refreshGoogle = () =>
    fetch(`/api/health/google/status?patient=${patient.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setGoogle)
      .catch(() => setGoogle(null));

  const syncGoogle = async () => {
    setSyncing(true);
    try {
      const r = await fetch(`/api/health/google/sync?patient=${patient.id}&days=30`, { method: 'POST' });
      const body = (await r.json()) as { device?: { name: string; kind: string }; samples?: ImportSample[]; errors?: string[]; error?: string };
      if (!r.ok || !body.device || !body.samples) throw new Error(body.error ?? `HTTP ${r.status}`);
      for (let i = 0; i < Math.max(1, body.samples.length); i += 2000) {
        await importSamples({
          patientId: patient.id,
          kind: body.device.kind,
          device: body.device.name,
          source: 'google_health',
          samples: body.samples.slice(i, i + 2000).map(toInput),
        });
      }
      toast(`Synced ${body.samples.length.toLocaleString()} readings from ${body.device.name}`);
      if (body.errors?.length) setResult(`Some data types could not be read: ${body.errors.join('; ')}`);
    } catch (e) {
      toast(`Google Health sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
      void refreshGoogle();
    }
  };

  useEffect(() => {
    void refreshGoogle();
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('health');
    if (!flag?.startsWith('google-')) return;
    params.delete('health');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    if (flag === 'google-connected' && !autoSynced.current) {
      autoSynced.current = true;
      void syncGoogle();
    } else if (flag === 'google-denied') toast('Google Health access was not granted');
    else if (flag === 'google-failed') toast('Could not finish connecting Google Health');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (f: File) => {
    setResult(null);
    setProgress({ phase: 'reading', fraction: 0, records: 0 });
    try {
      const { bySource, records } = await readAppleExport(f, days, setProgress);
      const jobs = batches(bySource);
      let sent = 0;
      for (const [i, job] of jobs.entries()) {
        setProgress({ phase: 'uploading', fraction: i / Math.max(1, jobs.length), records });
        await importSamples({ patientId: patient.id, kind: job.kind, device: job.source, source: 'apple_health', samples: job.samples.map(toInput) });
        sent += job.samples.length;
      }
      const sources = [...bySource.keys()];
      setResult(
        sent
          ? `Imported ${sent.toLocaleString()} daily and hourly readings (from ${records.toLocaleString()} raw records) across ${sources.length} source${sources.length === 1 ? '' : 's'}: ${sources.join(', ')}.`
          : `No supported readings from the last ${days} days were found in that export.`
      );
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="hpage">
      <div className="hpage__head">
        <h1 className="hpage__title">Sources</h1>
        <p className="muted hpage__sub">Apps and devices that send data to {ctx.viewer === 'nurse' ? `${patient.name.split(' ')[0]}'s` : 'your'} record.</p>
      </div>

      <section className="hsection">
        <div className="hsection__head">
          <h2>Connected</h2>
        </div>
        {h.devices.length === 0 ? (
          <p className="muted">Nothing connected yet.</p>
        ) : (
          <ul className="hdevices">
            {h.devices.map(d => (
              <li key={String(d.id)} className="hcard hdevice">
                <span className="hdevice__icon" data-kind={d.kind}>
                  <DeviceGlyph kind={d.kind} />
                </span>
                <span className="hdevice__main">
                  <strong>
                    {d.name}
                    {d.demo && <span className="hbadge">Demo</span>}
                  </strong>
                  <span className="muted small">
                    via {SOURCE_LABEL[d.source] ?? d.source} · {(counts.get(d.name) ?? 0).toLocaleString()} readings · synced {timeAgo(d.lastSyncAt)}
                  </span>
                </span>
                {d.source === 'google_health' && !d.demo && google?.connected && (
                  <button className="btn" disabled={syncing} onClick={() => void syncGoogle()}>
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                )}
                {confirm === d.id ? (
                  <span className="hdevice__confirm">
                    <button className="btn btn--warn" onClick={() => void removeDevice({ deviceId: d.id }).then(() => setConfirm(null))}>
                      Remove and delete data
                    </button>
                    <button className="btn btn--ghost" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button className="hlink" onClick={() => setConfirm(d.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="hsection">
        <div className="hsection__head">
          <h2>Add a source</h2>
        </div>
        <div className="hsources">
          <div className="hcard hsource">
            <div className="hsource__head">
              <span className="hdevice__icon" data-kind="apple_watch">
                <DeviceGlyph kind="apple_watch" />
              </span>
              <div>
                <strong>Apple Health</strong>
                <span className="muted small">iPhone, Apple Watch and apps that write to Health</span>
              </div>
            </div>
            <ol className="hsteps small">
              <li>On your iPhone, open Health and tap your picture, then Export All Health Data.</li>
              <li>Save or AirDrop the export.zip to this device.</li>
              <li>Choose it below. It's read in your browser; only daily and hourly summaries are saved.</li>
            </ol>
            <div className="hsource__row">
              <label className="small muted">
                Import the last{' '}
                <select className="input hselect" value={days} onChange={e => setDays(Number(e.target.value))}>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>year</option>
                </select>
              </label>
              <input
                ref={file}
                type="file"
                accept=".zip,.xml,application/zip,text/xml"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <button className="btn btn--primary" disabled={!!progress} onClick={() => file.current?.click()}>
                Import Health export
              </button>
            </div>
            {progress && (
              <div className="hprogress" role="progressbar" aria-valuenow={Math.round(progress.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                <span className="small muted">
                  {progress.phase === 'reading' ? `Reading export… ${progress.records.toLocaleString()} records` : 'Saving to your record…'}
                </span>
              </div>
            )}
            {result && <p className="small hsource__result">{result}</p>}
          </div>

          <div className="hcard hsource">
            <div className="hsource__head">
              <span className="hdevice__icon" data-kind="fitbit">
                <DeviceGlyph kind="fitbit" />
              </span>
              <div>
                <strong>Google Health</strong>
                <span className="muted small">Fitbit and Pixel Watch</span>
              </div>
            </div>
            <p className="small muted">
              Sign in with the Google account your Fitbit or Pixel Watch uses. We read activity, heart, sleep, breathing, body and nutrition data
              (read only) for the last 30 days. Fitbit's own Web API is being retired, so new connections go through Google Health.
            </p>
            {google === null ? (
              <p className="small muted">Checking…</p>
            ) : !google.configured ? (
              <p className="small hsource__result">
                Google sign-in isn't set up on this server yet. The operator adds a Google OAuth client to the server settings. Until then, pair a
                demo Fitbit or Pixel Watch from Demo devices.
              </p>
            ) : google.connected ? (
              <div className="hsource__row">
                <span className="hbadge hbadge--ok">Connected</span>
                <button className="btn btn--primary" disabled={syncing} onClick={() => void syncGoogle()}>
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  className="hlink"
                  onClick={() => void fetch(`/api/health/google/disconnect?patient=${patient.id}`, { method: 'POST' }).then(refreshGoogle)}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <a
                className="btn btn--primary"
                href={`/api/health/google/start?patient=${patient.id}&return=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              >
                Connect with Google
              </a>
            )}
          </div>

          <div className="hcard hsource">
            <div className="hsource__head">
              <span className="hdevice__icon" data-kind="demo">
                <CategoryIcon id="sources" />
              </span>
              <div>
                <strong>Demo devices</strong>
                <span className="muted small">Simulated, with four weeks of typical readings</span>
              </div>
            </div>
            <div className="chips">
              {DEMO_KINDS.map(kind => {
                const name = `${DEVICE_KINDS[kind]!.name} (demo)`;
                const paired = h.devices.some(d => d.name === name);
                return (
                  <button
                    key={kind}
                    className={`chip ${paired ? 'chip--on' : ''}`}
                    disabled={paired}
                    onClick={() =>
                      pair({ patientId: patient.id, kind })
                        .then(() => toast(`Paired ${name}`))
                        .catch(e => toast(`Could not pair: ${String(e)}`))
                    }
                  >
                    {paired ? '✓ ' : '+ '}
                    {DEVICE_KINDS[kind]!.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function DeviceGlyph({ kind }: { kind: string }) {
  const d =
    kind === 'smart_scale' ? 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm3.5 4.5a4.5 4.5 0 0 1 7 0l-2 2.5'
    : kind === 'bp_cuff' ? 'M4 8h11v8H4zM15 12h3a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0M7 12h5'
    : kind === 'glucose_monitor' ? 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
    : kind === 'iphone' ? 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 15h2'
    : kind === 'fitbit' ? 'M9 3h6v4H9zM9 17h6v4H9zM8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm2 5h4'
    : kind === 'pixel_watch' ? 'M9 3.5h6l.5 3h-7zM9 20.5h6l.5-3h-7zM12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z'
    : kind === 'app' ? 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z'
    : 'M9 3.5h6l.6 3H8.4zM9 20.5h6l.6-3H8.4zM7.5 6.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z';
  return (
    <svg viewBox="0 0 24 24" className="hicon" aria-hidden>
      <path d={d} />
    </svg>
  );
}
