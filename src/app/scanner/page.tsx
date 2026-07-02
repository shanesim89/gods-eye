import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { CollapsiblePanel } from "@/components/ui/CollapsiblePanel";
import { getScanResult, getYesterdaySnapshot, type TrendSnapshot } from "@/lib/crypto/scanner";
import { getDipResult, type DipResult } from "@/lib/stocks/dip-bounce";
import { getLeadersResult, type LeaderResult } from "@/lib/stocks/leaders";
import { db } from "@/db/client";
import { users, scanner_watchlist } from "@/db/schema";
import { ScannerTable } from "./ScannerTable";
import { StockScanner } from "./StockScanner";

export const revalidate = 300;
export const maxDuration = 60;

export default async function ScannerPage() {
  let result = null;
  let trends: TrendSnapshot = {};
  let watchlistIds: string[] = [];
  let dip: DipResult | null = null;
  let leaders: LeaderResult | null = null;

  const { userId } = await auth();

  try {
    const fetches: Promise<unknown>[] = [
      getScanResult(false),
      getYesterdaySnapshot(),
      getDipResult(),
      getLeadersResult(),
    ];

    if (userId) {
      fetches.push(
        db.select({ id: users.id }).from(users).where(eq(users.clerk_id, userId)).limit(1)
      );
    }

    const results = await Promise.all(fetches);
    result = results[0] as Awaited<ReturnType<typeof getScanResult>>;
    trends = results[1] as TrendSnapshot;
    dip = results[2] as DipResult | null;
    leaders = results[3] as LeaderResult | null;

    if (userId && results[4]) {
      const userRow = results[4] as { id: string }[];
      if (userRow.length > 0) {
        const wl = await db
          .select({ coin_id: scanner_watchlist.coin_id })
          .from(scanner_watchlist)
          .where(eq(scanner_watchlist.user_id, userRow[0].id));
        watchlistIds = wl.map((r) => r.coin_id);
      }
    }
  } catch {
    result = null;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <CollapsiblePanel
        title="CRYPTO MOONSHOT SCANNER"
        meta="TOP 2000 · COINGECKO · DAILY + ON-DEMAND"
      >
        {result && result.coins.length > 0 ? (
          <ScannerTable initial={result} trends={trends} watchlistIds={watchlistIds} />
        ) : (
          <div className="text-red text-[11px] italic border border-red/40 bg-red/5 p-3">
            ⚠ Scan unavailable — CoinGecko returned no data (rate limit or outage). Try the
            refresh button shortly.
          </div>
        )}

        <div className="border border-border/40 bg-grid p-3 mt-3 text-[10px] text-dim leading-relaxed">
          <span className="text-muted">◎ HOW TO READ</span> — MOONSHOT tab weights deep
          ATH-drawdown recovery + stealth accumulation (days–weeks swing). SCALP tab weights
          volume ignition + price acceleration (hours–days). Scores rank{" "}
          <span className="text-muted">probability of a large move</span>, not certainty —
          speculative tier coins can go to zero. Click any row for the full deep-dive +
          4-agent council verdict before entering. DYOR.
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        title="STOCK SCANNER"
        meta="S&P 500 + NASDAQ 100 · DAILY"
      >
        <StockScanner dip={dip} leaders={leaders} />
      </CollapsiblePanel>
    </div>
  );
}
