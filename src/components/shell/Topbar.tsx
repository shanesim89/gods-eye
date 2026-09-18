"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UserButton, useAuth } from "@clerk/nextjs";

const NAV = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/ai-portfolio", label: "AI Portfolio", match: (p: string) => p.startsWith("/ai-portfolio") },
  { href: "/market-news", label: "News", match: (p: string) => p.startsWith("/market-news") },
  { href: "/indicators", label: "Indicators", match: (p: string) => p.startsWith("/indicators") },
  { href: "/guru", label: "Guru", match: (p: string) => p.startsWith("/guru") },
  { href: "/carousel", label: "Carousel", match: (p: string) => p.startsWith("/carousel") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
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

  return (
    <>
      <div className="bg-bg amber-border-b px-3.5 py-2.5 flex flex-wrap justify-between items-center gap-y-2 text-[11px]">
        <Link
          href="/"
          className="shrink-0 font-semibold text-[13px] tracking-[-0.01em] hover:opacity-80"
          title="Home"
        >
          <span className="text-cyan">◆</span> God&apos;s Eye
        </Link>
        <div className="flex order-3 sm:order-2 w-full sm:w-auto overflow-x-auto bg-panel rounded-[10px] p-[3px] gap-[3px]">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.label}
                href={n.href}
                className={`shrink-0 px-2.5 py-1 rounded-[7px] transition-colors ${
                  active
                    ? "bg-cyan text-bg font-semibold"
                    : "text-dim hover:text-text"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
        <div className="text-dim shrink-0 order-2 sm:order-3 text-[10px] sm:text-[11px] flex items-center gap-3">
          <span className="font-mono">USD · {now || "—"}</span>
          {isLoaded && isSignedIn ? (
            <UserButton />
          ) : isLoaded ? (
            <Link href="/sign-in" className="text-cyan">
              SIGN IN
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
