"use client";

import { useState } from "react";

export type UnderlyingThesis = {
  symbol: string;
  assetClass: string;
  spot: number | null;
  wheelState: "cash" | "holding_stock";
  shares: number;
  costBasis: number | null;
  verdict: string | null;
  confidence: number | null;
  nextRun: Date | null;
  collateralReserved: number;
  openCount: number;
};

// Stable color per underlying (palette cycled by index).
const PALETTE = ["#ffcf4a", "#46e0f5", "#27f59b", "#b56bff", "#ff9500", "#ff5470"];
function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

function usd(v: number | null | undefined, dec = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

// The decision pipeline the options engine runs each weekly tick. Mirrors runOptionsForUser().
const GATES: { n: string; label: string; detail: string }[] = [
  { n: "01", label: "KILL SWITCH", detail: "If disarmed, the engine halts before touching any underlying." },
  { n: "02", label: "SETTLE EXPIRY", detail: "First, settle expired contracts. Put assigned → buy 100 shares (state → HOLDING). Call exercised → shares sold (state → CASH). Otherwise the option expires worthless and the full premium is kept." },
  { n: "03", label: "DUE CHECK", detail: "Acts on a weekly cadence per underlying. Skips if the next run is not yet due." },
  { n: "04", label: "PERIOD CLAIM", detail: "Atomic weekly idempotency claim — one wheel action per underlying per ISO week, even on retries." },
  { n: "05", label: "COUNCIL VERDICT", detail: "4 AI agents + Kronos forecast vote BUY / HOLD / SELL with a confidence score on the underlying." },
  { n: "06", label: "WHEEL ACTION", detail: "CASH → sell a cash-secured put (skipped on a strong SELL ≥ conviction). HOLDING → sell a covered call above cost basis to get called away at a profit." },
  { n: "07", label: "COLLATERAL CAP", detail: "A new cash-secured put is skipped if total reserved collateral would exceed the account max." },
  { n: "08", label: "LONG PLAY", detail: "Additive directional bet when conviction ≥ threshold — BUY → long call, SELL → long put. Budget-capped; max loss = premium paid." },
  { n: "09", label: "ADVANCE +7D", detail: "Records the contract and schedules the next run one week out." },
];

export function OptionsStrategyThesis({
  convictionThreshold,
  targetDelta,
  dteMin,
  dteMax,
  longPlayBudget,
  longPlayEnabled,
  collateralPerContract,
  maxCollateral,
  underlyings,
}: {
  convictionThreshold: number;
  targetDelta: number;
  dteMin: number;
  dteMax: number;
  longPlayBudget: number;
  longPlayEnabled: boolean;
  collateralPerContract: number;
  maxCollateral: number;
  underlyings: UnderlyingThesis[];
}) {
  const [open, setOpen] = useState(false);

  const params = [
    { l: "TARGET Δ", v: `${targetDelta}%` },
    { l: "DTE WINDOW", v: `${dteMin}–${dteMax}D` },
    { l: "CONVICTION ≥", v: `${convictionThreshold}%` },
    { l: "COLLAT / CONTRACT", v: usd(collateralPerContract) },
    { l: "MAX COLLATERAL", v: usd(maxCollateral) },
    { l: "LONG-PLAY BUDGET", v: longPlayEnabled ? usd(longPlayBudget) : "OFF" },
  ];

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(8,18,28,.6)",
        border: "1px solid rgba(64,200,224,.22)",
        clipPath:
          "polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))",
        backdropFilter: "blur(2px)",
        marginBottom: 16,
        padding: "16px 20px",
      }}
    >
      {[
        { top: 5, left: 5, borderTop: "2px solid", borderLeft: "2px solid" },
        { top: 5, right: 5, borderTop: "2px solid", borderRight: "2px solid" },
        { bottom: 5, left: 5, borderBottom: "2px solid", borderLeft: "2px solid" },
        { bottom: 5, right: 5, borderBottom: "2px solid", borderRight: "2px solid" },
      ].map((s, i) => (
        <div key={i} style={{ position: "absolute", width: 16, height: 16, pointerEvents: "none", borderColor: "rgba(70,224,245,.5)", ...s }} />
      ))}

      <div style={{ fontSize: 8, letterSpacing: 3, color: "#3fd0e0", textTransform: "uppercase", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <span>[//]</span><span>STRATEGY · THE WHEEL + COUNCIL LONG PLAYS</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "rgba(70,224,245,.06)", border: "1px solid rgba(64,200,224,.3)",
            color: "#3fd0e0", fontSize: 8, letterSpacing: 1, padding: "3px 8px",
            textTransform: "uppercase", cursor: "pointer", fontFamily: "monospace",
          }}
        >
          {open ? "▾ HIDE LOGIC" : "▸ HOW IT DECIDES"}
        </button>
      </div>

      {/* one-line thesis */}
      <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bfe9f2", marginBottom: 16, maxWidth: 820 }}>
        Generate income by <span style={{ color: "#27f59b" }}>selling cash-secured puts</span> on approved underlyings;
        if assigned, hold the shares and <span style={{ color: "#ffcf4a" }}>sell covered calls</span> above cost basis until
        called away — then repeat. An AI council gates each leg (no puts into a strong SELL) and can add a small
        <span style={{ color: "#b56bff" }}> directional long play</span> on high conviction. Defined risk, never naked. Paper only.
      </div>

      {/* parameter grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 16 }}>
        {params.map(({ l, v }) => (
          <div key={l} style={{ border: "1px solid rgba(64,200,224,.12)", background: "rgba(70,224,245,.02)", padding: "7px 9px" }}>
            <div style={{ fontSize: 7, letterSpacing: 1, color: "#5b7d8a", textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#bfe9f2", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* wheel state machine diagram */}
      <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 8 }}>THE WHEEL · STATE MACHINE</div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginBottom: 16, flexWrap: "wrap" }}>
        {/* CASH state */}
        <div style={{ flex: "1 1 200px", minWidth: 180, border: "1px solid rgba(39,245,155,.4)", background: "rgba(39,245,155,.05)", padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#27f59b", letterSpacing: 1 }}>● CASH</div>
          <div style={{ fontSize: 9, color: "#8fb8c4", marginTop: 4, lineHeight: 1.5 }}>
            Sell cash-secured puts. Keep premium while price holds above the strike.
          </div>
        </div>
        {/* assigned transition */}
        <div style={{ flex: "0 0 96px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 6px" }}>
          <div style={{ fontSize: 8, color: "#ffcf4a", textTransform: "uppercase", letterSpacing: 1 }}>assigned</div>
          <div style={{ fontSize: 14, color: "#ffcf4a" }}>→</div>
          <div style={{ fontSize: 14, color: "#5b7d8a" }}>←</div>
          <div style={{ fontSize: 8, color: "#5b7d8a", textTransform: "uppercase", letterSpacing: 1 }}>called away</div>
        </div>
        {/* HOLDING state */}
        <div style={{ flex: "1 1 200px", minWidth: 180, border: "1px solid rgba(255,207,74,.4)", background: "rgba(255,207,74,.05)", padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ffcf4a", letterSpacing: 1 }}>● HOLDING STOCK</div>
          <div style={{ fontSize: 9, color: "#8fb8c4", marginTop: 4, lineHeight: 1.5 }}>
            Own 100 shares/contract. Sell covered calls above cost basis until shares are called away.
          </div>
        </div>
      </div>

      {/* per-underlying current state */}
      <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 8 }}>UNDERLYINGS · LIVE STATE</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: open ? 18 : 0 }}>
        {underlyings.map((u, i) => {
          const c = colorFor(i);
          const inCash = u.wheelState === "cash";
          const stateColor = inCash ? "#27f59b" : "#ffcf4a";
          const stateLabel = inCash ? "CASH · SELLING PUTS" : `HOLDING ${Math.round(u.shares)} · SELLING CALLS`;
          const vColor = u.verdict === "BUY" ? "#27f59b" : u.verdict === "SELL" ? "#ff5470" : "#ffcf4a";
          return (
            <div key={u.symbol} style={{ border: `1px solid ${c}33`, background: `${c}08`, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: c, letterSpacing: 1 }}>{u.symbol}</span>
                <span style={{ fontSize: 11, color: "#bfe9f2", fontVariantNumeric: "tabular-nums" }}>{usd(u.spot, 2)}</span>
              </div>
              <div style={{ fontSize: 8, fontWeight: 700, color: stateColor, marginTop: 5, letterSpacing: 1, textTransform: "uppercase" }}>
                {stateLabel}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 8, color: "#5b7d8a", fontVariantNumeric: "tabular-nums" }}>
                <span>SIGNAL <span style={{ color: vColor, fontWeight: 700 }}>{u.verdict ?? "—"}{u.confidence != null ? ` ${u.confidence}%` : ""}</span></span>
                <span>NEXT {fmtDate(u.nextRun)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, color: "#5b7d8a", fontVariantNumeric: "tabular-nums" }}>
                <span>OPEN {u.openCount}</span>
                <span>COLLAT {usd(u.collateralReserved)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* expandable decision pipeline */}
      {open && (
        <div style={{ borderTop: "1px solid rgba(64,200,224,.15)", paddingTop: 14 }}>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 10 }}>
            DECISION PIPELINE · per underlying, every weekly tick
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {GATES.map((g) => (
              <div key={g.n} style={{ display: "flex", gap: 12, padding: "7px 10px", background: "rgba(70,224,245,.02)", borderLeft: "2px solid rgba(64,200,224,.3)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#3fd0e0", fontVariantNumeric: "tabular-nums", minWidth: 18 }}>{g.n}</span>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#ffcf4a", letterSpacing: 1, textTransform: "uppercase" }}>{g.label}</span>
                  <div style={{ fontSize: 10, color: "#8fb8c4", lineHeight: 1.5, marginTop: 2 }}>{g.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
