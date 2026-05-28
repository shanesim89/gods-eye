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

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
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
