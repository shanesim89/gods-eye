export function fmtMoney(n: number, currency = "USD", maxFrac = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: maxFrac,
  }).format(n);
}

export function fmtPct(n: number, frac = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(frac)}%`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function daysUntil(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = date.getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  return `${days}d`;
}

/** Normalize a subscription/expense cycle to monthly cost. */
export function toMonthly(amount: number, cycle: string): number {
  switch (cycle.toLowerCase()) {
    case "monthly":
    case "mo":
    case "month":
      return amount;
    case "yearly":
    case "yr":
    case "year":
    case "annual":
      return amount / 12;
    case "weekly":
    case "wk":
    case "week":
      return amount * 52 / 12;
    case "daily":
    case "day":
      return amount * 365 / 12;
    case "quarterly":
    case "qtr":
      return amount / 3;
    default:
      return amount;
  }
}
