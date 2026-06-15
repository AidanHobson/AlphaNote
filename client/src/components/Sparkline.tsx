// Tiny inline SVG sparkline — no chart library. Renders a series as a single
// polyline scaled to the box, with the last point marked.
export default function Sparkline({ data, width = 64, height = 20 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const pts = data.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const rising = data[data.length - 1] >= data[0];
  const stroke = rising ? 'var(--color-up)' : 'var(--color-down)';
  const last = data.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(last * stepX).toFixed(1)} cy={y(data[last]).toFixed(1)} r="1.8" fill={stroke} />
    </svg>
  );
}
