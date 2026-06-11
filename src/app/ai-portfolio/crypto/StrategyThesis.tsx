"use client";

import { useState } from "react";

export type TokenThesis = {
  token: string;
  maxPrice: number | null;
  cadenceDays: number;
  price: number | null;
};

const TOKEN_COLOR: Record<string, string> = {
  BTC: "#ffcf4a",
  ETH: "#46e0f5",
  SOL: "#27f59b",
  HYPE: "#b56bff",
};

function usd(v: number | null | undefined, dec = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

// The decision pipeline the engine runs per token, per daily tick.
const GATES: { n: string; label: string; detail: string }[] = [
  { n: "01", label: "KILL SWITCH", detail: "If disarmed, the engine halts before touching any token." },
  { n: "02", label: "DUE CHECK", detail: "Acts only when the token's next run is due. While waiting for a dip it re-checks daily; after a fill it waits the full cadence." },
  { n: "03", label: "PRICE CEILING", detail: "Primary entry gate. If price is above the token's ceiling, it skips and re-checks tomorrow. No buy until price falls into range." },
  { n: "04", label: "COUNCIL VERDICT", detail: "4 AI agents + Kronos forecast vote BUY / HOLD / SELL with a confidence score." },
  { n: "05", label: "SELL-SKIP", detail: "A strong SELL (≥ threshold) skips the period entirely, up to the max consecutive-skip limit — then forces a buy." },
  { n: "06", label: "BUY-ZONE SIZING", detail: "BUY + confidence ≥ min + price inside the council's entry zone → boosted size. Otherwise base size." },
  { n: "07", label: "MONTHLY CAP", detail: "Skips if the order would push month-to-date spend over the cap." },
  { n: "08", label: "BALANCE", detail: "Skips if spot USDC is below the order size." },
  { n: "09", label: "EXECUTE", detail: "Market buy on Hyperliquid spot (IOC, 5% marketable limit). Records fill + advances the cadence." },
];

export function StrategyThesis({
  dca,
  boost,
  cap,
  minConf,
  sellSkipThreshold,
  maxConsecutiveSkips,
  tokens,
}: {
  dca: number;
  boost: number;
  cap: number;
  minConf: number;
  sellSkipThreshold: number;
  maxConsecutiveSkips: number;
  tokens: TokenThesis[];
}) {
  const [open, setOpen] = useState(false);

  const params = [
    { l: "BASE BUY", v: usd(dca) },
    { l: "BOOST BUY", v: usd(boost) },
    { l: "MONTHLY CAP", v: usd(cap) },
    { l: "MIN CONFIDENCE", v: `${minConf}%` },
    { l: "SELL-SKIP ≥", v: `${sellSkipThreshold}%` },
    { l: "MAX SKIPS", v: `${maxConsecutiveSkips}×` },
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
        <span>[//]</span><span>STRATEGY · DIP-DCA + COUNCIL</span>
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
      <div style={{ fontSize: 12, lineHeight: 1.6, color: "#bfe9f2", marginBottom: 16, maxWidth: 760 }}>
        Accumulate <span style={{ color: "#ffcf4a" }}>BTC · ETH · SOL · HYPE</span> on a recurring cadence, but
        <span style={{ color: "#27f59b" }}> only when price sits at or below each token&apos;s entry ceiling</span> — a
        &ldquo;buy the correction&rdquo; bias. An AI council then sizes the order up when it confirms a high-conviction
        buy-zone, or vetoes the buy on a strong sell signal. Buys execute on Hyperliquid spot; the bot never sells.
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

      {/* per-token entry thesis */}
      <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 8 }}>ENTRY CEILINGS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: open ? 18 : 0 }}>
        {tokens.map((t) => {
          const c = TOKEN_COLOR[t.token] ?? "#3fd0e0";
          const armed = t.maxPrice != null && t.price != null && t.price <= t.maxPrice;
          const gapPct = t.maxPrice != null && t.price != null && t.maxPrice > 0
            ? ((t.price - t.maxPrice) / t.maxPrice) * 100
            : null;
          return (
            <div key={t.token} style={{ border: `1px solid ${c}33`, background: `${c}08`, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: c, letterSpacing: 1 }}>{t.token}</span>
                <span style={{ fontSize: 8, color: armed ? "#27f59b" : "#5b7d8a", textTransform: "uppercase", letterSpacing: 1 }}>
                  {armed ? "▶ IN RANGE" : "WAITING"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#bfe9f2", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
                ≤ {usd(t.maxPrice)}
                <span style={{ fontSize: 8, color: "#5b7d8a", marginLeft: 6 }}>/ {t.cadenceDays}D</span>
              </div>
              {gapPct != null && (
                <div style={{ fontSize: 8, color: gapPct > 0 ? "#ff9500" : "#27f59b", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                  {gapPct > 0 ? `+${gapPct.toFixed(1)}% above` : `${Math.abs(gapPct).toFixed(1)}% below`} ceiling
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* expandable decision pipeline */}
      {open && (
        <div style={{ borderTop: "1px solid rgba(64,200,224,.15)", paddingTop: 14 }}>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 10 }}>
            DECISION PIPELINE · per token, every daily tick
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
