"use client";
import { ReactNode, useState } from "react";

/**
 * Panel variant with a collapse toggle in the title bar. Mirrors Panel's
 * styling; collapsing hides the body so a sibling in a grid can read wider.
 */
export function CollapsiblePanel({
  title,
  meta,
  children,
  defaultOpen = true,
  className = "",
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`bg-panel border border-border rounded-xl flex flex-col overflow-hidden hud-glow ${className}`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3.5 pt-3 pb-2 flex justify-between items-baseline gap-3 text-[10px] tracking-[1.3px] text-dim uppercase hover:text-text transition-colors text-left"
      >
        <span>
          {open ? "▾" : "▸"} {title}
        </span>
        {meta && <span className="normal-case tracking-normal text-right">{meta}</span>}
      </button>
      {open && <div className="px-3.5 pb-3.5 flex-1 overflow-auto">{children}</div>}
    </div>
  );
}
