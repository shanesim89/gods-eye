"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/money-map", label: "MONEY MAP" },
  { href: "/guru", label: "GURU" },
  { href: "/goals", label: "GOALS" },
  { href: "/settings", label: "SETTINGS" },
];

export function Topbar() {
  const pathname = usePathname();
  const now = "2026-05-25 14:32:08 SGT";
  return (
    <div className="bg-black amber-border-b px-3 py-1.5 flex justify-between items-center text-[11px]">
      <div className="text-amber font-bold tracking-[2px]">
        ◉ GOD&apos;S EYE / TERMINAL
      </div>
      <div className="flex">
        {NAV.map((n) => {
          const active = pathname?.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`mx-2.5 ${
                active ? "text-amber" : "text-muted hover:text-text"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </div>
      <div className="text-muted">USER: SHANE · BASE: USD · {now}</div>
    </div>
  );
}
