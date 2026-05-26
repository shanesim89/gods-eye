"use client";

type Node = { label: string; value: string; color: string; align: "left" | "right" };

export function FlowParticles({
  incomes,
  outflows,
  centerLabel,
  centerValue,
}: {
  incomes: Node[];
  outflows: Node[];
  centerLabel: string;
  centerValue: string;
}) {
  // SVG canvas 800x320
  const cx = 400;
  const cy = 160;

  return (
    <div className="relative bg-bg border border-border" style={{ minHeight: 280 }}>
      <svg viewBox="0 0 800 320" preserveAspectRatio="xMidYMid meet" className="w-full h-auto">
        <defs>
          <linearGradient id="fpInc" x1="0" x2="1">
            <stop offset="0" stopColor="#00ff7f" stopOpacity="0.4" />
            <stop offset="1" stopColor="#ffb000" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="fpOut" x1="0" x2="1">
            <stop offset="0" stopColor="#ffb000" stopOpacity="0.4" />
            <stop offset="1" stopColor="#ff3b3b" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Incoming paths */}
        {incomes.map((_, i) => {
          const y = 60 + i * (200 / Math.max(1, incomes.length));
          return (
            <g key={`in-${i}`}>
              <path
                d={`M40,${y} C200,${y} 280,${cy} 360,${cy}`}
                stroke="url(#fpInc)"
                strokeWidth={Math.max(2, 6 - i)}
                fill="none"
              />
              <circle r="3" fill="#00ff7f">
                <animateMotion
                  dur={`${3 + i * 0.5}s`}
                  repeatCount="indefinite"
                  begin={`${i * 0.3}s`}
                  path={`M40,${y} C200,${y} 280,${cy} 360,${cy}`}
                />
              </circle>
            </g>
          );
        })}

        {/* Outgoing paths */}
        {outflows.map((_, i) => {
          const y = 60 + i * (200 / Math.max(1, outflows.length));
          return (
            <g key={`out-${i}`}>
              <path
                d={`M440,${cy} C520,${cy} 600,${y} 760,${y}`}
                stroke="url(#fpOut)"
                strokeWidth={Math.max(2, 6 - i)}
                fill="none"
              />
              <circle r="3" fill="#ffb000">
                <animateMotion
                  dur={`${3 + i * 0.4}s`}
                  repeatCount="indefinite"
                  begin={`${i * 0.4 + 1}s`}
                  path={`M440,${cy} C520,${cy} 600,${y} 760,${y}`}
                />
              </circle>
            </g>
          );
        })}

        {/* Center hub */}
        <rect x={cx - 40} y={cy - 22} width="80" height="44" fill="#0a0a0a" stroke="#ffb000" />
      </svg>

      {/* HTML overlays for nodes (positioned absolutely over SVG using viewBox-relative %) */}
      {incomes.map((n, i) => {
        const top = (60 + i * (200 / Math.max(1, incomes.length))) / 320 * 100;
        return (
          <div
            key={`inl-${i}`}
            className="absolute bg-panel border px-2 py-1 text-[10px]"
            style={{
              left: "0%",
              top: `${top}%`,
              transform: "translateY(-50%)",
              borderColor: n.color,
            }}
          >
            <div className="text-muted uppercase tracking-[1px]" style={{ fontSize: 8 }}>{n.label}</div>
            <div className="font-bold tabular-nums" style={{ color: n.color }}>{n.value}</div>
          </div>
        );
      })}
      {outflows.map((n, i) => {
        const top = (60 + i * (200 / Math.max(1, outflows.length))) / 320 * 100;
        return (
          <div
            key={`outl-${i}`}
            className="absolute bg-panel border px-2 py-1 text-[10px]"
            style={{
              right: "0%",
              top: `${top}%`,
              transform: "translateY(-50%)",
              borderColor: n.color,
              textAlign: "right",
            }}
          >
            <div className="text-muted uppercase tracking-[1px]" style={{ fontSize: 8 }}>{n.label}</div>
            <div className="font-bold tabular-nums" style={{ color: n.color }}>{n.value}</div>
          </div>
        );
      })}
      <div
        className="absolute bg-panel border border-amber px-3 py-2 text-center"
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="text-[8px] text-muted uppercase tracking-[1.5px]">{centerLabel}</div>
        <div className="text-amber font-bold tabular-nums text-base">{centerValue}</div>
      </div>
    </div>
  );
}
