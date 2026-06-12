"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AgentPanel } from "./AgentPanel";
import { DirectiveCard } from "./DirectiveCard";
import { resolveDirective, type Position } from "@/lib/council/directive";
import { bandExplanation } from "@/lib/council/display";
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
  // Position context (optional — GURU pages pass these so guidance is position-aware).
  currentPrice?: number | null;
  position?: Position;
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

export function CouncilCard({ ticker, assetClass, currentPrice = null, position = { held: false } }: Props) {
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
  // Mode: auto-detected from the DB position; the other tab is a "peek".
  const [viewMode, setViewMode] = useState<"position" | "buying">(position.held ? "position" : "buying");
  const [showExplain, setShowExplain] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // Re-sync mode if the server-provided position changes (e.g. navigation).
  useEffect(() => {
    setViewMode(position.held ? "position" : "buying");
  }, [position.held]);

  // Cancel stream on unmount (e.g. user navigates away mid-debate)
  useEffect(() => {
    return () => {
      readerRef.current?.cancel().catch(() => {});
    };
  }, []);

  const handleEvent = useCallback((event: StreamEvent) => {
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
        if (event.data.aggregateRankings) {
          setAggregateRankings(event.data.aggregateRankings);
        }
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
  }, [ticker, assetClass, roles]);

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
  }, [ticker, assetClass, handleEvent]);

  // Position-aware directive (research venue → short allowed as analysis).
  // The displayed directive follows viewMode: peeking at the non-actual mode
  // substitutes a synthetic position so the user can see "what if".
  const actualMode: "position" | "buying" = position.held ? "position" : "buying";
  const isPeek = viewMode !== actualMode;
  const directive = useMemo(() => {
    if (!verdict) return null;
    const displayPosition: Position =
      viewMode === "position"
        ? position.held
          ? position
          : { held: true, qty: 0, costBasis: null } // hypothetical holding
        : { held: false };
    return resolveDirective({
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      tradeLevels: verdict.tradeLevels,
      currentPrice,
      position: displayPosition,
      venue: "research",
    });
  }, [verdict, currentPrice, position, viewMode]);

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

      {/* Mode toggle: auto-detected from DB position; other tab is a peek. */}
      {verdict && (
        <div className="flex items-center gap-1 mb-2">
          {(["position", "buying"] as const).map((m) => {
            const active = viewMode === m;
            const label = m === "position" ? "IN POSITION" : "BUYING";
            const peek = m !== actualMode;
            return (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`text-[9px] uppercase tracking-[1px] px-2.5 py-1 border transition-colors cursor-pointer
                  ${active
                    ? "border-amber text-amber bg-amber/10"
                    : "border-border/40 text-dim hover:text-muted"
                  }`}
              >
                {label}
                {peek && <span className="ml-1 opacity-60">(peek)</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Streaming feedback — always visible while the council runs */}
      {(running || (!verdict && displayRoles.length > 0)) && (
        <>
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
          {stage2Loading && (
            <div className="text-[10px] text-dim animate-pulse mb-2 tracking-[1px] uppercase">
              ◈ Peer review in progress — analysts reviewing each other anonymously…
            </div>
          )}
          {synthLoading && (
            <div className="text-[10px] text-amber animate-pulse mb-2 tracking-[1px] uppercase">
              ◈ Chief Investment Officer synthesizing verdict…
            </div>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="text-[10px] text-red border border-red/30 bg-red/5 p-2 mb-2">
          ERROR: {error}
        </div>
      )}

      {/* CLEAN LAYER — directive + band meaning + key prices; everything else behind EXPLAIN */}
      {verdict && directive && (
        <div className="mb-2">
          {isPeek && (
            <div className="text-[9px] text-dim italic mb-1 px-0.5">
              {viewMode === "position"
                ? "hypothetical — you hold nothing; this is what the council would say if you did"
                : "hypothetical — you hold this; this is the fresh-entry view"}
            </div>
          )}
          <DirectiveCard
            directive={directive}
            currency={verdict.currency}
            showConfidence
            confidence={verdict.confidence}
            verdict={verdict.verdict}
            bandText={bandExplanation(verdict.confidence, viewMode === "position" ? "holding" : "flat")}
            showLevels
          />
        </div>
      )}

      {/* Footer: convene + EXPLAIN toggle */}
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
        {verdict && (
          <button
            onClick={() => setShowExplain((s) => !s)}
            className="text-[9px] text-dim hover:text-muted uppercase tracking-[1px] transition-colors cursor-pointer"
          >
            {showExplain ? "▾ hide reasoning" : "▸ explain"}
          </button>
        )}
      </div>

      {/* EXPLAIN — agent grid, summary, plain english, trade levels, debate */}
      {showExplain && verdict && (
        <div className="mt-3 space-y-2">
          {!running && displayRoles.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
          )}

          {verdict.summary && (
            <div className="text-[10px] text-dim leading-relaxed px-0.5">
              {verdict.summary}
            </div>
          )}

          {verdict.laymanExplanation && (
            <LaymanCard verdict={verdict.verdict} layman={verdict.laymanExplanation} />
          )}

          {verdict.tradeLevels && (
            <TradeLevelsCard
              verdict={verdict.verdict}
              levels={verdict.tradeLevels}
              currency={currencySymbol(verdict.currency)}
            />
          )}

          {verdict.agents.length > 0 && (
            <div className="border border-border/40 bg-black/30 p-2.5 space-y-2.5 max-h-72 overflow-y-auto">
              <div className="text-muted text-[9px] uppercase tracking-[1px]">◈ debate log</div>
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
