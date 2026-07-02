import type { Observing } from "./types";

function px(v: number | null | undefined, dec = 2): string {
  return v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
function regimeColor(r?: string): string {
  if (r === "trending" || r === "crisis") return "text-red";
  if (r === "ranging") return "text-green"; // ranging = the regime the fade wants
  return "text-dim";
}
function stretchColor(s: number | null | undefined): string {
  if (s == null) return "text-dim";
  const a = Math.abs(s);
  if (a >= 3) return "text-red"; // extreme — a fade is armed
  if (a >= 2) return "text-amber";
  return "text-muted";
}

/** "What the bot is watching right now." */
export function ObservingPanel({ observing }: { observing?: Observing }) {
  const o = observing ?? {};
  const has = o.price != null || o.vwap != null;

  return (
    <div className="border border-cyan/30 bg-grid p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-cyan text-[14px] uppercase tracking-[1.5px]">◉ OBSERVING</div>
        <div className="text-[14px] text-dim tabular-nums">
          {(o.symbol ?? "XAU_USD")} · {(o.timeframe ?? "1m")} · {(o.feed ?? "OANDA")}
        </div>
      </div>

      {has ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[14px]">
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">PRICE</div>
            <div className="text-cyan font-bold tabular-nums text-[19px]">{px(o.price)}</div>
          </div>
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">SESSION VWAP</div>
            <div className="text-amber font-bold tabular-nums text-[19px]">{px(o.vwap)}</div>
          </div>
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">STRETCH</div>
            <div className={`font-bold tabular-nums text-[19px] ${stretchColor(o.stretch)}`}>
              {o.stretch == null ? "—" : `${o.stretch > 0 ? "+" : ""}${o.stretch.toFixed(2)}σ`}
            </div>
          </div>
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">STATE</div>
            <div className="flex flex-col gap-0.5 pt-0.5">
              <span className={`text-[14px] font-bold ${o.session_open ? "text-green" : "text-dim"}`}>
                {o.session_open ? "● SESSION OPEN" : "○ SESSION CLOSED"}
              </span>
              <span className={`text-[14px] uppercase ${regimeColor(o.regime)}`}>
                {o.regime ?? "unknown"}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-dim text-[14px] italic py-2">
          Awaiting first publish — the paper bot fills this once it processes a live 1m bar.
        </div>
      )}
    </div>
  );
}
