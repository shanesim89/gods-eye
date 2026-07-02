"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { OptionsAnalysis } from "@/lib/options/analytics";

const mono = "JetBrains Mono, Consolas, monospace";
const GREEN = "#22c55e";
const RED = "#ef4444";
const CYAN = "#22d3ee";
const AMBER = "#f59e0b";
const PURPLE = "#a78bfa";
const GRID = "rgba(255,255,255,0.05)";
const AXIS = "#4b5563";

const axisTick = { fill: AXIS, fontSize: 9, fontFamily: mono };

const tooltipStyle = {
  contentStyle: {
    background: "#0a0a0a",
    border: "1px solid #1f1f3a",
    fontFamily: mono,
    fontSize: 10,
    padding: "6px 10px",
  },
  labelStyle: { color: "#6b7280", marginBottom: 4 },
};

function ChartFrame({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border border-border bg-grid p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-muted text-[10px] uppercase tracking-[1px]">{title}</div>
        {hint && <div className="text-dim text-[9px]">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

const f0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const f2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ── Payoff (P&L at expiry vs now) ────────────────────────────────────────────
export function PayoffChart({ a }: { a: OptionsAnalysis }) {
  const s = a.selected;
  if (!s || a.charts.payoff.length === 0) return null;
  return (
    <ChartFrame title="Payoff Diagram" hint={`${s.type === "C" ? "Long Call" : "Long Put"} · per contract`}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={a.charts.payoff} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 6" stroke={GRID} />
          <XAxis dataKey="price" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={f0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => `$${f0(v)}`} />
          <Tooltip {...tooltipStyle} formatter={(v: unknown, n) => [`$${f2(Number(v))}`, n === "expiry" ? "At expiry" : "Now (BS)"]} labelFormatter={(l) => `Underlying $${f2(Number(l))}`} />
          <ReferenceLine y={0} stroke="#374151" />
          <ReferenceLine x={a.spot} stroke={CYAN} strokeDasharray="3 3" label={{ value: "spot", fill: CYAN, fontSize: 8, position: "insideTopRight" }} />
          <ReferenceLine x={s.breakeven} stroke={AMBER} strokeDasharray="3 3" label={{ value: "B/E", fill: AMBER, fontSize: 8, position: "insideTopLeft" }} />
          <Line type="monotone" dataKey="expiry" stroke={GREEN} dot={false} strokeWidth={1.8} />
          <Line type="monotone" dataKey="now" stroke={PURPLE} dot={false} strokeWidth={1.2} strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Greeks vs spot (2×2 small charts) ────────────────────────────────────────
const GREEK_DEFS: { key: "delta" | "gamma" | "theta" | "vega"; color: string }[] = [
  { key: "delta", color: CYAN },
  { key: "gamma", color: GREEN },
  { key: "theta", color: RED },
  { key: "vega", color: AMBER },
];
export function GreeksProfileChart({ a }: { a: OptionsAnalysis }) {
  if (a.charts.greeks.length === 0) return null;
  return (
    <ChartFrame title="Greeks vs Underlying" hint="how Δ Γ Θ V evolve as spot moves">
      <div className="grid grid-cols-2 gap-2">
        {GREEK_DEFS.map((g) => (
          <div key={g.key}>
            <div className="text-dim text-[9px] uppercase mb-0.5" style={{ color: g.color }}>{g.key}</div>
            <ResponsiveContainer width="100%" height={84}>
              <LineChart data={a.charts.greeks} margin={{ top: 2, right: 6, left: 0, bottom: 0 }}>
                <XAxis dataKey="price" tick={{ ...axisTick, fontSize: 8 }} tickLine={false} axisLine={false} tickFormatter={f0} interval={Math.floor(a.charts.greeks.length / 3)} />
                <YAxis tick={{ ...axisTick, fontSize: 8 }} tickLine={false} axisLine={false} width={34} tickFormatter={f2} />
                <Tooltip {...tooltipStyle} formatter={(v: unknown) => [f2(Number(v)), g.key]} labelFormatter={(l) => `$${f2(Number(l))}`} />
                <ReferenceLine x={a.spot} stroke={CYAN} strokeDasharray="2 2" />
                <Line type="monotone" dataKey={g.key} stroke={g.color} dot={false} strokeWidth={1.4} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

// ── IV skew (smile) ──────────────────────────────────────────────────────────
export function IvSkewChart({ a }: { a: OptionsAnalysis }) {
  if (a.charts.skew.length === 0) return null;
  return (
    <ChartFrame title="IV Skew" hint="implied vol by strike (the smile)">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={a.charts.skew} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 6" stroke={GRID} />
          <XAxis dataKey="strike" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={f0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} tickFormatter={(v) => `${f0(v)}%`} />
          <Tooltip {...tooltipStyle} formatter={(v: unknown, n) => [v == null ? "—" : `${f2(Number(v))}%`, n === "callIV" ? "Call IV" : "Put IV"]} labelFormatter={(l) => `Strike $${f0(Number(l))}`} />
          <ReferenceLine x={a.spot} stroke={CYAN} strokeDasharray="3 3" label={{ value: "spot", fill: CYAN, fontSize: 8 }} />
          <Line type="monotone" dataKey="callIV" stroke={GREEN} dot={false} strokeWidth={1.5} connectNulls />
          <Line type="monotone" dataKey="putIV" stroke={RED} dot={false} strokeWidth={1.5} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── IV term structure ────────────────────────────────────────────────────────
export function IvTermChart({ a }: { a: OptionsAnalysis }) {
  const data = a.charts.term.map((p) => ({ ...p, ivPct: p.atmIV * 100 }));
  if (data.length < 2) return null;
  return (
    <ChartFrame title="IV Term Structure" hint="ATM IV by expiry — up = contango">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 6" stroke={GRID} />
          <XAxis dataKey="dte" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${f0(v)}d`} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} tickFormatter={(v) => `${f0(v)}%`} />
          <Tooltip {...tooltipStyle} formatter={(v: unknown) => [`${f2(Number(v))}%`, "ATM IV"]} labelFormatter={(l) => `${f0(Number(l))} DTE`} />
          <Line type="monotone" dataKey="ivPct" stroke={AMBER} dot={{ r: 2, fill: AMBER }} strokeWidth={1.6} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Open interest + volume by strike ─────────────────────────────────────────
export function OpenInterestChart({ a }: { a: OptionsAnalysis }) {
  if (a.charts.oi.length === 0) return null;
  return (
    <ChartFrame title="Open Interest by Strike" hint="call/put walls · max-pain magnet">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={a.charts.oi} margin={{ top: 6, right: 10, left: 0, bottom: 0 }} barGap={0} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="2 6" stroke={GRID} vertical={false} />
          <XAxis dataKey="strike" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={f0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={46} tickFormatter={f0} />
          <Tooltip {...tooltipStyle} formatter={(v: unknown, n) => [f0(Number(v)), n === "callOI" ? "Call OI" : "Put OI"]} labelFormatter={(l) => `Strike $${f0(Number(l))}`} />
          <ReferenceLine x={a.spot} stroke={CYAN} strokeDasharray="3 3" label={{ value: "spot", fill: CYAN, fontSize: 8 }} />
          <ReferenceLine x={a.chainStats.maxPain} stroke={AMBER} strokeDasharray="3 3" label={{ value: "max pain", fill: AMBER, fontSize: 8, position: "insideTopRight" }} />
          <Bar dataKey="callOI" fill={GREEN} fillOpacity={0.65} />
          <Bar dataKey="putOI" fill={RED} fillOpacity={0.65} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Probability cone (lognormal terminal distribution) ───────────────────────
export function ProbabilityChart({ a }: { a: OptionsAnalysis }) {
  const s = a.selected;
  if (!s || a.charts.distribution.length === 0) return null;
  const profitable = (price: number) => (s.type === "C" ? price >= s.breakeven : price <= s.breakeven);
  return (
    <ChartFrame title="Probability Cone" hint={`POP ${f0(s.pop)}% · terminal price distribution`}>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={a.charts.distribution} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="distFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PURPLE} stopOpacity={0.5} />
              <stop offset="100%" stopColor={PURPLE} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 6" stroke={GRID} />
          <XAxis dataKey="price" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={f0} />
          <YAxis hide />
          <Tooltip {...tooltipStyle} formatter={() => ["", ""]} labelFormatter={(l) => `$${f2(Number(l))}  ${profitable(Number(l)) ? "✓ profit" : "✗ loss"}`} />
          <ReferenceLine x={a.spot} stroke={CYAN} strokeDasharray="3 3" label={{ value: "spot", fill: CYAN, fontSize: 8 }} />
          <ReferenceLine x={s.strike} stroke="#9ca3af" strokeDasharray="2 2" label={{ value: "K", fill: "#9ca3af", fontSize: 8 }} />
          <ReferenceLine x={s.breakeven} stroke={AMBER} strokeDasharray="3 3" label={{ value: "B/E", fill: AMBER, fontSize: 8 }} />
          <Area type="monotone" dataKey="density" stroke={PURPLE} strokeWidth={1.2} fill="url(#distFill)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Expected-move cone (±1σ / ±2σ funnel to expiry) ──────────────────────────
export function ExpectedMoveCone({ a }: { a: OptionsAnalysis }) {
  if (a.charts.cone.length < 2) return null;
  return (
    <ChartFrame title="Expected Move Cone" hint={`±1σ / ±2σ to expiry · ±${f2(a.chainStats.expectedMove.pct)}% at 1σ`}>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={a.charts.cone} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 6" stroke={GRID} />
          <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${f0(v)}d`} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={50} domain={["auto", "auto"]} tickFormatter={(v) => `$${f0(v)}`} />
          <Tooltip {...tooltipStyle} formatter={(v: unknown, n) => [`$${f2(Number(v))}`, String(n)]} labelFormatter={(l) => `+${f0(Number(l))} days`} />
          <ReferenceLine y={a.spot} stroke={CYAN} strokeDasharray="3 3" label={{ value: "spot", fill: CYAN, fontSize: 8 }} />
          <Line type="monotone" dataKey="hi2" stroke={RED} dot={false} strokeWidth={1} strokeDasharray="4 3" />
          <Line type="monotone" dataKey="hi1" stroke={AMBER} dot={false} strokeWidth={1.2} />
          <Line type="monotone" dataKey="lo1" stroke={AMBER} dot={false} strokeWidth={1.2} />
          <Line type="monotone" dataKey="lo2" stroke={RED} dot={false} strokeWidth={1} strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
