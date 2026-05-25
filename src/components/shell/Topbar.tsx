"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/money-map", label: "MONEY MAP" },
  { href: "/guru", label: "GURU" },
  { href: "/goals", label: "GOALS" },
  { href: "/settings", label: "SETTINGS" },
];

function useClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const iso = d.toISOString().replace("T", " ").slice(0, 19);
      setNow(`${iso} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Topbar() {
  const pathname = usePathname();
  const now = useClock();
  return (
    <div className="bg-black amber-border-b px-3 py-1.5 flex flex-wrap justify-between items-center gap-y-1 text-[11px]">
      <div className="text-amber font-bold tracking-[2px] shrink-0">
        ◉ GOD&apos;S EYE / TERMINAL
      </div>
      <div className="flex order-3 sm:order-2 w-full sm:w-auto overflow-x-auto">
        {NAV.map((n) => {
          const active = pathname?.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`mx-2.5 shrink-0 ${
                active ? "text-amber" : "text-muted hover:text-text"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </div>
      <div className="text-muted shrink-0 order-2 sm:order-3 text-[10px] sm:text-[11px]">
        USER: SHANE · BASE: USD · {now || "—"}
      </div>
    </div>
  );
}
