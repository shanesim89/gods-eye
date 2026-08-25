import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ai_trade_orders, ai_trading_settings } from "@/db/schema";
import { getBotOverview } from "@/lib/ai-portfolio/overview";
import { formatPortfolioDigest } from "@/lib/trading/portfolio-digest-format";

type CryptoDigestContext = {
  monthlyCap: number;
  monthlySpent: number;
  recentBuys: {
    token: string;
    usdAmount: number;
    price: number | null;
    createdAt: Date;
  }[];
};

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

async function getCryptoDigestContext(userId: string): Promise<CryptoDigestContext> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [settingsRows, spentRows, recentRows] = await Promise.all([
    db
      .select({ monthlyCap: ai_trading_settings.monthly_cap_usd })
      .from(ai_trading_settings)
      .where(eq(ai_trading_settings.user_id, userId))
      .limit(1),
    db
      .select({ total: sql<string>`coalesce(sum(${ai_trade_orders.usd_amount}), 0)` })
      .from(ai_trade_orders)
      .where(and(
        eq(ai_trade_orders.user_id, userId),
        eq(ai_trade_orders.status, "filled"),
        gte(ai_trade_orders.created_at, monthStart),
      )),
    db
      .select({
        token: ai_trade_orders.token,
        usdAmount: ai_trade_orders.usd_amount,
        price: ai_trade_orders.price,
        createdAt: ai_trade_orders.created_at,
      })
      .from(ai_trade_orders)
      .where(and(
        eq(ai_trade_orders.user_id, userId),
        eq(ai_trade_orders.status, "filled"),
        gte(ai_trade_orders.created_at, weekAgo),
      ))
      .orderBy(desc(ai_trade_orders.created_at))
      .limit(8),
  ]);

  return {
    monthlyCap: parseFloat(settingsRows[0]?.monthlyCap ?? "1300"),
    monthlySpent: parseFloat(spentRows[0]?.total ?? "0"),
    recentBuys: recentRows.map((row) => ({
      token: row.token,
      usdAmount: parseFloat(row.usdAmount),
      price: row.price == null ? null : parseFloat(row.price),
      createdAt: row.createdAt,
    })),
  };
}

function cryptoDigestLines(context: CryptoDigestContext): string[] {
  const lines = [
    `Monthly cap: ${usd(context.monthlySpent)} / ${usd(context.monthlyCap)} used`,
  ];
  if (context.recentBuys.length === 0) {
    lines.push("No buys this week");
    return lines;
  }

  lines.push("Last buys (7d):");
  for (const buy of context.recentBuys) {
    const day = buy.createdAt.toLocaleDateString("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const price = buy.price == null ? "" : ` @ ${usd(buy.price)}`;
    lines.push(`· ${buy.token} ${usd(buy.usdAmount)}${price} (${day})`);
  }
  return lines;
}

export async function buildPortfolioDigest(userId: string): Promise<string> {
  const [bots, cryptoContext] = await Promise.all([
    getBotOverview(userId),
    getCryptoDigestContext(userId),
  ]);
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return formatPortfolioDigest(bots, dateStr, {
    liveLines: { crypto: cryptoDigestLines(cryptoContext) },
  });
}
