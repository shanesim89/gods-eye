// Small point-to-point line chart across tenors — same hand-SVG construction
// as Sparkline.tsx. Labels are HTML spans over the SVG (no SVG <text>).
export function YieldCurve({
  points,
  width = 686,
  height = 110,
}: {
  points: { tenor: string; yieldPct: number }[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.yieldPct);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const padY = 26;
  const chartH = height - padY * 2;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = padY + chartH - ((p.yieldPct - min) / range) * chartH;
    return { x, y, p };
  });
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
        <path d={linePath} fill="none" stroke="#159a94" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c) => (
          <circle key={c.p.tenor} cx={c.x} cy={c.y} r={4} fill="#0e2740" />
        ))}
      </svg>
      {coords.map((c) => (
        <div
          key={c.p.tenor}
          style={{
            position: "absolute",
            left: c.x,
            top: c.y - 20,
            transform: "translateX(-50%)",
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 9.5,
            fontWeight: 700,
            color: "#0e2740",
            whiteSpace: "nowrap",
          }}
        >
          {c.p.yieldPct.toFixed(2)}%
        </div>
      ))}
      {coords.map((c) => (
        <div
          key={`${c.p.tenor}-label`}
          style={{
            position: "absolute",
            left: c.x,
            top: height - 14,
            transform: "translateX(-50%)",
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 9,
            color: "#7c8b98",
            whiteSpace: "nowrap",
          }}
        >
          {c.p.tenor}
        </div>
      ))}
    </div>
  );
}
