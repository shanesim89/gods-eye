"use client";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { IndexScore } from "@/lib/global-indices";
import { indexBandExplanation } from "@/lib/council/display";
import { WORLD_DOTS } from "./world-dots";

const W = 900, H = 440;
// vertical crop — trim dead ocean/poles, no distortion
const TOP_LAT = 80, BOT_LAT = -56;
const Y_TOP = ((90 - TOP_LAT) / 180) * H;
const Y_BOT = ((90 - BOT_LAT) / 180) * H;
const CROP_H = Y_BOT - Y_TOP;

function proj(lat: number, lon: number): [number, number] {
  return [(lon + 180) / 360 * W, (90 - lat) / 180 * H];
}
const cl = (v: number) => Math.max(0, Math.min(1, v));

// ── Instrument-grade color scale ─────────────────────────────────────────
const STOPS: [number, [number, number, number]][] = [
  [0,   [108, 26, 26]],
  [25,  [198, 64, 52]],
  [44,  [201, 130, 44]],
  [56,  [70, 150, 178]],
  [76,  [46, 178, 122]],
  [100, [70, 224, 150]],
];
function scoreRGB(s: number): [number, number, number] {
  const x = Math.max(0, Math.min(100, s));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const t = (x - a) / (b - a);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * t),
        Math.round(ca[1] + (cb[1] - ca[1]) * t),
        Math.round(ca[2] + (cb[2] - ca[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lighten = (c: [number, number, number], n: number): [number, number, number] =>
  [Math.min(255, c[0] + n), Math.min(255, c[1] + n), Math.min(255, c[2] + n)];
const glowPx = (s: number) => 5 + (Math.abs(s - 50) / 50) * 12;

function verdict(s: number): string {
  if (s >= 62) return "OVERWEIGHT";
  if (s >= 55) return "CONSTRUCTIVE";
  if (s >= 45) return "NEUTRAL";
  if (s >= 38) return "UNDERWEIGHT";
  return "REDUCE";
}

// ── Fund-manager narrative from extended metrics ──────────────────────────
type Reasons = { trend: string; mom: string; meanRev: string; risk: string; thesis: string };
function factorReasons(d: IndexScore): Reasons | null {
  const m = d.metrics, sub = d.sub;
  if (!m || !sub) return null;

  const trend = m.pctVsSMA200 == null
    ? "200D MA unavailable"
    : `${m.pctVsSMA200 >= 0 ? "+" : ""}${m.pctVsSMA200.toFixed(1)}% vs 200D MA (${m.maSignal === "golden" ? "✦ golden cross" : m.maSignal === "death" ? "✖ death cross" : "neutral"})`;

  const mom = `+${m.ret63 >= 0 ? "" : ""}${m.ret63.toFixed(1)}% 3M · ${m.ret21.toFixed(1)}% 1M · ${m.ret252.toFixed(1)}% 1Y`;

  const rsiTag = m.rsi < 35 ? "oversold" : m.rsi > 65 ? "stretched" : "neutral";
  const ddStr = m.drawdownFromHigh != null ? ` · DD ${m.drawdownFromHigh.toFixed(1)}% from high` : "";
  const meanRev = `RSI ${m.rsi.toFixed(0)} (${rsiTag})${ddStr}`;

  const volTag = m.vol < 15 ? "low" : m.vol > 30 ? "high" : "elevated";
  const sharpeStr = m.sharpe3M != null ? ` · Sharpe ${m.sharpe3M.toFixed(1)} (3M)` : "";
  const risk = `${m.vol.toFixed(0)}% ann vol (${volTag})${sharpeStr}`;

  // Thesis: momentum + trend anchor + risk colour
  const momWord = m.ret63 > 8 ? "Strong momentum" : m.ret63 > 2 ? "Positive momentum" : m.ret63 < -8 ? "Declining" : "Flat";
  const trendWord = m.pctVsSMA200 == null ? "" : m.pctVsSMA200 > 5 ? ", above trend" : m.pctVsSMA200 < -5 ? ", below trend" : ", near trend";
  const maWord = m.maSignal === "golden" ? ", golden cross" : m.maSignal === "death" ? ", death cross" : "";
  const riskWord = m.vol < 15 ? ". Low vol environment." : m.vol > 30 ? ". High vol — size carefully." : ". Moderate vol.";
  const ddWord = m.drawdownFromHigh != null && m.drawdownFromHigh < -15 ? ` DD ${m.drawdownFromHigh.toFixed(0)}% from high.` : "";
  const thesis = `${momWord}${trendWord}${maWord}${riskWord}${ddWord}`;

  return { trend, mom, meanRev, risk, thesis };
}

// format pct with sign + fixed
function fmt(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

// ── Graticule ─────────────────────────────────────────────────────────────
const LAT_LINES: number[] = [];
for (let lat = -60; lat <= 60; lat += 30) LAT_LINES.push(lat);
const LON_LINES: number[] = [];
for (let lon = -150; lon <= 150; lon += 30) LON_LINES.push(lon);
const [, EQ_Y] = proj(0, 0);

type TooltipState = { px: number; py: number; d: IndexScore };

// ── Canvas dot-matrix renderer (with boot reveal sweep) ───────────────────
function DotCanvas({ boot }: { boot: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const parent = cv.parentElement!;
    const ro = new ResizeObserver(() => setSize(parent.clientWidth));
    ro.observe(parent);
    setSize(parent.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !size) return;
    const cssW = size;
    const k = cssW / W;
    const cssH = CROP_H * k;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.globalCompositeOperation = "lighter";

    const reveal = boot >= 1 ? 1 : cl((boot - 0.15) / 0.5);

    const cx = 0.52, cy = 0.46;
    for (let i = 0; i < WORLD_DOTS.length; i++) {
      const [nx, ny] = WORLD_DOTS[i];
      if (reveal < 1 && nx > reveal) continue;
      const x = nx * cssW;
      const y = (ny * H - Y_TOP) * k;
      if (y < -3 || y > cssH + 3) continue;
      const dist = Math.hypot(nx - cx, ny - cy);
      const j = ((i * 2654435761) % 1000) / 1000;
      let b = Math.max(0.18, 0.72 - dist * 0.55) * (0.7 + j * 0.5);
      if (reveal < 1 && nx > reveal - 0.05) b = Math.min(1, b + 0.5);
      const hub = j > 0.93;
      const r = hub ? 1.7 : 1.05;
      ctx.beginPath();
      ctx.fillStyle = `rgba(70,200,235,${b * 0.10})`;
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = hub ? `rgba(150,235,255,${Math.min(1, b * 1.3)})` : `rgba(64,196,230,${b})`;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (reveal < 1) {
      const sx = reveal * cssW;
      const grad = ctx.createLinearGradient(sx - 30, 0, sx + 4, 0);
      grad.addColorStop(0, "rgba(120,230,255,0)");
      grad.addColorStop(1, "rgba(150,240,255,.5)");
      ctx.fillStyle = grad;
      ctx.fillRect(sx - 30, 0, 34, cssH);
    }
  }, [boot, size]);

  return <canvas ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}

export function GlobalHologramMap({ data }: { data: IndexScore[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [pinnedExplain, setPinnedExplain] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Pinned card opens clean each time a new index is pinned.
  useEffect(() => {
    setPinnedExplain(false);
  }, [pinnedKey]);
  const [boot, setBoot] = useState<number>(0);

  // boot timeline — once per session
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("ghm-booted") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBoot(1);
      sessionStorage.setItem("ghm-booted", "1");
      return;
    }
    const DUR = 2000, t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      setBoot(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else sessionStorage.setItem("ghm-booted", "1");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // restore collapse pref
  useEffect(() => {
    if (localStorage.getItem("ghm-collapsed") === "1") setCollapsed(true);
  }, []);
  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const n = !c;
      localStorage.setItem("ghm-collapsed", n ? "1" : "0");
      return n;
    });
  }, []);

  const onMove = useCallback((e: React.MouseEvent, d: IndexScore) => {
    if (!wrapRef.current || pinnedKey) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setTooltip({ px: e.clientX - rect.left, py: e.clientY - rect.top, d });
    setHoverKey(d.key);
  }, [pinnedKey]);
  const onLeave = useCallback(() => { setTooltip(null); setHoverKey(null); }, []);

  const scored = data.filter((d) => d.score != null);
  const avg = scored.length ? Math.round(scored.reduce((s, d) => s + (d.score ?? 0), 0) / scored.length) : null;

  // MSCI World ret63 for relative comparison
  const worldRet63 = useMemo(() => {
    const w = data.find((d) => d.key === "WORLD");
    return w?.metrics?.ret63 ?? null;
  }, [data]);

  // left→right boot order for node stagger-pop
  const orderMap = useMemo(() => {
    const withX = data.map((d) => ({ k: d.key, x: proj(d.lat, d.lon)[0] + (d.dx ?? 0) }));
    withX.sort((a, b) => a.x - b.x);
    const m: Record<string, number> = {};
    withX.forEach((o, i) => (m[o.k] = i));
    return m;
  }, [data]);

  const gratOpacity = cl((boot - 0.05) / 0.35);
  const readP = cl((boot - 0.65) / 0.35);
  const avgShown = avg == null ? null : Math.round(avg * readP);
  const nodesShown = Math.round(scored.length * readP);

  const pinned = pinnedKey ? data.find((d) => d.key === pinnedKey) ?? null : null;

  return (
    <div style={{ position: "relative", marginBottom: 16, fontFamily: '"JetBrains Mono",ui-monospace,Consolas,monospace' }}>
      <style>{`
        @keyframes ghmSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
        @keyframes ghmBlip{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes ghmCardIn{0%{opacity:0;transform:translateX(8px) scale(.98)}100%{opacity:1;transform:none}}
        @keyframes ghmTipIn{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:none}}
        .ghm-blip{animation:ghmBlip 1.5s ease-in-out infinite}
        .ghm-card-in{animation:ghmCardIn .22s ease-out}
        .ghm-tip-in{animation:ghmTipIn .14s ease-out}
      `}</style>

      <div style={{
        position: "relative",
        background: "linear-gradient(160deg,rgba(6,14,24,.96),rgba(2,6,12,.98))",
        border: "1px solid rgba(64,200,224,.18)",
        boxShadow: "0 0 0 1px rgba(0,0,0,.4),0 18px 48px -18px rgba(0,30,50,.6),inset 0 0 60px rgba(0,40,70,.18)",
        clipPath: "polygon(0 18px,18px 0,calc(100% - 18px) 0,100% 18px,100% calc(100% - 18px),calc(100% - 18px) 100%,18px 100%,0 calc(100% - 18px))",
        opacity: cl(boot / 0.15),
        transform: `scale(${0.985 + 0.015 * cl(boot / 0.15)})`,
        transformOrigin: "center top",
      }}>
        {/* corner brackets */}
        {([
          { top: 7, left: 7, borderTop: "1.5px solid", borderLeft: "1.5px solid" },
          { top: 7, right: 7, borderTop: "1.5px solid", borderRight: "1.5px solid" },
          { bottom: 7, left: 7, borderBottom: "1.5px solid", borderLeft: "1.5px solid" },
          { bottom: 7, right: 7, borderBottom: "1.5px solid", borderRight: "1.5px solid" },
        ] as React.CSSProperties[]).map((s, i) => (
          <div key={i} style={{ position: "absolute", width: 16, height: 16, pointerEvents: "none", borderColor: "rgba(70,224,245,.45)", ...s }} />
        ))}

        {/* ── HUD header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 20px 8px", borderBottom: "1px solid rgba(64,200,224,.10)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ghm-blip" style={{ width: 6, height: 6, borderRadius: "50%", background: "#46e0f5", boxShadow: "0 0 8px #46e0f5", display: "inline-block" }} />
            <span style={{ fontSize: 11, letterSpacing: 2.5, color: "#9fe4f2", fontWeight: 600 }}>GLOBAL INVESTMENT RADAR</span>
            {!collapsed && (
              <span style={{ fontSize: 8, letterSpacing: 1.5, color: "#3b5b67", borderLeft: "1px solid rgba(64,200,224,.2)", paddingLeft: 10 }}>COMPOSITE ATTRACTIVENESS · 0–100</span>
            )}
            {collapsed && avg != null && (
              <span style={{ fontSize: 8, letterSpacing: 1.5, color: "#3b5b67", borderLeft: "1px solid rgba(64,200,224,.2)", paddingLeft: 10 }}>
                GLOBAL AVG <span style={{ color: scoreColor(avg), fontWeight: 700 }}>{avg}</span> · {scored.length}/{data.length} LIVE
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 8, letterSpacing: 1.5, color: "#3b5b67" }}>
            {!collapsed && <>
              <span>NODES <span style={{ color: "#9fe4f2" }}>{nodesShown}/{data.length}</span></span>
              {avgShown != null && (
                <span>GLOBAL AVG <span style={{ color: scoreColor(avg ?? 50), fontWeight: 700, textShadow: `0 0 6px ${scoreColor(avg ?? 50)}` }}>{avgShown}</span></span>
              )}
              <span style={{ color: "#46e0f5" }}>● LIVE</span>
            </>}
            <button onClick={toggleCollapse} aria-label={collapsed ? "Expand map" : "Collapse map"} style={{
              background: "rgba(70,224,245,.06)", border: "1px solid rgba(64,200,224,.25)", color: "#9fe4f2",
              cursor: "pointer", width: 22, height: 18, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, lineHeight: 1, padding: 0,
            }}>{collapsed ? "▼" : "▲"}</button>
          </div>
        </div>

        {/* collapsible region */}
        <div style={{ maxHeight: collapsed ? 0 : 1200, overflow: "hidden", transition: "max-height .38s ease" }}>
          {/* factor weighting strip */}
          <div style={{ display: "flex", padding: "0 20px", borderBottom: "1px solid rgba(64,200,224,.07)" }}>
            {[["TREND", "30%"], ["MOMENTUM", "25%"], ["MEAN-REVERSION", "25%"], ["RISK", "20%"]].map(([l, w], i) => (
              <div key={l} style={{ flex: 1, padding: "5px 0", display: "flex", alignItems: "center", gap: 6, borderLeft: i ? "1px solid rgba(64,200,224,.06)" : "none", paddingLeft: i ? 12 : 0 }}>
                <span style={{ fontSize: 7.5, letterSpacing: 1.5, color: "#3b5b67" }}>{l}</span>
                <span style={{ fontSize: 8, color: "#6fa9b8", fontWeight: 700 }}>{w}</span>
              </div>
            ))}
          </div>

          {/* ── Map stage ── */}
          <div
            ref={wrapRef}
            onClick={() => setPinnedKey(null)}
            style={{ position: "relative", overflow: "hidden", background: "radial-gradient(120% 90% at 52% 42%,rgba(0,46,78,.40),rgba(1,4,9,0) 70%)" }}
          >
            <DotCanvas boot={boot} />

            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,rgba(0,10,16,.22) 3px)", mixBlendMode: "multiply" }} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: "inset 0 0 120px 24px rgba(1,5,10,.9)" }} />

            <svg
              viewBox={`0 ${Y_TOP} ${W} ${CROP_H}`}
              style={{ position: "relative", display: "block", width: "100%", height: "auto" }}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <filter id="ghm-node" x="-150%" y="-150%" width="400%" height="400%">
                  <feGaussianBlur stdDeviation="3.5" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* graticule */}
              <g style={{ opacity: gratOpacity }}>
                {LAT_LINES.map((lat) => {
                  const [, y] = proj(lat, 0);
                  return (
                    <g key={"la" + lat}>
                      <line x1={0} y1={y} x2={W} y2={y} stroke="rgba(70,224,245,.06)" strokeWidth="1" />
                      <text x={5} y={y - 3} fontSize="7" fill="rgba(70,224,245,.28)" fontFamily="monospace">{lat > 0 ? "+" : ""}{lat}°</text>
                    </g>
                  );
                })}
                {LON_LINES.map((lon) => {
                  const [x] = proj(0, lon);
                  return <line key={"lo" + lon} x1={x} y1={Y_TOP} x2={x} y2={Y_BOT} stroke={`rgba(70,224,245,${lon % 60 === 0 ? .055 : .025})`} strokeWidth="1" />;
                })}
                <line x1={0} y1={EQ_Y} x2={W} y2={EQ_Y} stroke="rgba(0,229,255,.20)" strokeWidth="1" strokeDasharray="1 6" />
              </g>

              {/* nodes */}
              {data.map((d) => {
                const [bx, by] = proj(d.lat, d.lon);
                const x = bx + (d.dx ?? 0);
                const y = by + (d.dy ?? 0);
                const active = hoverKey === d.key || pinnedKey === d.key;

                const order = orderMap[d.key] ?? 0;
                const start = 0.6 + (order / Math.max(1, data.length)) * 0.34;
                const np = boot >= 1 ? 1 : cl((boot - start) / 0.12);
                if (np <= 0) return null;

                if (d.score == null) {
                  return (
                    <g key={d.key} style={{ opacity: np * 0.5, transformOrigin: `${x}px ${y}px`, transform: `scale(${0.5 + 0.5 * np})` }}>
                      <circle cx={x} cy={y} r={4} fill="none" stroke="rgba(70,224,245,.25)" strokeWidth="1" />
                      <circle cx={x} cy={y} r={1.5} fill="rgba(70,224,245,.4)" />
                      <text x={x + 8} y={y + 3} fontSize="7.5" fill="#2f4a57" fontFamily="monospace">{d.key} · N/A</text>
                    </g>
                  );
                }

                const c = scoreRGB(d.score);
                const col = rgb(c);
                const gp = glowPx(d.score);
                const r = 3.6 + (Math.abs(d.score - 50) / 50) * 2.2;
                const ly = y - 22;

                return (
                  <g key={d.key}
                    style={{ cursor: "pointer", opacity: np, transformOrigin: `${x}px ${y}px`, transform: `scale(${0.5 + 0.5 * np})` }}
                    onMouseMove={(e) => onMove(e, d)}
                    onMouseLeave={onLeave}
                    onClick={(e) => { e.stopPropagation(); setPinnedKey((k) => (k === d.key ? null : d.key)); setTooltip(null); }}
                  >
                    <circle cx={x} cy={y} r={20} fill="transparent" />
                    <circle cx={x} cy={y} r={13} fill="none" stroke={col} strokeWidth="0.6" opacity={active ? 0.55 : 0.28} />
                    <g style={{ transformOrigin: `${x}px ${y}px`, animation: active ? "ghmSpin 7s linear infinite" : "none" }}>
                      <circle cx={x} cy={y} r={9} fill="none" stroke={col} strokeWidth="0.9" opacity={0.5} strokeDasharray="2.2 4" />
                    </g>
                    {[[0, -13.5, 0, -10.5], [0, 13.5, 0, 10.5], [-13.5, 0, -10.5, 0], [13.5, 0, 10.5, 0]].map((t, i) => (
                      <line key={i} x1={x + t[0]} y1={y + t[1]} x2={x + t[2]} y2={y + t[3]} stroke={col} strokeWidth="0.8" opacity={active ? 0.8 : 0.45} />
                    ))}
                    <circle cx={x} cy={y} r={r + 2.5} fill={rgb(c, 0.18)} style={{ filter: `drop-shadow(0 0 ${gp}px ${col})` }} />
                    <circle cx={x} cy={y} r={r} fill={col} stroke={rgb(lighten(c, 60))} strokeWidth="0.7" />

                    <line x1={x} y1={y - 13.5} x2={x} y2={ly + 9} stroke={col} strokeWidth="0.7" opacity={0.5} />
                    <g transform={`translate(${x},${ly})`}>
                      <rect x={-26} y={-9} width={52} height={17} fill="rgba(3,10,18,.9)" stroke={rgb(c, active ? 0.9 : 0.55)} strokeWidth="0.8"
                        style={{ filter: active ? `drop-shadow(0 0 5px ${col})` : "none" }} />
                      <text x={-19} y={3} fontSize="8" fill="#cfeef6" fontFamily="monospace" fontWeight={600} letterSpacing="0.4">{d.key}</text>
                      <text x={20} y={3} textAnchor="end" fontSize="9" fill={rgb(lighten(c, 50))} fontFamily="monospace" fontWeight={700}>{d.score}</text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* ── Hover tooltip — LLM prose (suppressed while pinned) ── */}
            {tooltip && !pinnedKey && tooltip.d.score != null && (() => {
              const { px, py, d } = tooltip;
              const s = d.score!;
              const c = scoreRGB(s);
              const col = rgb(c);
              const reasons = factorReasons(d);
              // LLM analysis if available, else deterministic thesis fallback
              const prose = d.analysis ?? reasons?.thesis ?? null;
              const ow = wrapRef.current?.offsetWidth ?? 800;
              const TW = 240;
              const left = px + 18 + TW > ow ? px - TW - 6 : px + 18;
              const top = Math.max(8, py - 20);
              return (
                <div className="ghm-tip-in" style={{
                  position: "absolute", left, top, zIndex: 12, width: TW,
                  background: "linear-gradient(180deg,rgba(4,12,21,.98),rgba(2,7,13,.98))",
                  border: `1px solid ${rgb(c, 0.5)}`,
                  boxShadow: `0 0 20px ${rgb(c, 0.24)},0 10px 28px -8px rgba(0,0,0,.75)`,
                  clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))",
                  pointerEvents: "none", color: "#bfe9f2",
                }}>
                  <div style={{ height: 2, width: "100%", background: col, boxShadow: `0 0 8px ${col}` }} />
                  <div style={{ padding: "10px 13px 11px" }}>
                    {/* label + score */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#e3f7fc", letterSpacing: 0.4 }}>{d.label}</span>
                      <span style={{ fontSize: 20, fontWeight: 800, color: col, textShadow: `0 0 10px ${col}`, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{s}</span>
                    </div>
                    {/* country · verdict */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                      <span style={{ fontSize: 7, letterSpacing: 1.8, textTransform: "uppercase", color: "#3d5a64" }}>{d.country}</span>
                      <span style={{ fontSize: 8, letterSpacing: 1.5, fontWeight: 700, color: col }}>{verdict(s)}</span>
                    </div>
                    <div style={{ height: 1, background: `linear-gradient(90deg,${rgb(c, 0.35)},transparent)`, marginBottom: 9 }} />
                    {/* fund manager prose */}
                    {prose && (
                      <div style={{ fontSize: 9, color: "#8eccd9", lineHeight: 1.65, marginBottom: 10, letterSpacing: 0.1 }}>
                        {prose}
                      </div>
                    )}
                    <div style={{ height: 1, background: "rgba(70,224,245,.07)", marginBottom: 8 }} />
                    {/* session change */}
                    {d.changePct != null && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 7 }}>
                        <span style={{ color: "#3d5a64", letterSpacing: 1 }}>SESSION</span>
                        <span style={{ color: d.changePct >= 0 ? "#46e096" : "#e05a6e", fontWeight: 700 }}>
                          {d.changePct >= 0 ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
                        </span>
                      </div>
                    )}
                    <div style={{ fontSize: 7, letterSpacing: 1, color: "#24363d", textAlign: "center" }}>CLICK TO PIN FOR FULL BREAKDOWN ▣</div>
                  </div>
                </div>
              );
            })()}

            {/* ── Fund-manager pinned detail card ── */}
            {pinned && pinned.score != null && (() => {
              const d = pinned;
              const s = d.score!;
              const c = scoreRGB(s);
              const col = rgb(c);
              const reasons = factorReasons(d);
              const m = d.metrics;
              const val = d.valuation;

              const R = 22, CIRC = 2 * Math.PI * R;
              const dash = (s / 100) * CIRC;

              // vs WORLD comparison
              const vsWorld = m && worldRet63 != null ? m.ret63 - worldRet63 : null;
              const totalScored = data.filter((dd) => dd.metrics != null).length;

              // valuation has at least one non-null?
              const hasVal = val && (val.peTTM != null || val.peForward != null || val.dividendYield != null || val.beta != null);

              const subsRows: [string, number, string][] = reasons ? [
                ["TREND",    d.sub!.trend,   reasons.trend],
                ["MOMENTUM", d.sub!.mom,     reasons.mom],
                ["MEAN-REV", d.sub!.meanRev, reasons.meanRev],
                ["RISK",     d.sub!.risk,    reasons.risk],
              ] : [];

              return (
                <div className="ghm-card-in" style={{
                  position: "absolute", top: 10, right: 10, zIndex: 14, width: 288,
                  background: "linear-gradient(180deg,rgba(6,15,25,.99),rgba(3,8,15,.99))",
                  border: `1px solid ${rgb(c, 0.6)}`,
                  boxShadow: `0 0 28px ${rgb(c, 0.28)},0 16px 40px -12px rgba(0,0,0,.8)`,
                  clipPath: "polygon(0 0,calc(100% - 11px) 0,100% 11px,100% 100%,11px 100%,0 calc(100% - 11px))",
                  color: "#bfe9f2",
                }}>
                  <div style={{ height: 3, background: col, boxShadow: `0 0 10px ${col}` }} />
                  <div style={{ padding: "12px 14px 14px" }}>

                    {/* ── Section 1: Header ── */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.5, color: "#e7f8fc" }}>{d.label}</div>
                        <div style={{ fontSize: 7, letterSpacing: 2, textTransform: "uppercase", color: "#4d6b76", marginTop: 2 }}>{d.country}</div>
                      </div>
                      <div style={{ position: "relative", width: 52, height: 52 }}>
                        <svg width="52" height="52" viewBox="0 0 52 52">
                          <circle cx="26" cy="26" r={R} fill="none" stroke="rgba(70,224,245,.12)" strokeWidth="4" />
                          <circle cx="26" cy="26" r={R} fill="none" stroke={col} strokeWidth="4" strokeLinecap="round"
                            strokeDasharray={`${dash} ${CIRC - dash}`} transform="rotate(-90 26 26)"
                            style={{ filter: `drop-shadow(0 0 4px ${col})` }} />
                        </svg>
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: col, fontVariantNumeric: "tabular-nums" }}>{s}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 9, letterSpacing: 1.5, fontWeight: 700, color: col }}>{verdict(s)}</span>
                      <button onClick={(e) => { e.stopPropagation(); setPinnedKey(null); }} aria-label="Close"
                        style={{ background: "transparent", border: "1px solid rgba(64,200,224,.22)", color: "#9fe4f2", cursor: "pointer", width: 18, height: 18, fontSize: 9, lineHeight: 1, padding: 0 }}>✕</button>
                    </div>

                    {/* ── One-line meaning (always visible) ── */}
                    <div style={{ fontSize: 8.5, color: "#8eccd9", lineHeight: 1.6, marginBottom: 8 }}>
                      {indexBandExplanation(s)}
                    </div>

                    {/* ── EXPLAIN toggle ── */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setPinnedExplain((v) => !v); }}
                      style={{ background: "none", border: "1px solid rgba(64,200,224,.18)", color: "#5b7d8a", fontSize: 7.5, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", fontFamily: "monospace", padding: "4px 9px", marginBottom: 8 }}
                    >
                      {pinnedExplain ? "▾ HIDE BREAKDOWN" : "▸ EXPLAIN — FULL BREAKDOWN"}
                    </button>

                    {pinnedExplain && (<>
                    {/* ── Section 2: Returns ── */}
                    {m && (
                      <>
                        <div style={{ fontSize: 7.5, letterSpacing: 1.5, color: "#4d6b76", marginBottom: 5 }}>▸ RETURNS</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "2px 0", marginBottom: 5 }}>
                          {[["1M", m.ret21], ["3M", m.ret63], ["6M", m.ret126], ["YTD", m.retYTD], ["1Y", m.ret252]].map(([label, val]) => (
                            <div key={label as string} style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 7, color: "#3d5a64", letterSpacing: 1 }}>{label as string}</div>
                              <div style={{ fontSize: 9.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: (val as number) >= 0 ? "#46d9a8" : "#d96b7a", marginTop: 1 }}>
                                {fmt(val as number)}
                              </div>
                            </div>
                          ))}
                        </div>
                        {(vsWorld != null || m.rsRank != null) && (
                          <div style={{ display: "flex", gap: 12, marginBottom: 5, fontSize: 8 }}>
                            {vsWorld != null && (
                              <span style={{ color: vsWorld >= 0 ? "#46d9a8" : "#d96b7a" }}>
                                vs WORLD {fmt(vsWorld)} (3M)
                              </span>
                            )}
                            {m.rsRank != null && (
                              <span style={{ color: "#4d6b76" }}>
                                Rank <span style={{ color: "#9fd9e8" }}>{m.rsRank}</span>/{totalScored}
                              </span>
                            )}
                          </div>
                        )}
                        <div style={{ height: 1, background: "rgba(70,224,245,.07)", margin: "6px 0" }} />
                      </>
                    )}

                    {/* ── Section 3: Technicals ── */}
                    {m && (
                      <>
                        <div style={{ fontSize: 7.5, letterSpacing: 1.5, color: "#4d6b76", marginBottom: 5 }}>▸ TECHNICALS</div>
                        <div style={{ fontSize: 8.5, color: "#7dbfce", lineHeight: 1.7, marginBottom: 4 }}>
                          <div>
                            RSI <span style={{ color: m.rsi < 35 ? "#d9a046" : m.rsi > 65 ? "#d96b7a" : "#9fe4f2", fontWeight: 600 }}>{m.rsi.toFixed(0)}</span>
                            {m.pctVsSMA200 != null && (
                              <> · <span style={{ color: m.pctVsSMA200 >= 0 ? "#46d9a8" : "#d96b7a" }}>{fmt(m.pctVsSMA200)} vs 200MA</span></>
                            )}
                          </div>
                          <div>
                            {m.drawdownFromHigh != null && <>DD <span style={{ color: m.drawdownFromHigh < -20 ? "#d96b7a" : "#9fe4f2" }}>{fmt(m.drawdownFromHigh)}</span> from high · </>}
                            Vol <span style={{ color: m.vol > 30 ? "#d96b7a" : m.vol < 15 ? "#46d9a8" : "#9fe4f2" }}>{m.vol.toFixed(0)}%</span>
                          </div>
                          <div>
                            {m.maSignal === "golden" && <span style={{ color: "#46d9a8" }}>✦ Golden Cross</span>}
                            {m.maSignal === "death" && <span style={{ color: "#d96b7a" }}>✖ Death Cross</span>}
                            {m.maSignal === "neutral" && <span style={{ color: "#4d6b76" }}>◇ MA Neutral</span>}
                            {m.sharpe3M != null && <> · Sharpe <span style={{ color: m.sharpe3M > 1 ? "#46d9a8" : m.sharpe3M < 0 ? "#d96b7a" : "#9fe4f2" }}>{m.sharpe3M.toFixed(1)}</span> (3M)</>}
                          </div>
                        </div>
                        <div style={{ height: 1, background: "rgba(70,224,245,.07)", margin: "6px 0" }} />
                      </>
                    )}

                    {/* ── Section 4: Valuation (optional) ── */}
                    {hasVal && (
                      <>
                        <div style={{ fontSize: 7.5, letterSpacing: 1.5, color: "#4d6b76", marginBottom: 5 }}>▸ VALUATION</div>
                        <div style={{ display: "flex", gap: 14, marginBottom: 4, fontSize: 9 }}>
                          {val!.peTTM != null && <span style={{ color: "#9fe4f2" }}>P/E <span style={{ fontWeight: 700 }}>{val!.peTTM.toFixed(1)}×</span></span>}
                          {val!.peForward != null && <span style={{ color: "#9fe4f2" }}>Fwd <span style={{ fontWeight: 700 }}>{val!.peForward.toFixed(1)}×</span></span>}
                          {val!.dividendYield != null && <span style={{ color: "#46d9a8" }}>Div <span style={{ fontWeight: 700 }}>{val!.dividendYield.toFixed(1)}%</span></span>}
                          {val!.beta != null && <span style={{ color: "#9fe4f2" }}>β <span style={{ fontWeight: 700 }}>{val!.beta.toFixed(2)}</span></span>}
                        </div>
                        <div style={{ height: 1, background: "rgba(70,224,245,.07)", margin: "6px 0" }} />
                      </>
                    )}

                    {/* ── Section 5: Score breakdown ── */}
                    {subsRows.length > 0 && (
                      <>
                        <div style={{ fontSize: 7.5, letterSpacing: 1.5, color: "#4d6b76", marginBottom: 6 }}>▸ SCORE BREAKDOWN</div>
                        {subsRows.map(([l, v, why]) => (
                          <div key={l} style={{ marginBottom: 7 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ width: 58, fontSize: 7.5, letterSpacing: 1, color: "#4d6b76" }}>{l}</span>
                              <div style={{ flex: 1, height: 4, background: "rgba(70,224,245,.08)" }}>
                                <div style={{ width: `${v}%`, height: "100%", background: rgb(scoreRGB(v)), boxShadow: `0 0 5px ${rgb(scoreRGB(v))}` }} />
                              </div>
                              <span style={{ width: 18, textAlign: "right", fontSize: 9, fontVariantNumeric: "tabular-nums", color: "#cfeef6" }}>{v}</span>
                            </div>
                            <div style={{ fontSize: 7.5, color: "#4a6570", marginTop: 2, marginLeft: 65, lineHeight: 1.3 }}>{why}</div>
                          </div>
                        ))}
                      </>
                    )}

                    {/* ── Thesis ── */}
                    {reasons && (
                      <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid rgba(70,224,245,.1)", fontSize: 8.5, color: "#7dbfce", lineHeight: 1.55 }}>
                        ▸ {reasons.thesis}
                      </div>
                    )}
                    </>)}

                    {/* price + session */}
                    <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(70,224,245,.08)", display: "flex", justifyContent: "space-between", fontSize: 8.5 }}>
                      <span style={{ color: "#4d6b76", letterSpacing: 0.5 }}>
                        {d.price != null ? d.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
                      </span>
                      {d.changePct != null && (
                        <span style={{ color: d.changePct >= 0 ? "#46e096" : "#e05a6e", fontWeight: 700 }}>
                          {d.changePct >= 0 ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Legend / scale ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 20px 11px", borderTop: "1px solid rgba(64,200,224,.08)" }}>
            <span style={{ fontSize: 8, letterSpacing: 1.5, color: "#4d6b76" }}>SELL</span>
            <div style={{ flex: "0 0 240px", position: "relative" }}>
              <div style={{ height: 6, border: "1px solid rgba(64,200,224,.18)", background: "linear-gradient(90deg,#6c1a1a,#c64034,#c9822c,#4696b2,#2eb27a,#46e096)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                {[0, 25, 50, 75, 100].map((n) => (
                  <span key={n} style={{ fontSize: 6.5, color: "#3b5b67", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                ))}
              </div>
            </div>
            <span style={{ fontSize: 8, letterSpacing: 1.5, color: "#4d6b76" }}>BUY</span>
            <span style={{ marginLeft: "auto", fontSize: 7.5, letterSpacing: 1.5, color: "#26343d" }}>HOVER → OVERVIEW · CLICK → FULL ANALYSIS</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function scoreColor(s: number): string { return rgb(scoreRGB(s)); }
