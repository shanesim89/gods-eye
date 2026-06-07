"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AgentPanel } from "./AgentPanel";
import { currencySymbol } from "@/lib/format";
import type {
  AgentResult,
  AggregateRanking,
  AssetClass,
  LaymanExplanation,
  StreamEvent,
  TradeLevels,
  Verdict,
  VerdictType,
} from "@/lib/council/types";

type Props = {
  ticker: string;
  assetClass: AssetClass;
};

const VERDICT_COLORS = {
  BUY:  { text: "text-green",  border: "border-green/60",  bg: "bg-green/10"  },
  HOLD: { text: "text-amber",  border: "border-amber/60",  bg: "bg-amber/10"  },
  SELL: { text: "text-red",    border: "border-red/60",    bg: "bg-red/10"    },
};

const STORAGE_KEY = (ticker: string, cls: AssetClass) =>
  `council:${cls}:${ticker}`;

function loadCached(ticker: string, assetClass: AssetClass): Verdict | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(ticker, assetClass));
    if (!raw) return null;
    const v = JSON.parse(raw) as Verdict;
    // expire after 1h
    if (Date.now() - new Date(v.generatedAt).getTime() > 60 * 60 * 1000) return null;
    return v;
  } catch {
    return null;
  }
}

function saveCache(ticker: string, assetClass: AssetClass, v: Verdict) {
  try {
    sessionStorage.setItem(STORAGE_KEY(ticker, assetClass), JSON.stringify(v));
  } catch {/* ignore */}
}

export function CouncilCard({ ticker, assetClass }: Props) {
  const [roles, setRoles] = useState<string[]>([]);
  const [agentMap, setAgentMap] = useState<Record<string, AgentResult>>({});
  const [loadingRoles, setLoadingRoles] = useState<Set<string>>(new Set());
  const [synthLoading, setSynthLoading] = useState(false);
  const [stage2Loading, setStage2Loading] = useState(false);
  const [aggregateRankings, setAggregateRankings] = useState<AggregateRanking[] | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(() =>
    loadCached(ticker, assetClass)
  );
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showDebate, setShowDebate] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // Cancel stream on unmount (e.g. user navigates away mid-debate)
  useEffect(() => {
    return () => {
      readerRef.current?.cancel().catch(() => {});
    };
  }, []);

  const convene = useCallback(async () => {
    setRunning(true);
    setError(null);
    setVerdict(null);
    setAgentMap({});
    setLoadingRoles(new Set());
    setRoles([]);
    setSynthLoading(false);
    setStage2Loading(false);
    setAggregateRankings(null);

    try {
      const res = await fetch("/api/council/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, assetClass }),
      });

      if (!res.ok || !res.body) {
        // Clerk middleware rewrites unauthenticated API calls to /404 (HTML).
        // Detect and surface a clearer message instead of "HTTP 404".
        if (res.status === 404 || res.status === 401 || res.status === 307) {
          throw new Error("Session expired — please reload and sign in again.");
        }
        throw new Error(`Council request failed (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));
            handleEvent(event);
          } catch {/* ignore malformed */}
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setRunning(false);
      setSynthLoading(false);
    }
  }, [ticker, assetClass]);

  function handleEvent(event: StreamEvent) {
    switch (event.type) {
      case "agent_start":
        setRoles((prev) => (prev.includes(event.role) ? prev : [...prev, event.role]));
        setLoadingRoles((prev) => new Set([...prev, event.role]));
        break;

      case "agent_done":
        setAgentMap((prev) => ({ ...prev, [event.result.role]: event.result }));
        setLoadingRoles((prev) => {
          const next = new Set(prev);
          next.delete(event.result.role);
          return next;
        });
        break;

      case "stage2_start":
        setStage2Loading(true);
        break;

      case "stage2_peer_done":
        // no per-reviewer UI in v1 — event emitted for future use
        break;

      case "stage2_complete":
        setStage2Loading(false);
        setAggregateRankings(event.aggregateRankings);
        break;

      case "synth_start":
        setSynthLoading(true);
        break;

      case "verdict":
        setSynthLoading(false);
        setVerdict(event.data);
        saveCache(ticker, assetClass, event.data);
        // Restore rankings from verdict (cached path)
        if (event.data.aggregateRankings) {
          setAggregateRankings(event.data.aggregateRankings);
        }
        // Ensure roles are populated from cached verdict agents if needed
        if (event.data.agents.length > 0 && roles.length === 0) {
          setRoles(event.data.agents.map((a) => a.role));
          const map: Record<string, AgentResult> = {};
          event.data.agents.forEach((a) => (map[a.role] = a));
          setAgentMap(map);
        }
        break;

      case "error":
        setError(event.message);
        break;
    }
  }

  const vc = verdict ? VERDICT_COLORS[verdict.verdict] : null;

  // If cached verdict, derive roles from agents
  const displayRoles =
    roles.length > 0
      ? roles
      : verdict
      ? verdict.agents.map((a) => a.role)
      : [];

  const displayAgentMap =
    Object.keys(agentMap).length > 0
      ? agentMap
      : verdict
      ? Object.fromEntries(verdict.agents.map((a) => [a.role, a]))
      : {};

  return (
    <div className="border border-border bg-grid p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-muted text-[10px] uppercase tracking-[1px]">
          ◎ INVESTMENT COUNCIL
        </div>
        {verdict && (
          <div className="text-[9px] text-dim">
            cached ·{" "}
            {new Date(verdict.generatedAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </div>

      {/* Agent grid */}
      {displayRoles.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          {displayRoles.map((role) => {
            const peerRank = aggregateRankings
              ? aggregateRankings.findIndex((ar) => ar.role === role) + 1
              : undefined;
            return (
              <AgentPanel
                key={role}
                role={role}
                result={displayAgentMap[role]}
                loading={loadingRoles.has(role)}
                peerRank={peerRank || undefined}
                totalPeers={aggregateRankings?.length}
              />
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-[10px] text-dim italic">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border border-border/40 p-2.5 min-h-[110px] flex items-center justify-center text-dim/50">
              —
            </div>
          ))}
        </div>
      )}

      {/* Peer review loading */}
      {stage2Loading && (
        <div className="text-[10px] text-dim animate-pulse mb-2 tracking-[1px] uppercase">
          ◈ Peer review in progress — analysts reviewing each other anonymously…
        </div>
      )}

      {/* Synthesizer loading */}
      {synthLoading && (
        <div className="text-[10px] text-amber animate-pulse mb-2 tracking-[1px] uppercase">
          ◈ Chief Investment Officer synthesizing verdict…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-[10px] text-red border border-red/30 bg-red/5 p-2 mb-2">
          ERROR: {error}
        </div>
      )}

      {/* Verdict banner */}
      {verdict && vc && (
        <div
          className={`border ${vc.border} ${vc.bg} p-3 mb-2 flex items-start justify-between gap-4`}
        >
          <div className="flex-1">
            <div className={`text-[28px] font-bold tabular-nums ${vc.text} leading-none mb-1`}>
              {verdict.verdict}
            </div>
            <div className="text-[10px] text-text leading-relaxed">
              {verdict.summary}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-center">
            <svg
              width={64}
              height={64}
              viewBox="0 0 64 64"
              style={{ transform: "rotate(-90deg)" }}
            >
              <circle cx={32} cy={32} r={26} fill="none" stroke="#1a1a1a" strokeWidth={6} />
              <circle
                cx={32}
                cy={32}
                r={26}
                fill="none"
                stroke={
                  verdict.verdict === "BUY"
                    ? "#22c55e"
                    : verdict.verdict === "SELL"
                    ? "#ef4444"
                    : "#ffb000"
                }
                strokeWidth={6}
                strokeDasharray={`${(2 * Math.PI * 26 * verdict.confidence) / 100} ${2 * Math.PI * 26}`}
                strokeLinecap="round"
              />
            </svg>
            <div className={`text-[11px] tabular-nums font-bold -mt-1 ${vc.text}`}>
              {verdict.confidence}%
            </div>
            <div className="text-[8px] text-muted uppercase tracking-wider">
              conviction
            </div>
          </div>
        </div>
      )}

      {/* Plain-English explanation */}
      {verdict && verdict.laymanExplanation && (
        <LaymanCard
          verdict={verdict.verdict}
          layman={verdict.laymanExplanation}
        />
      )}

      {/* Trade Levels sub-card */}
      {verdict && verdict.tradeLevels && (
        <TradeLevelsCard
          verdict={verdict.verdict}
          levels={verdict.tradeLevels}
          currency={currencySymbol(verdict.currency)}
        />
      )}

      {/* Footer: button + debate toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={convene}
          disabled={running}
          className={`text-[10px] uppercase tracking-[1px] px-3 py-1.5 border transition-colors font-bold
            ${running
              ? "border-border text-dim cursor-not-allowed"
              : "border-amber text-amber hover:bg-amber hover:text-black cursor-pointer"
            }`}
        >
          {running ? "convening…" : verdict ? "re-convene council" : "convene council"}
        </button>
        {verdict && verdict.agents.length > 0 && (
          <button
            onClick={() => setShowDebate((s) => !s)}
            className="text-[9px] text-dim hover:text-muted uppercase tracking-[1px] transition-colors"
          >
            {showDebate ? "hide debate" : "view debate log"}
          </button>
        )}
      </div>

      {/* Debate log */}
      {showDebate && verdict && (
        <div className="mt-3 border border-border/40 bg-black/30 p-2.5 space-y-2.5 max-h-72 overflow-y-auto">
          {verdict.agents.map((a) => (
            <div key={a.role} className="text-[10px]">
              <div className="text-amber uppercase tracking-[1px] mb-0.5">
                {a.role} · {a.signal.toUpperCase()} · {a.confidence}%
              </div>
              <p className="text-text leading-relaxed">{a.thesis}</p>
              {Array.isArray(a.keyPoints) && a.keyPoints.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {a.keyPoints.map((pt, i) => (
                    <li key={i} className="text-dim flex gap-1">
                      <span className="text-amber shrink-0">›</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LaymanCard({
  verdict,
  layman,
}: {
  verdict: VerdictType;
  layman: LaymanExplanation;
}) {
  const actionColor =
    verdict === "BUY"
      ? "text-green"
      : verdict === "SELL"
      ? "text-red"
      : "text-amber";

  const why = Array.isArray(layman.why) ? layman.why : [];
  const watch = Array.isArray(layman.whatToWatch) ? layman.whatToWatch : [];

  return (
    <div className="border border-border bg-grid p-3 mb-2">
      <div className="text-muted text-[10px] uppercase tracking-[1px] mb-2">
        ◉ PLAIN ENGLISH
      </div>

      {/* Action line */}
      <div className={`text-[14px] font-bold leading-snug mb-2 ${actionColor}`}>
        {layman.action}
      </div>

      {/* Why bullets */}
      {why.length > 0 && (
        <ul className="space-y-1 mb-2">
          {why.map((reason, i) => (
            <li key={i} className="text-[11px] text-text leading-relaxed flex gap-1.5">
              <span className="text-amber shrink-0">›</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {/* When to reconsider */}
      {layman.whenToReconsider && (
        <div className="mt-2 pt-2 border-t border-border/40">
          <div className="text-muted text-[9px] uppercase tracking-[1px] mb-0.5">
            When to act
          </div>
          <div className="text-[11px] text-text leading-relaxed">
            {layman.whenToReconsider}
          </div>
        </div>
      )}

      {/* What to watch */}
      {watch.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/40">
          <div className="text-muted text-[9px] uppercase tracking-[1px] mb-0.5">
            Watch
          </div>
          <ul className="space-y-0.5">
            {watch.map((risk, i) => (
              <li key={i} className="text-[10px] text-dim italic leading-relaxed">
                {risk}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function fmtPrice(v: number | undefined | null, cur = "$"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v < 1) return `${cur}${v.toPrecision(4)}`;
  if (v >= 1000) return `${cur}${v.toFixed(0)}`;
  return `${cur}${v.toFixed(2)}`;
}

function TradeLevelsCard({
  verdict,
  levels,
  currency = "$",
}: {
  verdict: VerdictType;
  levels: TradeLevels;
  currency?: string;
}) {
  const isHold = verdict === "HOLD";
  const accent =
    verdict === "BUY"
      ? "text-green"
      : verdict === "SELL"
      ? "text-red"
      : "text-amber";

  return (
    <div className="border border-border bg-grid p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-muted text-[10px] uppercase tracking-[1px]">
          ◇ TRADE LEVELS
        </div>
        <div className={`text-[10px] uppercase tracking-[1px] font-bold ${accent}`}>
          {verdict}
        </div>
      </div>

      <table className="w-full text-[11px] tabular-nums">
        <tbody>
          {isHold ? (
            <>
              {levels.buyTrigger != null && (
                <tr className="dotted-row">
                  <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                    Re-eval BUY
                  </td>
                  <td className="py-0.5 text-right text-green">
                    below {fmtPrice(levels.buyTrigger, currency)}
                  </td>
                </tr>
              )}
              {levels.sellTrigger != null && (
                <tr className="dotted-row">
                  <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                    Re-eval SELL
                  </td>
                  <td className="py-0.5 text-right text-red">
                    above {fmtPrice(levels.sellTrigger, currency)}
                  </td>
                </tr>
              )}
              <tr className="dotted-row">
                <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                  Neutral range
                </td>
                <td className="py-0.5 text-right text-amber">
                  {fmtPrice(levels.entry.low, currency)} — {fmtPrice(levels.entry.high, currency)}
                </td>
              </tr>
              <tr className="dotted-row">
                <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                  Hard stop
                </td>
                <td className="py-0.5 text-right text-dim">
                  {fmtPrice(levels.stopLoss, currency)}
                </td>
              </tr>
            </>
          ) : (
            <>
              <tr className="dotted-row">
                <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                  Entry
                </td>
                <td className="py-0.5 text-right text-amber font-bold">
                  {fmtPrice(levels.entry.low, currency)} — {fmtPrice(levels.entry.high, currency)}
                </td>
              </tr>
              <tr className="dotted-row">
                <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                  Target
                </td>
                <td className="py-0.5 text-right text-green font-bold">
                  {fmtPrice(levels.target.low, currency)} — {fmtPrice(levels.target.high, currency)}
                </td>
              </tr>
              <tr className="dotted-row">
                <td className="py-0.5 text-muted pr-3 whitespace-nowrap uppercase text-[10px]">
                  Stop loss
                </td>
                <td className="py-0.5 text-right text-red font-bold">
                  {fmtPrice(levels.stopLoss, currency)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {levels.rationale && (
        <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-dim leading-relaxed">
          {levels.rationale}
        </div>
      )}
    </div>
  );
}
