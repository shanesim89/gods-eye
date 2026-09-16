"use client";

import { useRef, useState } from "react";

export type TokenRow = {
  token: string;
  price: number | null;
  changePct: number | null;
  high7d: number | null;
  dropPct: number | null;
  armed: boolean;
  qty: number;
  costBasis: number | null;
  fillCount: number;
  lastOrder: { date: Date; amount: number; status: string; price: number | null } | null;
  spark: number[];
};

function usd(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function Sparkline({ data }: { data: number[] }) {
  const W = 200;
  const H = 44;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; cx: number; cy: number } | null>(null);

  if (!data || data.length < 2) {
    return (
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(70,224,245,.15)" strokeWidth="1" strokeDasharray="3 4" />
        <text x={W / 2} y={H / 2 + 3} textAnchor="middle" fill="#365360" fontSize="8" fontFamily="monospace">NO DATA</text>
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const n = data.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const up = data[n - 1] >= data[0];
  const color = up ? "#27f59b" : "#ff5470";
  const lastX = x(n - 1);
  const lastY = y(data[n - 1]);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(n - 1, Math.round((svgX / W) * (n - 1))));
    setHover({ idx, cx: x(idx), cy: y(data[idx]) });
  }

  const TT_W = 58;
  const TT_H = 22;
  const tipX = hover ? (hover.cx < W / 2 ? hover.cx + 4 : hover.cx - TT_W - 4) : 0;
  const dayLabel = hover ? (hover.idx === n - 1 ? "TODAY" : `-${n - 1 - hover.idx}D`) : "";

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <path d={area} fill={`${color}14`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 3px ${color}66)` }} />
      {hover ? (
        <>
          <line x1={hover.cx} y1={0} x2={hover.cx} y2={H} stroke={color} strokeWidth="0.5" opacity="0.4" vectorEffect="non-scaling-stroke" />
          <circle cx={hover.cx} cy={hover.cy} r="2.5" fill={color} vectorEffect="non-scaling-stroke" />
          <rect x={tipX} y={4} width={TT_W} height={TT_H} rx="1.5"
            fill="rgba(8,18,28,.92)" stroke="rgba(64,200,224,.4)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          <text x={tipX + TT_W / 2} y={13} textAnchor="middle" fill="#bfe9f2" fontSize="7.5" fontFamily="monospace" vectorEffect="non-scaling-stroke">
            {usd(data[hover.idx])}
          </text>
          <text x={tipX + TT_W / 2} y={22} textAnchor="middle" fill="#5b7d8a" fontSize="6.5" fontFamily="monospace" vectorEffect="non-scaling-stroke">
            {dayLabel}
          </text>
        </>
      ) : (
        <circle cx={lastX} cy={lastY} r="2" fill={color} />
      )}
    </svg>
  );
}

export function HudCard({ row }: { row: TokenRow }) {
  const { token, price, changePct, high7d, dropPct, armed, qty, costBasis, fillCount, lastOrder, spark } = row;

  const currentValue = qty > 0 && price ? qty * price : null;
  const pnl = currentValue != null && costBasis != null ? currentValue - costBasis : null;
  const pnlPct = pnl != null && costBasis && costBasis > 0 ? (pnl / costBasis) * 100 : null;
  const statusColor = armed ? "#27f59b" : "#5b7d8a";

  const cellStyle: React.CSSProperties = {
    border: "1px solid rgba(64,200,224,.12)", padding: "6px 8px",
    background: "rgba(70,224,245,.02)",
    clipPath: "polygon(0 0,calc(100% - 5px) 0,100% 5px,100% 100%,5px 100%,0 calc(100% - 5px))",
  };

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(8,18,28,.6)",
        border: "1px solid rgba(64,200,224,.22)",
        clipPath:
          "polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))",
        backdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* corner brackets */}
      {[
        { top: 5, left: 5, borderTop: "2px solid", borderLeft: "2px solid" },
        { top: 5, right: 5, borderTop: "2px solid", borderRight: "2px solid" },
        { bottom: 5, left: 5, borderBottom: "2px solid", borderLeft: "2px solid" },
        { bottom: 5, right: 5, borderBottom: "2px solid", borderRight: "2px solid" },
      ].map((s, i) => (
        <div key={i} style={{ position: "absolute", width: 16, height: 16, pointerEvents: "none", borderColor: "rgba(70,224,245,.5)", ...s }} />
      ))}

      {/* ── HEADER ── */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(64,200,224,.15)", background: "linear-gradient(120deg,rgba(255,207,74,.05),transparent)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#ffcf4a", textShadow: "0 0 12px rgba(255,207,74,.5)" }}>
            {token}
          </div>
          <span style={{ fontSize: 8, fontWeight: 700, color: statusColor, textShadow: `0 0 8px ${statusColor}80`, letterSpacing: 1, textTransform: "uppercase" }}>
            {armed ? "▶ ARMED" : "WATCHING"}
          </span>
        </div>
        <div style={{ fontSize: 14, marginTop: 2, letterSpacing: .5, fontVariantNumeric: "tabular-nums" }}>
          {usd(price)}{" "}
          {changePct != null && (
            <span style={{ fontSize: 10, color: changePct >= 0 ? "#27f59b" : "#ff5470" }}>
              {changePct >= 0 ? "▴" : "▾"} {Math.abs(changePct).toFixed(2)}%
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, marginTop: 6, color: "#5b7d8a", fontVariantNumeric: "tabular-nums" }}>
          7D HIGH {usd(high7d)} · DROP {dropPct != null ? `${dropPct.toFixed(1)}%` : "—"}
        </div>
      </div>

      {/* ── 30D SPARKLINE ── */}
      <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
        <div style={{ fontSize: 7, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
          <span>30D PRICE</span>
          <span style={{ color: "#365360" }}>DAILY · USD</span>
        </div>
        <Sparkline data={spark} />
      </div>

      {/* ── POSITION ── */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(64,200,224,.15)" }}>
        <div style={{ fontSize: 7, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 6 }}>UNREALIZED P&amp;L</div>
        {pnl != null ? (
          <div style={{ fontSize: 18, fontWeight: 700, color: pnl >= 0 ? "#27f59b" : "#ff5470", fontVariantNumeric: "tabular-nums" }}>
            {pnl >= 0 ? "+" : ""}{usd(pnl)}
            <span style={{ fontSize: 10, marginLeft: 6 }}>
              {pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : ""}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 700, color: "#365360" }}>NO POSITION</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
          {[
            { l: "HOLDING", v: qty > 0 ? `${qty.toFixed(4)}` : "—" },
            { l: "MARK VALUE", v: usd(currentValue) },
            { l: "COST BASIS", v: usd(costBasis) },
            { l: "FILLS", v: String(fillCount) },
          ].map(({ l, v }) => (
            <div key={l} style={cellStyle}>
              <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#bfe9f2", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ padding: "10px 14px", marginTop: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "4px 0" }}>
          <span style={{ color: "#5b7d8a", letterSpacing: .5 }}>TRIGGER</span>
          <span style={{ color: statusColor, fontVariantNumeric: "tabular-nums" }}>
            {armed ? "$50 BUY ARMED" : "8% DROP NEEDED"}
          </span>
        </div>
        {lastOrder && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, padding: "4px 0", borderTop: "1px solid rgba(64,200,224,.07)", color: "#365360" }}>
            <span>LAST {fmtDate(lastOrder.date)}</span>
            <span style={{ color: lastOrder.status === "filled" ? "#27f59b" : lastOrder.status === "failed" ? "#ff5470" : "#5b7d8a", textTransform: "uppercase" }}>
              {lastOrder.status}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
