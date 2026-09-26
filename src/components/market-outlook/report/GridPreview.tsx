"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// A4 page components render at their fixed natural size (794×1123). This
// wraps 6 of them in a 3×2 grid, measures the available space, and scales
// each page down via CSS transform so all 6 fit on screen with no scroll —
// used for the "see everything at once" preview mode.
const PAGE_W = 794;
const PAGE_H = 1123;
const COLS = 3;
const ROWS = 2;
const GAP = 14;

export function GridPreview({ pages }: { pages: ReactNode[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const cellW = (width - GAP * (COLS - 1)) / COLS;
      const cellH = (height - GAP * (ROWS - 1)) / ROWS;
      const scaleByWidth = cellW / PAGE_W;
      const scaleByHeight = cellH / PAGE_H;
      setScale(Math.min(scaleByWidth, scaleByHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cellW = PAGE_W * scale;
  const cellH = PAGE_H * scale;

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        gap: GAP,
        placeItems: "center",
      }}
    >
      {pages.map((page, i) => (
        <div
          key={i}
          style={{
            width: cellW,
            height: cellH,
            overflow: "hidden",
            boxShadow: "0 10px 28px -12px rgba(0,0,0,0.55)",
            flex: "none",
          }}
        >
          <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            {page}
          </div>
        </div>
      ))}
    </div>
  );
}
