import type { PDHLObserving } from "./types";

function px(v: number | null | undefined, dec = 2): string {
  return v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
function breakColor(s?: string): string {
  if (s === "broke_high") return "text-green";
  if (s === "broke_low") return "text-red";
  return "text-dim";
}
function breakLabel(s?: string): string {
  if (s === "broke_high") return "◆ BROKE PDH — awaiting retest";
  if (s === "broke_low") return "◆ BROKE PDL — awaiting retest";
  return "○ IDLE — inside range";
}

/** "What the bot is watching right now." */
export function PDHLObservingPanel({ observing }: { observing?: PDHLObserving }) {
  const o = observing ?? {};
  const has = o.price != null || o.pdh != null;

  return (
    <div className="border border-cyan/30 bg-grid p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-cyan text-[14px] uppercase tracking-[1.5px]">◉ OBSERVING</div>
        <div className="text-[14px] text-dim tabular-nums">
          {(o.symbol ?? "XAU_USD")} · {(o.period ?? "daily")} PDH/PDL · {(o.feed ?? "OANDA")}
        </div>
      </div>

      {has ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[14px]">
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">PRICE</div>
            <div className="text-cyan font-bold tabular-nums text-[19px]">{px(o.price)}</div>
          </div>
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">PDH</div>
            <div className="font-bold tabular-nums text-[19px] text-cyan">{px(o.pdh)}</div>
          </div>
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">PDL</div>
            <div className="font-bold tabular-nums text-[19px] text-red">{px(o.pdl)}</div>
          </div>
          <div className="border border-border bg-bg/40 p-2">
            <div className="text-dim tracking-[1px]">STATE</div>
            <div className="flex flex-col gap-0.5 pt-0.5">
              <span className={`text-[14px] font-bold ${o.session_open ? "text-green" : "text-dim"}`}>
                {o.session_open ? "● SESSION OPEN" : "○ SESSION CLOSED"}
              </span>
              <span className={`text-[14px] uppercase ${breakColor(o.break_state)}`}>
                {breakLabel(o.break_state)}
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
