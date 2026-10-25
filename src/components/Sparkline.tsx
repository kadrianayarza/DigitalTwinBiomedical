type Props = {
  values: number[];
  min?: number;
  max?: number;
  color?: string;
  baseline?: number;
  height?: number;
};

const W = 200;

export function Sparkline({ values, min, max, color = '#3ad7ff', baseline, height = 40 }: Props) {
  const h = height;
  const grid = [0.25, 0.5, 0.75].map(f => (
    <line key={f} x1={0} x2={W} y1={h * f} y2={h * f} className="spark__grid" vectorEffect="non-scaling-stroke" />
  ));
  if (values.length < 2) {
    return (
      <svg className="spark" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden>
        {grid}
      </svg>
    );
  }
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const y = (v: number) => h - 3 - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (h - 6);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${y(v)}`).join(' ');
  const last = values[values.length - 1]!;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden>
      {grid}
      {baseline !== undefined && (
        <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} className="spark__base" vectorEffect="non-scaling-stroke" />
      )}
      <polyline points={`0,${h} ${pts} ${W},${h}`} style={{ fill: color }} opacity={0.08} stroke="none" />
      <polyline points={pts} fill="none" style={{ stroke: color }} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={W} cy={y(last)} r={2.5} style={{ fill: color }} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
