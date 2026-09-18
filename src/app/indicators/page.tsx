import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getYahooData, type YahooData } from "@/lib/yahoo";
import { getFearGreed } from "@/lib/market-overview";

export const revalidate = 900;

type Spec = { symbol: string; label: string; unit?: "pct" };

const GROUPS: { title: string; specs: Spec[] }[] = [
  {
    title: "Equity indices",
    specs: [
      { symbol: "^GSPC", label: "S&P 500" },
      { symbol: "^IXIC", label: "Nasdaq Composite" },
      { symbol: "^DJI", label: "Dow Jones" },
      { symbol: "^RUT", label: "Russell 2000" },
      { symbol: "^STOXX50E", label: "Euro Stoxx 50" },
    ],
  },
  {
    title: "Rates & dollar",
    specs: [
      { symbol: "^TNX", label: "US 10Y yield", unit: "pct" },
      { symbol: "^FVX", label: "US 5Y yield", unit: "pct" },
      { symbol: "^IRX", label: "US 13W bill", unit: "pct" },
      { symbol: "DX-Y.NYB", label: "Dollar index" },
      { symbol: "EURUSD=X", label: "EUR / USD" },
    ],
  },
  {
    title: "Commodities",
    specs: [
      { symbol: "GC=F", label: "Gold" },
      { symbol: "SI=F", label: "Silver" },
      { symbol: "CL=F", label: "Crude WTI" },
      { symbol: "NG=F", label: "Natural gas" },
      { symbol: "HG=F", label: "Copper" },
    ],
  },
  {
    title: "Risk & crypto",
    specs: [
      { symbol: "^VIX", label: "VIX" },
      { symbol: "^VVIX", label: "VVIX" },
      { symbol: "BTC-USD", label: "Bitcoin" },
      { symbol: "ETH-USD", label: "Ethereum" },
    ],
  },
];

function fmtLevel(v: number, unit?: "pct"): string {
  if (unit === "pct") return `${v.toFixed(2)}%`;
  const frac = v >= 1000 ? 0 : v >= 10 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

/** Where today's price sits inside the 52-week range, 0–100. */
function rangePos(d: YahooData): number | null {
  const { week52Low: lo, week52High: hi, price } = d;
  if (lo == null || hi == null || hi <= lo) return null;
  return Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100));
}

function Row({ spec, data }: { spec: Spec; data: YahooData | null }) {
  if (!data) {
    return (
      <div className="dotted-row py-2 last:border-0 flex justify-between items-baseline">
        <span className="text-[12px]">{spec.label}</span>
        <span className="text-dim text-[11px] font-mono">unavailable</span>
      </div>
    );
  }
  const up = data.changePct >= 0;
  const pos = rangePos(data);

  return (
    <div className="dotted-row py-2 last:border-0">
      <div className="flex justify-between items-baseline gap-3">
        <span className="text-[12px]">{spec.label}</span>
        <span className="font-mono text-[12px] flex gap-2.5 items-baseline">
          <span>{fmtLevel(data.price, spec.unit)}</span>
          <span className={`${up ? "text-green" : "text-red"} text-[11px]`}>
            {up ? "+" : ""}
            {data.changePct.toFixed(2)}%
          </span>
        </span>
      </div>
      {pos != null && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 bg-grid rounded-full relative overflow-hidden">
            <div
              className="absolute top-0 bottom-0 w-[3px] bg-cyan rounded-full"
              style={{ left: `calc(${pos}% - 1.5px)` }}
            />
          </div>
          <span className="text-dim text-[9px] font-mono shrink-0">{pos.toFixed(0)}% of 52w</span>
        </div>
      )}
    </div>
  );
}

function Gauge({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex-1 min-w-[110px]">
      <div className="text-dim text-[10px] uppercase tracking-[1px]">{label}</div>
      <div className="text-[22px] font-semibold font-mono leading-tight mt-0.5">{value}</div>
      <div className="text-[11px] text-muted">{tone}</div>
      <div className="h-1 bg-grid rounded-full mt-1.5 relative overflow-hidden">
        <div
          className="absolute top-0 bottom-0 w-[3px] bg-cyan rounded-full"
          style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 1.5px)` }}
        />
      </div>
    </div>
  );
}

export default async function IndicatorsPage() {
  await requireUser();

  const specs = GROUPS.flatMap((g) => g.specs);
  const [quotes, fg] = await Promise.all([
    Promise.all(specs.map((s) => getYahooData(s.symbol))),
    getFearGreed(),
  ]);
  const bySymbol = new Map(specs.map((s, i) => [s.symbol, quotes[i]]));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
      <div className="lg:col-span-2">
        <Panel title="Sentiment" meta="fear & greed">
          <div className="flex flex-wrap gap-6 py-1">
            {fg.stocks && <Gauge label="Stocks" value={fg.stocks.value} tone={fg.stocks.label} />}
            {fg.crypto && <Gauge label="Crypto" value={fg.crypto.value} tone={fg.crypto.label} />}
            {!fg.stocks && !fg.crypto && (
              <div className="text-dim text-[11.5px] py-3">Sentiment feed unavailable.</div>
            )}
          </div>
        </Panel>
      </div>

      {GROUPS.map((g) => (
        <Panel key={g.title} title={g.title} meta="last · Δ day · 52w position">
          {g.specs.map((s) => (
            <Row key={s.symbol} spec={s} data={bySymbol.get(s.symbol) ?? null} />
          ))}
        </Panel>
      ))}
    </div>
  );
}
