import { ReactNode } from "react";

export function Panel({
  title,
  meta,
  children,
  className = "",
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-panel border border-border rounded-xl flex flex-col overflow-hidden hud-glow ${className}`}
    >
      <div className="px-3.5 pt-3 pb-2 flex justify-between items-baseline gap-3 text-[10px] tracking-[1.3px] text-dim uppercase">
        <span>{title}</span>
        {meta && <span className="normal-case tracking-normal text-right">{meta}</span>}
      </div>
      <div className="px-3.5 pb-3.5 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
