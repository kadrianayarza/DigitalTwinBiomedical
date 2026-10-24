type Props = {
  values: number[];
  min?: number;
  max?: number;
  color?: string;
  baseline?: number;
  height?: number;
};

export function Sparkline({ values, min, max, color = '#3e63dd', baseline, height = 44 }: Props) {
  const w = 200;
  const h = height;
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} />;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {baseline !== undefined && (
        <line x1={0} x2={w} y1={y(baseline)} y2={y(baseline)} stroke="#9aa4ae" strokeDasharray="3 3" strokeWidth={1} />
      )}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
