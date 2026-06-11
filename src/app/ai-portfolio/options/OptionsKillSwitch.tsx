"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function OptionsKillSwitch({ initialKillSwitch }: { initialKillSwitch: boolean }) {
  const [killSwitch, setKillSwitch] = useState(initialKillSwitch);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const armed = !killSwitch;

  async function toggle() {
    const next = !killSwitch;
    setBusy(true);
    try {
      const r = await fetch("/api/ai-portfolio/options/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kill_switch: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setKillSwitch(next);
      startTransition(() => router.refresh());
    } catch {
      setKillSwitch(killSwitch);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || pending}
      className={`px-3 py-1.5 border text-[10px] uppercase tracking-[1px] transition-colors disabled:opacity-50 ${
        armed ? "border-green/60 text-green hover:bg-green/10" : "border-red/60 text-red hover:bg-red/10"
      }`}
      title={armed ? "Options ARMED — click to HALT" : "Options HALTED — click to ARM"}
    >
      {busy || pending ? "…" : armed ? "● ARMED" : "■ HALTED"}
    </button>
  );
}
