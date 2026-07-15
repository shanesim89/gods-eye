// Simple donut/ring chart for allocation breakdowns — SVG stroke-dasharray
// segments, no library.
export type DonutSegment = { label: string; value: number; color: string };

export function Donut({ segments, size = 84, strokeWidth = 12 }: { segments: DonutSegment[]; size?: number; strokeWidth?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  // Precompute each segment's dash length + cumulative offset via reduce —
  // no mutation of an outer variable inside the render-time map below.
  const arcs = segments.reduce<Array<DonutSegment & { dash: number; offset: number }>>((acc, seg) => {
    const dash = (seg.value / total) * c;
    const prevEnd = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    return [...acc, { ...seg, dash, offset: prevEnd }];
  }, []);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e4e9ed" strokeWidth={strokeWidth} />
        {arcs.map((seg, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${seg.dash} ${c - seg.dash}`}
            strokeDashoffset={-seg.offset}
          />
        ))}
      </g>
    </svg>
  );
}
