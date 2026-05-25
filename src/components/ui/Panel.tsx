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
      className={`bg-panel border border-border flex flex-col overflow-hidden ${className}`}
    >
      <div className="bg-black border-b border-border px-2.5 py-1.5 flex justify-between items-center text-[10px] tracking-[1.5px] text-amber uppercase">
        <span>◢ {title}</span>
        {meta && <span className="text-muted normal-case tracking-normal">{meta}</span>}
      </div>
      <div className="p-3 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
