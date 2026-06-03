import type { YahooSummary } from "@/lib/yahoo";

type Props = {
  summary: YahooSummary | null;
  price: number;
  currency: string;       // ISO code
  currencySymbol: string; // e.g. "$" / "S$"
};

function n(v: number | null | undefined, dec = 2, prefix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${prefix}${v.toFixed(dec)}`;
}

function ratingColor(key: string | null): string {
  switch ((key ?? "").toLowerCase()) {
    case "strong_buy":
    case "buy":
      return "text-green";
    case "sell":
    case "strong_sell":
    case "underperform":
      return "text-red";
    default:
      return "text-amber";
  }
}

function ratingLabel(key: string | null, mean: number | null): string {
  if (key) return key.replace(/_/g, " ").toUpperCase();
  if (mean != null) {
    if (mean <= 1.5) return "STRONG BUY";
    if (mean <= 2.5) return "BUY";
    if (mean <= 3.5) return "HOLD";
    if (mean <= 4.5) return "SELL";
    return "STRONG SELL";
  }
  return "—";
}

export function AnalystCard({ summary, price, currency, currencySymbol: cur }: Props) {
  if (!summary) return null;
  const hasTarget = summary.targetMeanPrice != null;
  const hasRating =
    summary.recommendationKey != null ||
    summary.recommendationMean != null ||
    summary.numberOfAnalystOpinions != null;
  if (!hasTarget && !hasRating) return null;

  const upside =
    hasTarget && price > 0 && summary.targetMeanPrice != null
      ? ((summary.targetMeanPrice - price) / price) * 100
      : null;
  const upsideClr = upside == null ? "text-muted" : upside >= 0 ? "text-green" : "text-red";

  const trend = summary.recommendationTrend?.[0] ?? null;
  const totalVotes = trend
    ? trend.strongBuy + trend.buy + trend.hold + trend.sell + trend.strongSell
    : 0;
  const seg = (votes: number): string =>
    totalVotes > 0 ? `${(votes / totalVotes) * 100}%` : "0%";

  return (
    <div className="border border-border bg-grid p-3 mb-3">
      <div className="text-muted text-[10px] mb-3 uppercase tracking-[1px]">
        ANALYST CONSENSUS{summary.numberOfAnalystOpinions != null ? ` · ${summary.numberOfAnalystOpinions} ANALYSTS` : ""}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        {hasTarget && (
          <>
            <div>
              <div className="text-muted uppercase tracking-[0.5px] text-[9px]">TARGET LOW</div>
              <div className="text-amber tabular-nums">{n(summary.targetLowPrice, 2, cur)}</div>
            </div>
            <div>
              <div className="text-muted uppercase tracking-[0.5px] text-[9px]">TARGET MEAN</div>
              <div className="text-amber tabular-nums font-bold">{n(summary.targetMeanPrice, 2, cur)}</div>
            </div>
            <div>
              <div className="text-muted uppercase tracking-[0.5px] text-[9px]">TARGET HIGH</div>
              <div className="text-amber tabular-nums">{n(summary.targetHighPrice, 2, cur)}</div>
            </div>
            <div>
              <div className="text-muted uppercase tracking-[0.5px] text-[9px]">UPSIDE</div>
              <div className={`tabular-nums ${upsideClr}`}>
                {upside == null ? "—" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`}
              </div>
            </div>
          </>
        )}
      </div>

      {hasRating && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`text-[14px] font-bold ${ratingColor(summary.recommendationKey)}`}>
              {ratingLabel(summary.recommendationKey, summary.recommendationMean)}
            </div>
            {summary.recommendationMean != null && (
              <div className="text-[10px] text-dim">
                mean {summary.recommendationMean.toFixed(2)} <span className="text-muted">(1=Strong Buy ... 5=Sell)</span>
              </div>
            )}
            <div className="text-[10px] text-dim">{currency}</div>
          </div>

          {trend && totalVotes > 0 && (
            <div className="mt-2">
              <div className="flex h-2 w-full overflow-hidden border border-border">
                <div className="bg-green" style={{ width: seg(trend.strongBuy) }} title={`Strong Buy ${trend.strongBuy}`} />
                <div className="bg-green/60" style={{ width: seg(trend.buy) }} title={`Buy ${trend.buy}`} />
                <div className="bg-amber/70" style={{ width: seg(trend.hold) }} title={`Hold ${trend.hold}`} />
                <div className="bg-red/60" style={{ width: seg(trend.sell) }} title={`Sell ${trend.sell}`} />
                <div className="bg-red" style={{ width: seg(trend.strongSell) }} title={`Strong Sell ${trend.strongSell}`} />
              </div>
              <div className="mt-1.5 grid grid-cols-5 gap-1 text-[9px] text-dim text-center tabular-nums">
                <div>SB {trend.strongBuy}</div>
                <div>B {trend.buy}</div>
                <div>H {trend.hold}</div>
                <div>S {trend.sell}</div>
                <div>SS {trend.strongSell}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
