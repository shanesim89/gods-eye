"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshBtn() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => {
    setMsg(null);
    start(async () => {
      try {
        const r = await fetch("/api/refresh-prices", { method: "POST" });
        if (!r.ok) {
          const j = await r.json().catch(() => null);
          setMsg(`error: ${j?.error ?? r.statusText}`);
          return;
        }
        const j = (await r.json()) as { refreshed: number; skipped: number; failed: number; total: number };
        setMsg(`✓ refreshed ${j.refreshed}/${j.total} · skipped ${j.skipped} · failed ${j.failed}`);
        router.refresh();
      } catch (e) {
        setMsg(`error: ${e instanceof Error ? e.message : "unknown"}`);
      }
    });
  };

  return (
    <div className="flex items-center gap-3 mb-3">
      <button
        onClick={refresh}
        disabled={pending}
        className="bg-amber text-black px-3 py-1 text-[11px] font-bold tracking-wider disabled:opacity-50"
      >
        {pending ? "REFRESHING…" : "↻ REFRESH PRICES"}
      </button>
      {msg && (
        <span className={`text-[10px] ${msg.startsWith("✓") ? "text-green" : "text-red"}`}>
          {msg}
        </span>
      )}
    </div>
  );
}
