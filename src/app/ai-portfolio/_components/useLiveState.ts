"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Polls /api/ai-portfolio/state/[key] on an interval and returns the latest
 * payload (seeded from `initial` so first paint is instant + SSR-safe).
 * Pauses while the tab is hidden; resumes + refetches on focus.
 */
export function useLiveState<T>(
  stateKey: string,
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
        const res = await fetch(`/api/ai-portfolio/state/${encodeURIComponent(stateKey)}`, {
          cache: "no-store",
        });
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

    // 1s ticker for the "updated Ns ago" label
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
  }, [stateKey, intervalMs]);

  return { state, updatedAt, secsAgo };
}
