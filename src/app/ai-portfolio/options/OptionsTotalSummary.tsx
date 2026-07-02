export type OptionsSummaryData = {
  premiumIncome: number;
  realizedPnl: number;
  collateralReserved: number;
  maxCollateral: number;
  openCount: number;
  alloc: { symbol: string; value: number; pct: number }[];
};

const SYMBOL_COLOR: Record<string, string> = {
  SPY: "#ffcf4a",
  AAPL: "#46e0f5",
  BTC: "#f7931a",
  ETH: "#8a9cff",
  SOL: "#27f59b",
};

function usd(v: number | null | undefined, dec = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

/** Full-width amber hero band — overall options book at a glance, before strategies. */
export function OptionsTotalSummary({ data }: { data: OptionsSummaryData }) {
  const pnlColor = data.realizedPnl === 0 ? "#8a7340" : data.realizedPnl > 0 ? "#27f59b" : "#ff5470";
  const collateralPct =
    data.maxCollateral > 0 ? Math.min(100, (data.collateralReserved / data.maxCollateral) * 100) : 0;

  return (
    <div
      style={{
        position: "relative",
        marginBottom: 16,
        background: "linear-gradient(135deg, rgba(40,28,6,.85), rgba(14,10,2,.92) 55%, rgba(8,18,28,.85))",
        border: "1px solid rgba(255,207,74,.45)",
        boxShadow: "0 0 18px rgba(255,207,74,.08), inset 0 0 30px rgba(255,207,74,.04)",
        clipPath: "polygon(0 12px,12px 0,calc(100% - 12px) 0,100% 12px,100% calc(100% - 12px),calc(100% - 12px) 100%,12px 100%,0 calc(100% - 12px))",
        padding: "14px 20px",
      }}
    >
      {/* corner accents */}
      {[
        { top: 3, left: 3, borderTop: "2px solid", borderLeft: "2px solid" },
        { top: 3, right: 3, borderTop: "2px solid", borderRight: "2px solid" },
        { bottom: 3, left: 3, borderBottom: "2px solid", borderLeft: "2px solid" },
        { bottom: 3, right: 3, borderBottom: "2px solid", borderRight: "2px solid" },
      ].map((s, i) => (
        <div key={i} style={{ position: "absolute", width: 12, height: 12, pointerEvents: "none", borderColor: "rgba(255,207,74,.6)", ...s }} />
      ))}

      <div style={{ fontSize: 8, letterSpacing: 3, color: "#ffcf4a", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <span>◈</span><span>OPTIONS BOOK — TOTAL</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#8a7340", textTransform: "uppercase", marginBottom: 5 }}>PREMIUM INCOME</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ffe9b0", fontVariantNumeric: "tabular-nums", lineHeight: 1, textShadow: "0 0 14px rgba(255,207,74,.35)" }}>
            {usd(data.premiumIncome)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#8a7340", textTransform: "uppercase", marginBottom: 5 }}>REALIZED P&L</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: pnlColor, fontVariantNumeric: "tabular-nums" }}>
            {data.realizedPnl > 0 ? "+" : ""}{usd(data.realizedPnl)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#8a7340", textTransform: "uppercase", marginBottom: 5 }}>COLLATERAL RESERVED</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#bfe9f2", fontVariantNumeric: "tabular-nums" }}>
            {usd(data.collateralReserved)}
            <span style={{ fontSize: 10, color: "#5b7d8a", marginLeft: 5 }}>/ {usd(data.maxCollateral)}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#8a7340", textTransform: "uppercase", marginBottom: 5 }}>OPEN POSITIONS</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#bfe9f2", fontVariantNumeric: "tabular-nums" }}>
            {data.openCount}
          </div>
        </div>
      </div>

      {/* collateral allocation bar */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, letterSpacing: 2, color: "#8a7340", textTransform: "uppercase", marginBottom: 4 }}>
          <span>COLLATERAL BY UNDERLYING</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{collateralPct.toFixed(0)}% OF CAP</span>
        </div>
        <div style={{ display: "flex", height: 4, background: "rgba(0,0,0,.4)", overflow: "hidden", gap: 1 }}>
          {data.alloc
            .filter((a) => a.pct > 0)
            .map((a) => (
              <div key={a.symbol} style={{ width: `${a.pct * collateralPct}%`, height: "100%", background: SYMBOL_COLOR[a.symbol] ?? "#3fd0e0" }} />
            ))}
        </div>
        {data.collateralReserved === 0 && (
          <div style={{ fontSize: 9, color: "#5b7d8a", marginTop: 5, letterSpacing: 1 }}>NO COLLATERAL DEPLOYED — awaiting first cash-secured put</div>
        )}
      </div>
    </div>
  );
}
