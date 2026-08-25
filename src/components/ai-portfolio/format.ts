// Shared formatting helpers for the all-bots dashboard.

export function usd(v: number | null | undefined, dec = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function signedUsd(v: number | null | undefined, dec = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "-"}${usd(Math.abs(v), dec)}`;
}

export function pct(v: number | null | undefined, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dec)}%`;
}

/** Compact relative time, e.g. "3m", "2h", "4d", or "—". */
export function rel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

export const toneColor: Record<string, string> = {
  buy: "text-green",
  sell: "text-red",
  skip: "text-muted",
  info: "text-muted",
  error: "text-red",
};

export const healthColor: Record<string, string> = {
  ok: "text-green",
  warn: "text-amber",
  halt: "text-red",
  stale: "text-red",
  off: "text-dim",
};

export const healthDot: Record<string, string> = {
  ok: "bg-green",
  warn: "bg-amber",
  halt: "bg-red",
  stale: "bg-red",
  off: "bg-dim",
};
