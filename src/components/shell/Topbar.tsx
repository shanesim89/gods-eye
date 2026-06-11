"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UserButton, useAuth } from "@clerk/nextjs";

const NAV = [
  { href: "/money-map", label: "🏠 HOME", match: (p: string) => p === "/money-map" },
  { href: "/money-map/assets", label: "MONEY MAP", match: (p: string) => p.startsWith("/money-map") && p !== "/money-map" },
  { href: "/guru", label: "GURU", match: (p: string) => p.startsWith("/guru") },
  { href: "/ai-portfolio", label: "AI PORTFOLIO", match: (p: string) => p.startsWith("/ai-portfolio") },
  { href: "/goals", label: "GOALS", match: (p: string) => p.startsWith("/goals") },
  { href: "/settings", label: "SETTINGS", match: (p: string) => p.startsWith("/settings") },
];

const MONEY_SUBS = [
  { href: "/money-map/assets", label: "ASSETS" },
  { href: "/money-map/liabilities", label: "LIABS" },
  { href: "/money-map/income", label: "INCOME" },
  { href: "/money-map/subscriptions", label: "SUBS" },
  { href: "/money-map/cashflow", label: "FIXED/DCA" },
];

function useClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const fmt = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: tz,
    });
    const tzShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || tz;
    const tick = () => {
      const parts = fmt.formatToParts(new Date());
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
      setNow(`${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${tzShort}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Topbar() {
  const pathname = usePathname() ?? "";
  const now = useClock();
  const { isSignedIn, isLoaded } = useAuth();
  const inMoney = pathname.startsWith("/money-map") && pathname !== "/money-map";

  return (
    <>
      <div className="bg-black amber-border-b px-3 py-1.5 flex flex-wrap justify-between items-center gap-y-1 text-[11px]">
        <Link
          href="/money-map"
          className="text-amber font-bold tracking-[2px] shrink-0 hover:opacity-80"
          title="Home"
        >
          ◉ GOD&apos;S EYE / TERMINAL
        </Link>
        <div className="flex order-3 sm:order-2 w-full sm:w-auto overflow-x-auto">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.label}
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
        <div className="text-muted shrink-0 order-2 sm:order-3 text-[10px] sm:text-[11px] flex items-center gap-3">
          <span>BASE: USD · {now || "—"}</span>
          {isLoaded && isSignedIn ? (
            <UserButton />
          ) : isLoaded ? (
            <Link href="/sign-in" className="text-amber">
              SIGN IN
            </Link>
          ) : null}
        </div>
      </div>
      {inMoney && (
        <div className="bg-black border-b border-border px-3 py-1 flex gap-4 text-[10px] overflow-x-auto whitespace-nowrap">
          <Link href="/money-map" className="text-cyan shrink-0 hover:text-amber">
            ← HOME
          </Link>
          {MONEY_SUBS.map((s) => {
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`shrink-0 ${
                  active ? "text-amber" : "text-muted hover:text-text"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
