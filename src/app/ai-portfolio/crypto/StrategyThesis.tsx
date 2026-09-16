"use client";

import { useState } from "react";

export type TokenThesis = {
  token: string;
  price: number | null;
  high7d: number | null;
  dropPct: number | null;
  armed: boolean;
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

// The decision pipeline the engine runs per token, every daily tick — mirrors gates.ts DCA_GATES.
const GATES: { n: string; label: string; detail: string }[] = [
  { n: "01", label: "KILL SWITCH", detail: "If disarmed, the engine halts before touching any token." },
  { n: "02", label: "MON-THU", detail: "Execution only fires Monday through Thursday. Friday/weekend keep monitoring but never buy." },
  { n: "03", label: "8% DROP", detail: "Price must sit ≥8% below the token's 7-day rolling high, measured same-day." },
  { n: "04", label: "IDEMPOTENCY", detail: "One claim per token per day — a duplicate tick can't double-buy." },
  { n: "05", label: "BALANCE", detail: "Skips if spot USDC is below the order size." },
  { n: "06", label: "EXECUTE", detail: "Market buy of $50 at the current price. Records the fill." },
];

export function StrategyThesis({ buyUsd, tokens }: { buyUsd: number; tokens: TokenThesis[] }) {
  const [open, setOpen] = useState(false);

  const params = [
    { l: "BUY SIZE", v: usd(buyUsd) },
    { l: "DROP TRIGGER", v: "8%" },
    { l: "EXEC WINDOW", v: "MON–THU" },
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
        <span>[//]</span><span>STRATEGY · 8% DIP BUY</span>
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
        Watch <span style={{ color: "#ffcf4a" }}>BTC · ETH · SOL · HYPE</span> Monday through Thursday. The moment a
        token trades <span style={{ color: "#27f59b" }}>8% below its 7-day high</span>, fire an immediate $50 buy at
        the current price — same day, no waiting. Friday and weekends keep watching but never execute. No spend cap,
        no price ceiling — the bot never sells.
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

      {/* per-token drop status */}
      <div style={{ fontSize: 8, letterSpacing: 2, color: "#5b7d8a", textTransform: "uppercase", marginBottom: 8 }}>7-DAY HIGH / DROP</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: open ? 18 : 0 }}>
        {tokens.map((t) => {
          const c = TOKEN_COLOR[t.token] ?? "#3fd0e0";
          return (
            <div key={t.token} style={{ border: `1px solid ${c}33`, background: `${c}08`, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: c, letterSpacing: 1 }}>{t.token}</span>
                <span style={{ fontSize: 8, color: t.armed ? "#27f59b" : "#5b7d8a", textTransform: "uppercase", letterSpacing: 1 }}>
                  {t.armed ? "▶ ARMED" : "WATCHING"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#bfe9f2", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
                {usd(t.high7d)}
                <span style={{ fontSize: 8, color: "#5b7d8a", marginLeft: 6 }}>7D HIGH</span>
              </div>
              {t.dropPct != null && (
                <div style={{ fontSize: 8, color: t.dropPct >= 8 ? "#27f59b" : "#ff9500", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                  {t.dropPct >= 0 ? `${t.dropPct.toFixed(1)}% below` : `${Math.abs(t.dropPct).toFixed(1)}% above`} high
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
