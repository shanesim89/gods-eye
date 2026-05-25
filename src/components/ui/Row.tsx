import { ReactNode } from "react";

export function Row({
  k,
  v,
  tone = "text",
}: {
  k: string;
  v: ReactNode;
  tone?: "text" | "green" | "red" | "amber" | "cyan" | "muted";
}) {
  const toneCls = {
    text: "text-text",
    green: "text-green",
    red: "text-red",
    amber: "text-amber",
    cyan: "text-cyan",
    muted: "text-muted",
  }[tone];
  return (
    <div className="flex justify-between py-1 dotted-row text-[11px]">
      <span className="text-muted uppercase tracking-[0.5px]">{k}</span>
      <span className={toneCls}>{v}</span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-cyan text-[10px] tracking-[1.5px] uppercase mt-2.5 mb-1.5">
      ▸ {children}
    </div>
  );
}
