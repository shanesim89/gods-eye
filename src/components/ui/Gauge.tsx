type GaugeProps = {
  value: number; // 0..1 progress fraction
  label: string;
  display: string; // text inside ring
  color?: string;
  size?: number;
};

export function Gauge({ value, label, display, color = "#ffb000", size = 88 }: GaugeProps) {
  const radius = size / 2 - 6;
  const circ = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  const dash = circ * clamped;
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a1a1a" strokeWidth={6} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 600ms ease-out" }}
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center font-bold tabular-nums"
          style={{ color, fontSize: 14 }}
        >
          {display}
        </div>
      </div>
      <div className="text-[9px] text-muted tracking-[1px] uppercase mt-1.5">{label}</div>
    </div>
  );
}
