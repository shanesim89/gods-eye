"use client";

type FGItem = { value: number; label: string; source?: string; updated?: string } | null;

function fgColor(v: number): string {
  if (v < 25) return "#ef4444";
  if (v < 45) return "#f97316";
  if (v < 55) return "#eab308";
  if (v < 75) return "#84cc16";
  return "#22c55e";
}

function FGMeter({
  value,
  label,
  title,
  sub,
}: {
  value: number;
  label: string;
  title: string;
  sub?: string;
}) {
  const color = fgColor(value);
  return (
    <div className="flex-1 min-w-[160px]">
      <div className="text-muted text-[10px] uppercase tracking-[1px] mb-2">{title}</div>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="text-[32px] font-bold tabular-nums leading-none"
          style={{ color }}
        >
          {value}
        </div>
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wider" style={{ color }}>
            {label}
          </div>
          {sub && <div className="text-[9px] text-dim mt-0.5">{sub}</div>}
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-2 bg-grid border border-border overflow-hidden rounded-sm">
        <div
          className="absolute h-full transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color, opacity: 0.85 }}
        />
      </div>

      {/* Zone markers */}
      <div className="flex justify-between mt-1 text-[8px] text-dim">
        <span>EXTREME FEAR</span>
        <span>NEUTRAL</span>
        <span>EXTREME GREED</span>
      </div>

      {/* Zone pills */}
      <div className="flex gap-0.5 mt-1.5">
        {[
          { lbl: "E.FEAR",  min: 0,  max: 25,  col: "#ef4444" },
          { lbl: "FEAR",    min: 25, max: 45,  col: "#f97316" },
          { lbl: "NEUT",    min: 45, max: 55,  col: "#eab308" },
          { lbl: "GREED",   min: 55, max: 75,  col: "#84cc16" },
          { lbl: "E.GREED", min: 75, max: 100, col: "#22c55e" },
        ].map((z) => {
          const active = value > z.min && value <= z.max;
          return (
            <div
              key={z.lbl}
              className="flex-1 h-1 rounded-sm"
              style={{ background: z.col, opacity: active ? 1 : 0.2 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function FearGreedBar({
  crypto,
  stocks,
}: {
  crypto: FGItem;
  stocks: FGItem;
}) {
  if (!crypto && !stocks) {
    return (
      <div className="text-dim text-[10px] italic">fear &amp; greed data unavailable</div>
    );
  }

  return (
    <div>
      <div className="text-muted text-[10px] uppercase tracking-[1px] mb-3">
        ◉ FEAR &amp; GREED INDEX
      </div>
      <div className="flex flex-col sm:flex-row gap-6">
        {crypto && (
          <FGMeter
            value={crypto.value}
            label={crypto.label}
            title="Crypto Market"
            sub="source: alternative.me · daily"
          />
        )}
        {stocks && (
          <FGMeter
            value={stocks.value}
            label={stocks.label}
            title="Equity Market"
            sub={`source: ${stocks.source ?? "VIXY proxy"}`}
          />
        )}
      </div>
      <div className="mt-3 text-[9px] text-dim leading-relaxed">
        <span className="text-muted">What to watch:</span> Extreme Fear (&lt;25) → potential buy zones, oversold.
        Extreme Greed (&gt;75) → caution, overbought, higher correction risk.
        Divergence between crypto &amp; equity = rotation opportunity or decoupling signal.
      </div>
    </div>
  );
}
