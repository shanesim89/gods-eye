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
    <div className={`bg-panel border border-border flex flex-col overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-black border-b border-border px-2.5 py-1.5 flex justify-between items-center text-[10px] tracking-[1.5px] text-amber uppercase hover:bg-amber/5 transition-colors text-left"
      >
        <span>
          {open ? "▾" : "▸"} {title}
        </span>
        {meta && <span className="text-muted normal-case tracking-normal">{meta}</span>}
      </button>
      {open && <div className="p-3 flex-1 overflow-auto">{children}</div>}
    </div>
  );
}
