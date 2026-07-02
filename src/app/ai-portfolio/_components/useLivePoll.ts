"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Polls an arbitrary GET endpoint returning { payload, fetched_at } on an
 * interval (seeded from `initial` for instant + SSR-safe first paint).
 * Same shape as useLiveState but for routes that aren't a market_data_cache
 * key lookup (e.g. live-computed dashboards backed by several DB tables).
 * Pauses while the tab is hidden; resumes + refetches on focus.
 */
export function useLivePoll<T>(
  url: string,
  initial: T,
  intervalMs = 20_000,
): { state: T; updatedAt: Date | null; secsAgo: number } {
  const [state, setState] = useState<T>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [secsAgo, setSecsAgo] = useState(0);
  const updatedRef = useRef<Date | null>(null);

  useEffect(() => {
    let alive = true;

    async function poll() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { payload: T | null; fetched_at: string | null };
        if (!alive || body.payload == null) return;
        setState(body.payload);
        const d = body.fetched_at ? new Date(body.fetched_at) : new Date();
        updatedRef.current = d;
        setUpdatedAt(d);
      } catch {
        // transient — keep last good state
      }
    }

    poll();
    const pollId = setInterval(poll, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);

    const tickId = setInterval(() => {
      if (updatedRef.current) {
        setSecsAgo(Math.max(0, Math.round((Date.now() - updatedRef.current.getTime()) / 1000)));
      }
    }, 1_000);

    return () => {
      alive = false;
      clearInterval(pollId);
      clearInterval(tickId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [url, intervalMs]);

  return { state, updatedAt, secsAgo };
}
