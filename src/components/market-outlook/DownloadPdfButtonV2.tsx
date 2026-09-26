"use client";
// Exports the actual rendered report DOM (not a react-pdf reimplementation) —
// the v2 design uses gradients, a photo scrim and custom serif/sans fonts that
// react-pdf's Yoga-based renderer can't reproduce faithfully. html2canvas
// snapshots each A4 page at its real 794x1123 layout size, then jsPDF stitches
// the snapshots into a multi-page PDF.
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const PAGE_W = 794;
const PAGE_H = 1123;

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
    )
  ).then(() => undefined);
}

export function DownloadPdfButtonV2({
  pages,
  filenamePrefix = "market-outlook",
}: {
  pages: ReactNode[];
  filenamePrefix?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      // Mount the stage, let React paint it, then grab the node.
      const stage = document.createElement("div");
      stage.style.position = "fixed";
      stage.style.left = "-99999px";
      stage.style.top = "0";
      stage.style.width = `${PAGE_W}px`;
      document.body.appendChild(stage);
      setStageEl(stage);
      // Two rAFs: one for React to commit the portal, one for layout/paint.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await waitForImages(stage);
      // Fonts (Source Serif 4 / Public Sans / JetBrains Mono) may still be swapping in.
      if (document.fonts?.ready) await document.fonts.ready;

      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [PAGE_W, PAGE_H], hotfixes: ["px_scaling"] });
      const pageNodes = Array.from(stage.children) as HTMLElement[];
      for (let i = 0; i < pageNodes.length; i++) {
        const canvas = await html2canvas(pageNodes[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        if (i > 0) pdf.addPage([PAGE_W, PAGE_H], "portrait");
        pdf.addImage(imgData, "JPEG", 0, 0, PAGE_W, PAGE_H);
      }

      document.body.removeChild(stage);
      setStageEl(null);

      const date = new Date().toISOString().slice(0, 10);
      pdf.save(`${filenamePrefix}-${date}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={download}
        disabled={busy}
        style={{
          padding: "10px 14px",
          background: busy ? "#2b333d" : "transparent",
          color: busy ? "#8093a1" : "#4fc7be",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: 1,
          border: "1px solid #4fc7be",
          borderRadius: 3,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "GENERATING PDF…" : "DOWNLOAD PDF"}
      </button>
      {error && <div style={{ color: "#e08a80", fontSize: 11 }}>{error}</div>}
      {stageEl &&
        createPortal(
          <>
            {pages.map((p, i) => (
              <div key={i} style={{ width: PAGE_W, height: PAGE_H, overflow: "hidden" }}>
                {p}
              </div>
            ))}
          </>,
          stageEl
        )}
    </>
  );
}
