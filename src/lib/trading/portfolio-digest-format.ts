import type { BotStatus } from "@/lib/ai-portfolio/overview";

function usd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

function signedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function healthLine(bot: BotStatus): string | null {
  if (bot.health === "ok") return null;
  const note = bot.healthNote ? ` — ${bot.healthNote}` : "";
  return `Status: ${bot.health.toUpperCase()}${note}`;
}

function formatLiveBot(bot: BotStatus): string[] {
  const lines = [`🟢 LIVE: ${bot.label}`];
  lines.push(`${bot.valueLabel}: ${usd(bot.equityOrValue)}`);
  if (bot.pnl != null) {
    lines.push(`Total P&L: ${signedUsd(bot.pnl)}${bot.pnlPct == null ? "" : ` (${pct(bot.pnlPct)})`}`);
  }
  if (bot.holdings.length > 0) {
    lines.push("Holdings:");
    for (const holding of bot.holdings) {
      const detail = [holding.detail, holding.value == null ? null : usd(holding.value)]
        .filter(Boolean)
        .join(" · ");
      lines.push(`· ${holding.label}${detail ? ` · ${detail}` : ""}`);
    }
  } else {
    lines.push(bot.fallbackNote ?? "No holdings");
  }
  const status = healthLine(bot);
  if (status) lines.push(status);
  return lines;
}

function formatPaperBot(bot: BotStatus): string[] {
  const lines = [`📝 PAPER: ${bot.label}`];
  lines.push(`${bot.valueLabel}: ${usd(bot.equityOrValue)}`);
  if (bot.pnl != null) {
    lines.push(`Paper P&L: ${signedUsd(bot.pnl)}${bot.pnlPct == null ? "" : ` (${pct(bot.pnlPct)})`}`);
  }
  if (bot.openPositions != null) {
    lines.push(`Open positions: ${bot.openPositions}`);
  }
  if (bot.holdings.length > 0) {
    for (const holding of bot.holdings) {
      lines.push(`· ${holding.label} · ${holding.detail}`);
    }
  } else if (bot.fallbackNote) {
    lines.push(bot.fallbackNote);
  }
  const status = healthLine(bot);
  if (status) lines.push(status);
  return lines;
}

export type PortfolioDigestContext = {
  liveLines?: Partial<Record<BotStatus["key"], string[]>>;
};

export function formatPortfolioDigest(
  bots: BotStatus[],
  dateStr: string,
  context: PortfolioDigestContext = {},
): string {
  const lines = [
    `📊 PORTFOLIO UPDATES — ${dateStr}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  for (const bot of bots) {
    lines.push("");
    lines.push(...(bot.mode === "LIVE" ? formatLiveBot(bot) : formatPaperBot(bot)));
    const extra = context.liveLines?.[bot.key];
    if (extra) lines.push(...extra);
  }

  return lines.join("\n");
}
