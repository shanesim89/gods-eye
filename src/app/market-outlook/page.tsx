"use client";

import { useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";

type OutlookSection = { heading: string; body: string };
type OutlookStat = { label: string; value: string };
type SourceRef = { source: string; url: string; title: string };
type Result = {
  digest: { overview: string; keyStats: OutlookStat[]; articleSections: OutlookSection[]; whatsappText: string };
  sources: SourceRef[];
  skipped: string[];
};

export default function MarketOutlookPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/market-outlook/generate", { method: "POST" });
      const json = await r.json();
      if (!r.ok) {
        setError(json.error ?? "Generate failed.");
        return;
      }
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyWhatsapp() {
    if (!result?.digest.whatsappText) return;
    await navigator.clipboard.writeText(result.digest.whatsappText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadPdf() {
    if (!articleRef.current) return;
    setDownloading(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas-pro"),
      ]);
      const canvas = await html2canvas(articleRef.current, { scale: 2 });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let remaining = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      remaining -= pageHeight;
      while (remaining > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        remaining -= pageHeight;
      }
      pdf.save("market-outlook.pdf");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2.5">
      <Panel title="Market outlook digest" meta={result ? `${result.sources.length}/${result.sources.length + result.skipped.length} sources` : undefined}>
        <div className="flex items-center gap-3 py-2">
          <button
            onClick={generate}
            disabled={loading}
            className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.5px] bg-cyan/10 border border-cyan/40 text-cyan rounded hover:bg-cyan/20 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate"}
          </button>
          {result && (
            <button
              onClick={downloadPdf}
              disabled={downloading}
              className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.5px] bg-panel border border-border text-muted rounded hover:text-white disabled:opacity-50"
            >
              {downloading ? "Building PDF…" : "Download PDF"}
            </button>
          )}
          {error && <span className="text-red text-[12px]">{error}</span>}
        </div>

        {result?.skipped && result.skipped.length > 0 && (
          <div className="text-dim text-[11px] mb-2">Skipped (unreachable/gated): {result.skipped.join(", ")}</div>
        )}
      </Panel>

      {result && (
        <>
          <Panel title="Overview">
            <p className="text-[13px] leading-relaxed">{result.digest.overview}</p>
          </Panel>

          <Panel title="WhatsApp update">
            <div className="flex flex-col gap-2">
              <pre className="whitespace-pre-wrap text-[12px] bg-grid border border-border p-3 rounded">
                {result.digest.whatsappText}
              </pre>
              <button
                onClick={copyWhatsapp}
                className="self-start px-3 py-1 text-[11px] uppercase tracking-[0.5px] bg-panel border border-border text-muted rounded hover:text-white"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          </Panel>

          <Panel title="Branded article">
            <div ref={articleRef} className="bg-white text-black p-8" style={{ minHeight: 600 }}>
              <div className="flex items-center gap-3 border-b-2 border-black pb-4 mb-6">
                <img src="/brand-logo.png" alt="" className="h-12" onError={(e) => (e.currentTarget.style.display = "none")} />
                <div>
                  <div className="text-xl font-bold tracking-tight">Market Outlook</div>
                  <div className="text-[11px] text-black/50">
                    {new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}
                  </div>
                </div>
              </div>

              {result.digest.keyStats && result.digest.keyStats.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {result.digest.keyStats.map((stat, i) => (
                    <div key={i} className="border border-black/15 rounded p-3 bg-black/[0.03]">
                      <div className="text-[10px] uppercase tracking-wide text-black/50 mb-0.5">{stat.label}</div>
                      <div className="text-[16px] font-bold">{stat.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {result.digest.articleSections.map((s, i) => (
                <div key={i} className="mb-5">
                  <h3 className="font-bold text-[15px] mb-1.5 pb-1 border-b border-black/10">{s.heading}</h3>
                  <p className="text-[13px] leading-[1.7]">{s.body}</p>
                </div>
              ))}
              <div className="mt-8 pt-3 border-t border-black/20 text-[11px] text-black/60">
                Sources: {result.sources.map((s) => s.source).join(", ")}
              </div>
            </div>
          </Panel>

          <Panel title="Cited sources">
            <div className="flex flex-col gap-1">
              {result.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="text-[12px] hover:text-cyan">
                  {s.source} — {s.title}
                </a>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
