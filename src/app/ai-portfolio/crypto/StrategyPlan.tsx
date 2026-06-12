// "PLAN" HUD panel — per-token forward view: when the engine runs next, what
// size it intends, skip counters, ceiling, and the monthly cap line. This is
// where "why did nothing happen" lives for paths that write no order row
// (kill-switch, not-due, price ceiling, cap-exceeded). Server-rendered.

export type PlanRow = {
  token: string;
  nextRunAt: string | null; // ISO, null = due now
  plannedUsd: number;
  boostUsd: number;
  consecutiveSkips: number;
  maxSkips: number;
  maxPrice: number | null;
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

export function StrategyPlan({
  rows,
  spent,
  cap,
  killSwitch,
}: {
  rows: PlanRow[];
  spent: number;
  cap: number;
  killSwitch: boolean;
}) {
  const now = Date.now();
  return (
    <div
      style={{
        position: "relative",
        background: "rgba(8,18,28,.6)",
        border: "1px solid rgba(64,200,224,.22)",
        clipPath:
          "polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))",
        backdropFilter: "blur(2px)",
        marginTop: 16,
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

      <div style={{ fontSize: 8, letterSpacing: 3, color: "#3fd0e0", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span>[▸▸]</span><span>PLAN · WHAT HAPPENS NEXT</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(64,200,224,.3),transparent)" }} />
      </div>

      {killSwitch && (
        <div style={{ fontSize: 9, color: "#ff5470", border: "1px solid rgba(255,84,112,.3)", background: "rgba(255,84,112,.05)", padding: "6px 8px", marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>
          ✕ KILL SWITCH ACTIVE — engine halted; nothing below runs until re-armed
        </div>
      )}

      {/* monthly cap line */}
      <div style={{ fontSize: 9, color: "#8fb8c4", marginBottom: 10, fontVariantNumeric: "tabular-nums", letterSpacing: 0.5 }}>
        MONTHLY CAP {usd(spent, 2)} / {usd(cap, 2)}
        {spent >= cap && <span style={{ color: "#ff5470" }}> — CAP REACHED, all buys skip until next month</span>}
      </div>

      {/* per-token rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r) => {
          const tc = TOKEN_COLOR[r.token] ?? "#3fd0e0";
          const dueNow = !r.nextRunAt || new Date(r.nextRunAt).getTime() <= now;
          const ceilingBlocked = r.maxPrice != null && r.price != null && r.price > r.maxPrice;
          const next = r.nextRunAt
            ? new Date(r.nextRunAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()
            : "NOW";
          return (
            <div
              key={r.token}
              style={{ display: "grid", gridTemplateColumns: "52px 110px 1fr 110px", gap: 8, padding: "6px 8px", alignItems: "center", fontSize: 10, fontVariantNumeric: "tabular-nums", borderBottom: "1px solid rgba(64,200,224,.06)" }}
            >
              <span style={{ color: tc, fontWeight: 700, letterSpacing: 1 }}>{r.token}</span>
              <span style={{ color: dueNow ? "#27f59b" : "#8fb8c4" }}>
                {dueNow ? "▸ DUE NOW" : `NEXT ${next}`}
              </span>
              <span style={{ color: "#8fb8c4" }}>
                {ceilingBlocked ? (
                  <span style={{ color: "#ffcf4a" }}>BLOCKED — price {usd(r.price, 0)} above ceiling {usd(r.maxPrice, 0)}; rechecks daily</span>
                ) : (
                  <>PLANNED {usd(r.plannedUsd)} <span style={{ color: "#5b7d8a" }}>(boost {usd(r.boostUsd)} if buy-zone)</span></>
                )}
              </span>
              <span style={{ color: r.consecutiveSkips > 0 ? "#ffcf4a" : "#5b7d8a", textAlign: "right" }}>
                SKIPS {r.consecutiveSkips}/{r.maxSkips}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
