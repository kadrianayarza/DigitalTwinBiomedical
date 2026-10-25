import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DayValue } from './model';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis bounds to readable ticks. */
function niceScale(lo: number, hi: number, zero: boolean) {
  if (zero) lo = Math.min(0, lo);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) ?? raw;
  const min = zero ? lo : Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min, max, ticks };
}

export type ChartKind = 'bars' | 'dots' | 'range' | 'line';

export type StackPart = { key: string; color: string; values: Array<number | null> };

type Props = {
  series: DayValue[];
  kind: ChartKind;
  /** Converts a stored value to the shown unit for the axis. */
  shown?: (v: number) => number;
  tickText?: (v: number) => string;
  xLabel: (d: DayValue, i: number) => string | null;
  color: string;
  goal?: number;
  /** Stacked parts drawn instead of `series` values (sleep stages). */
  stack?: StackPart[];
  fixed?: [number, number];
  selected: number | null;
  onSelect: (i: number | null) => void;
  height?: number;
};

const PAD = { top: 10, right: 40, bottom: 22, left: 4 };

export function MetricChart({ series, kind, shown = v => v, tickText, xLabel, color, goal, stack, fixed, selected, onSelect, height = 220 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const values = series.flatMap(d => {
    if (stack) return [stack.reduce((s, p) => s + (p.values[series.indexOf(d)] ?? 0), 0)];
    if (d.value === null) return [];
    return [shown(d.lo ?? d.value), shown(d.hi ?? d.value)];
  });
  if (goal !== undefined) values.push(shown(goal));
  const zero = kind === 'bars' || !!stack;
  const scale = fixed
    ? niceScale(fixed[0], fixed[1], false)
    : niceScale(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 1, zero);
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const n = series.length;
  const slot = n ? innerW / n : 0;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + innerH - ((v - scale.min) / (scale.max - scale.min || 1)) * innerH;
  const barW = Math.max(2, Math.min(28, slot * 0.62));

  const marks: ReactNode[] = [];
  series.forEach((d, i) => {
    const dim = selected !== null && selected !== i ? 0.35 : 1;
    if (stack) {
      let base = 0;
      for (const part of stack) {
        const v = part.values[i];
        if (!v) continue;
        const top = y(base + v);
        marks.push(<rect key={`${part.key}${i}`} x={x(i) - barW / 2} y={top} width={barW} height={Math.max(0, y(base) - top)} fill={part.color} opacity={dim} />);
        base += v;
      }
      return;
    }
    if (d.value === null) return;
    if (kind === 'bars') {
      const top = y(shown(d.value));
      marks.push(<rect key={i} x={x(i) - barW / 2} y={top} width={barW} height={Math.max(1, y(scale.min < 0 ? 0 : scale.min) - top)} rx={Math.min(3, barW / 3)} fill={color} opacity={dim} />);
    } else if (kind === 'range' && d.lo !== undefined && d.hi !== undefined) {
      const w = Math.min(10, Math.max(4, slot * 0.4));
      const top = y(shown(d.hi));
      marks.push(<rect key={i} x={x(i) - w / 2} y={top} width={w} height={Math.max(w, y(shown(d.lo)) - top)} rx={w / 2} fill={color} opacity={dim} />);
    } else {
      marks.push(<circle key={i} cx={x(i)} cy={y(shown(d.value))} r={selected === i ? 5 : 3.5} fill={color} opacity={dim} />);
    }
  });

  const linePts = kind === 'line' || kind === 'dots'
    ? series.map((d, i) => (d.value === null ? null : `${x(i)},${y(shown(d.value))}`)).filter(Boolean).join(' ')
    : '';

  const pick = (clientX: number, el: SVGSVGElement) => {
    const left = el.getBoundingClientRect().left;
    const i = Math.floor((clientX - left - PAD.left) / (slot || 1));
    onSelect(i >= 0 && i < n && (series[i]!.value !== null || stack) ? i : null);
  };

  return (
    <div className="hchart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={e => pick(e.clientX, e.currentTarget)}
          onPointerDown={e => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => onSelect(null)}
          role="img"
        >
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="hchart__grid" />
              <text x={width - PAD.right + 6} y={y(t) + 4} className="hchart__tick">
                {tickText ? tickText(t) : t.toLocaleString()}
              </text>
            </g>
          ))}
          {goal !== undefined && (
            <line x1={PAD.left} x2={width - PAD.right} y1={y(shown(goal))} y2={y(shown(goal))} className="hchart__goal" />
          )}
          {selected !== null && (
            <line x1={x(selected)} x2={x(selected)} y1={PAD.top} y2={PAD.top + innerH} className="hchart__cursor" />
          )}
          {linePts && kind === 'line' && <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
          {linePts && kind === 'dots' && <polyline points={linePts} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />}
          {marks}
          {series.map((d, i) => {
            const label = xLabel(d, i);
            return label ? (
              <text key={i} x={x(i)} y={height - 6} className="hchart__x" textAnchor="middle">
                {label}
              </text>
            ) : null;
          })}
        </svg>
      )}
    </div>
  );
}

/** Small trend line for cards. */
export function Trend({ values, color, kind = 'line', w = 120 }: { values: Array<number | null>; color: string; kind?: 'line' | 'bars'; w?: number }) {
  const h = 34;
  const vs = values.filter((v): v is number => v !== null);
  if (vs.length < 2) return <svg className="htrend" viewBox={`0 0 ${w} ${h}`} aria-hidden />;
  const lo = kind === 'bars' ? 0 : Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const step = w / values.length;
  const y = (v: number) => h - 2 - ((v - lo) / span) * (h - 4);
  if (kind === 'bars') {
    return (
      <svg className="htrend" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {values.map((v, i) =>
          v === null ? null : <rect key={i} x={i * step + step * 0.2} y={y(v)} width={step * 0.6} height={h - y(v)} rx={1} fill={color} opacity={i === values.length - 1 ? 1 : 0.55} />
        )}
      </svg>
    );
  }
  const pts = values.map((v, i) => (v === null ? null : `${i * step + step / 2},${y(v)}`)).filter(Boolean) as string[];
  const last = pts[pts.length - 1]!.split(',');
  return (
    <svg className="htrend" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={color} />
    </svg>
  );
}

export const RING_COLORS = ['var(--ring-move)', 'var(--ring-exercise)', 'var(--ring-stand)'];

/** Move / Exercise / Stand rings; each fraction can pass 1 and wraps around. */
export function Rings({ fractions, size = 132 }: { fractions: [number, number, number]; size?: number }) {
  const stroke = size * 0.11;
  const gap = stroke * 0.18;
  return (
    <svg className="rings" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Activity rings">
      {fractions.map((f, i) => {
        const r = size / 2 - stroke / 2 - i * (stroke + gap);
        const c = 2 * Math.PI * r;
        const shown = Math.min(f, 1.999);
        return (
          <g key={i} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_COLORS[i]} strokeWidth={stroke} opacity={0.18} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={RING_COLORS[i]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0.001, Math.min(shown, 1)) * c} ${c}`}
            />
            {shown > 1 && (
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_COLORS[i]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(shown - 1) * c} ${c}`} className="rings__over" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
