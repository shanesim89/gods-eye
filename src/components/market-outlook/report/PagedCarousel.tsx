"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Shows report pages two at a time (A4 pages side by side), scaled to fill
// the available space, with prev/next navigation + dot indicators to step
// through all pairs.
const PAGE_W = 794;
const PAGE_H = 1123;
const PER_VIEW = 2;
const GAP = 20;

export function PagedCarousel({ pages, labels }: { pages: ReactNode[]; labels?: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [pairIndex, setPairIndex] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const cellW = (width - GAP * (PER_VIEW - 1)) / PER_VIEW;
      const scaleByWidth = cellW / PAGE_W;
      const scaleByHeight = height / PAGE_H;
      setScale(Math.min(scaleByWidth, scaleByHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pairs: ReactNode[][] = [];
  for (let i = 0; i < pages.length; i += PER_VIEW) pairs.push(pages.slice(i, i + PER_VIEW));
  const lastIndex = pairs.length - 1;

  const cellW = PAGE_W * scale;
  const cellH = PAGE_H * scale;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <button
          aria-label="Previous"
          onClick={() => setPairIndex((i) => Math.max(0, i - 1))}
          disabled={pairIndex === 0}
          style={navBtnStyle("left")}
        >
          ‹
        </button>

        <div style={{ display: "flex", gap: GAP }}>
          {pairs[pairIndex].map((page, i) => (
            <div
              key={i}
              style={{
                width: cellW,
                height: cellH,
                overflow: "hidden",
                boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
                flex: "none",
              }}
            >
              <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                {page}
              </div>
            </div>
          ))}
        </div>

        <button
          aria-label="Next"
          onClick={() => setPairIndex((i) => Math.min(lastIndex, i + 1))}
          disabled={pairIndex === lastIndex}
          style={navBtnStyle("right")}
        >
          ›
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, padding: "14px 0 4px" }}>
        {pairs.map((_, i) => (
          <button
            key={i}
            aria-label={`Go to pages ${i * PER_VIEW + 1}-${Math.min(pages.length, i * PER_VIEW + PER_VIEW)}`}
            onClick={() => setPairIndex(i)}
            style={{
              width: i === pairIndex ? 22 : 7,
              height: 7,
              borderRadius: 4,
              border: "none",
              background: i === pairIndex ? "#4fc7be" : "#465262",
              cursor: "pointer",
              transition: "all 0.15s",
              padding: 0,
            }}
          />
        ))}
      </div>
      {labels && (
        <div style={{ textAlign: "center", fontSize: 11, color: "#8093a1", fontFamily: "monospace", letterSpacing: 1 }}>
          {labels.slice(pairIndex * PER_VIEW, pairIndex * PER_VIEW + PER_VIEW).join("  ·  ")}
        </div>
      )}
    </div>
  );
}

function navBtnStyle(side: "left" | "right"): React.CSSProperties {
  return {
    position: "absolute",
    [side]: 4,
    top: "50%",
    transform: "translateY(-50%)",
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "1px solid #3a4552",
    background: "#1a2129",
    color: "#e7edf3",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    zIndex: 2,
    opacity: 0.9,
  };
}
