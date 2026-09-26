// Semi-circle risk dial — 4 solid-colored arc bands (no SVG gradient) + a
// needle line, value/level rendered as HTML (no SVG <text>).
function polarToXY(cx: number, cy: number, r: number, angleDeg: number): readonly [number, number] {
  const a = (Math.PI / 180) * angleDeg;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polarToXY(cx, cy, r, startDeg);
  const [x2, y2] = polarToXY(cx, cy, r, endDeg);
  const largeArc = startDeg - endDeg > 180 ? 1 : 0;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${largeArc} 0 ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

const LEVEL_BANDS = [
  { level: "low", from: 180, to: 135, color: "#1f8a4c" },
  { level: "neutral", from: 135, to: 90, color: "#159a94" },
  { level: "elevated", from: 90, to: 45, color: "#d9a441" },
  { level: "high", from: 45, to: 0, color: "#c0392b" },
];

export function VixGauge({
  value,
  level,
  size = 220,
}: {
  value: number;
  level: "low" | "neutral" | "elevated" | "high";
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
  const pct = Math.min(1, Math.max(0, value / 40));
  const needleDeg = 180 - pct * 180;
  const needleR = r - 18;
  const [needleX, needleY] = polarToXY(cx, cy, needleR, needleDeg);

  return (
    <div style={{ position: "relative", width: size, height: size / 2 + 30 }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`} style={{ display: "block" }}>
        {LEVEL_BANDS.map((b) => (
          <path key={b.level} d={arcPath(cx, cy, r, b.from, b.to)} fill="none" stroke={b.color} strokeWidth={14} strokeLinecap="butt" />
        ))}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="#0e2740" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={5} fill="#0e2740" />
      </svg>
      <div style={{ position: "absolute", left: "50%", top: size / 2 - 6, transform: "translateX(-50%)", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-report-display), serif", fontWeight: 700, fontSize: 26, color: "#0e2740" }}>{value.toFixed(1)}</div>
        <div style={{ fontFamily: "var(--font-jetbrains-mono), monospace", fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: "#7c8b98" }}>
          VIX · {level}
        </div>
      </div>
    </div>
  );
}
