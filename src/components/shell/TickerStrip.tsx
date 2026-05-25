const TICKERS = [
  { sym: "SPX", val: "5,847.32", chg: "▲ 0.42%", dir: "up" },
  { sym: "NDX", val: "20,512.88", chg: "▲ 0.78%", dir: "up" },
  { sym: "BTC", val: "98,450", chg: "▼ 1.24%", dir: "down" },
  { sym: "ETH", val: "3,820", chg: "▲ 0.31%", dir: "up" },
  { sym: "USD/SGD", val: "1.3421", chg: "▼ 0.08%", dir: "down" },
  { sym: "VIX", val: "14.82", chg: "▲ 2.10%", dir: "up" },
] as const;

export function TickerStrip() {
  return (
    <div className="bg-black border-b border-border px-3 py-1 flex gap-7 text-[11px] overflow-x-auto whitespace-nowrap">
      {TICKERS.map((t) => (
        <div key={t.sym} className="inline-flex gap-1.5">
          <span className="text-text">{t.sym}</span>
          <span className={t.dir === "up" ? "text-green" : "text-red"}>
            {t.val} {t.chg}
          </span>
        </div>
      ))}
    </div>
  );
}
