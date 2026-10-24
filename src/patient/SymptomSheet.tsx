import { useState } from 'react';
import { regionLabel } from '../twin/bodyModel';

export type SymptomDraft = {
  onset: string;
  provocation: string;
  quality: string;
  radiation: string;
  severity: number;
  timing: string;
  swelling: boolean;
  warmth: boolean;
  redness: boolean;
  shortnessOfBreath: boolean;
  chestPain: boolean;
  bodyTempF: string;
  notes: string;
};

const ONSET = ['Just now', 'Earlier today', 'Yesterday', '2+ days ago'];
const PROVOKE = ['Walking', 'Bending knee', 'Standing up', 'At rest', 'At night', 'Touching it'];
const QUALITY = ['Aching', 'Sharp', 'Throbbing', 'Burning', 'Tight', 'Cramping'];
const RADIATE = ['Stays here', 'Spreads up', 'Spreads down'];
const TIMING = ['Constant', 'Comes and goes', 'Only when moving'];
const painWord = (n: number) =>
  n === 0 ? 'No pain' : n <= 3 ? 'Mild' : n <= 6 ? 'Moderate' : n <= 9 ? 'Severe' : 'Worst possible';

type Props = {
  region: string;
  onCancel: () => void;
  onSubmit: (draft: SymptomDraft) => void;
};

export function SymptomSheet({ region, onCancel, onSubmit }: Props) {
  const [d, setD] = useState<SymptomDraft>({
    onset: '',
    provocation: '',
    quality: '',
    radiation: '',
    severity: 4,
    timing: '',
    swelling: false,
    warmth: false,
    redness: false,
    shortnessOfBreath: false,
    chestPain: false,
    bodyTempF: '',
    notes: '',
  });
  const set = <K extends keyof SymptomDraft>(k: K, v: SymptomDraft[K]) => setD(prev => ({ ...prev, [k]: v }));
  const toggleMulti = (k: 'provocation', v: string) => {
    const xs = new Set(d[k].split(', ').filter(Boolean));
    if (xs.has(v)) xs.delete(v);
    else xs.add(v);
    set(k, [...xs].join(', '));
  };
  const emergency = d.chestPain || d.shortnessOfBreath;

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          onSubmit(d);
        }}
      >
        <header className="sheet__head">
          <div>
            <div className="eyebrow">New check-in</div>
            <h2>{regionLabel(region)}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </header>

        <section className="emergency-q">
          <div className="field__label">Right now, do you have…</div>
          <div className="chips">
            <Chip on={d.shortnessOfBreath} onClick={() => set('shortnessOfBreath', !d.shortnessOfBreath)} danger>
              Sudden shortness of breath
            </Chip>
            <Chip on={d.chestPain} onClick={() => set('chestPain', !d.chestPain)} danger>
              Chest pain
            </Chip>
          </div>
          {emergency && (
            <div className="banner banner--emergency">
              <strong>Call 911 now.</strong> These can be signs of a blood clot in the lungs. Submit this check-in so
              your nurse is alerted too, but do not wait for a reply.
            </div>
          )}
        </section>

        <Field label="How bad is it right now?">
          <div className="severity">
            <input
              type="range"
              min={0}
              max={10}
              value={d.severity}
              onChange={e => set('severity', Number(e.target.value))}
              aria-label="Pain severity"
            />
            <div className="severity__value">
              <span className="severity__num">{d.severity}</span>/10
              <span className="severity__word">{painWord(d.severity)}</span>
            </div>
          </div>
        </Field>

        <Field label="When did it start?">
          <ChipRow options={ONSET} value={d.onset} onPick={v => set('onset', v)} />
        </Field>
        <Field label="What makes it worse?">
          <div className="chips">
            {PROVOKE.map(o => (
              <Chip key={o} on={d.provocation.split(', ').includes(o)} onClick={() => toggleMulti('provocation', o)}>
                {o}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="What does it feel like?">
          <ChipRow options={QUALITY} value={d.quality} onPick={v => set('quality', v)} />
        </Field>
        <Field label="Does it spread?">
          <ChipRow options={RADIATE} value={d.radiation} onPick={v => set('radiation', v)} />
        </Field>
        <Field label="Is it constant?">
          <ChipRow options={TIMING} value={d.timing} onPick={v => set('timing', v)} />
        </Field>
        <Field label="Do you notice any of these here?">
          <div className="chips">
            <Chip on={d.swelling} onClick={() => set('swelling', !d.swelling)}>
              Swelling
            </Chip>
            <Chip on={d.warmth} onClick={() => set('warmth', !d.warmth)}>
              Warm to touch
            </Chip>
            <Chip on={d.redness} onClick={() => set('redness', !d.redness)}>
              Redness
            </Chip>
          </div>
        </Field>
        <div className="row">
          <Field label="Temperature (°F, optional)">
            <input
              className="input"
              inputMode="decimal"
              placeholder="e.g. 99.1"
              value={d.bodyTempF}
              onChange={e => set('bodyTempF', e.target.value)}
            />
          </Field>
          <Field label="Anything else? (optional)">
            <input className="input" value={d.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>

        <footer className="sheet__foot">
          <p className="muted">Your nurse sees this right away. This app does not replace calling your care team.</p>
          <button type="submit" className="btn btn--primary btn--lg">
            Send to my nurse
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}

function ChipRow({ options, value, onPick }: { options: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="chips">
      {options.map(o => (
        <Chip key={o} on={value === o} onClick={() => onPick(value === o ? '' : o)}>
          {o}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  on,
  onClick,
  danger,
  children,
}: {
  on: boolean;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip ${on ? 'chip--on' : ''} ${danger ? 'chip--danger' : ''}`}
      onClick={onClick}
      aria-pressed={on}
    >
      {children}
    </button>
  );
}
