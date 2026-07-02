"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type LineData,
  type SeriesMarker,
} from "lightweight-charts";
import type { PDHLBar, PDHLTradeRow } from "./types";

const mono = "JetBrains Mono, Consolas, monospace";
const GREEN = "#4dffb0";
const RED = "#ff7575";
const AMBER = "#ffc94d";
const CYAN = "#7ee8ff";

export function PDHLPriceActionChart({
  bars,
  markers = [],
  lastPrice,
  height = 280,
}: {
  bars: PDHLBar[];
  markers?: PDHLTradeRow[];
  lastPrice?: number | null;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const pdhRef = useRef<ISeriesApi<"Line"> | null>(null);
  const pdlRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);

  // Create the chart once.
  useEffect(() => {
    if (!wrapRef.current) return;
    const chart = createChart(wrapRef.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a8cadd",
        fontFamily: mono,
        fontSize: 14,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(47,74,94,0.6)" },
      timeScale: {
        borderColor: "rgba(47,74,94,0.6)",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
      borderVisible: false,
      priceLineVisible: false,
    });
    const pdh = chart.addSeries(LineSeries, {
      color: CYAN,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "PDH",
      crosshairMarkerVisible: false,
    });
    const pdl = chart.addSeries(LineSeries, {
      color: RED,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "PDL",
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    candleRef.current = candle;
    pdhRef.current = pdh;
    pdlRef.current = pdl;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      pdhRef.current = null;
      pdlRef.current = null;
      priceLineRef.current = null;
    };
  }, [height]);

  // Push data whenever bars / markers / lastPrice change.
  useEffect(() => {
    const candle = candleRef.current;
    const pdh = pdhRef.current;
    const pdl = pdlRef.current;
    const chart = chartRef.current;
    if (!candle || !pdh || !pdl || !chart) return;

    // sort + dedupe by time (lightweight-charts requires ascending unique times)
    const byTime = new Map<number, PDHLBar>();
    for (const b of bars) byTime.set(b.t, b);
    const clean = [...byTime.values()].sort((a, b) => a.t - b.t);

    const candleData: CandlestickData<UTCTimestamp>[] = clean.map((b) => ({
      time: b.t as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
    const pdhData: LineData<UTCTimestamp>[] = clean
      .filter((b) => b.pdh != null)
      .map((b) => ({ time: b.t as UTCTimestamp, value: b.pdh as number }));
    const pdlData: LineData<UTCTimestamp>[] = clean
      .filter((b) => b.pdl != null)
      .map((b) => ({ time: b.t as UTCTimestamp, value: b.pdl as number }));

    candle.setData(candleData);
    pdh.setData(pdhData);
    pdl.setData(pdlData);

    // trade markers, but only those inside the visible bar range
    if (clean.length > 0) {
      const first = clean[0].t;
      const last = clean[clean.length - 1].t;
      const ms: SeriesMarker<UTCTimestamp>[] = [];
      for (const t of markers) {
        if (t.entry_ts != null && t.entry_ts >= first && t.entry_ts <= last) {
          ms.push({
            time: t.entry_ts as UTCTimestamp,
            position: t.side === "LONG" ? "belowBar" : "aboveBar",
            color: t.side === "LONG" ? GREEN : RED,
            shape: t.side === "LONG" ? "arrowUp" : "arrowDown",
            text: t.side === "LONG" ? "L" : "S",
          });
        }
        if (t.exit_ts != null && t.exit_ts >= first && t.exit_ts <= last) {
          ms.push({
            time: t.exit_ts as UTCTimestamp,
            position: "inBar",
            color: t.pnl >= 0 ? GREEN : RED,
            shape: "circle",
            text: `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}`,
          });
        }
      }
      ms.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candle, ms);
    }

    // dashed "current price" line
    if (priceLineRef.current) {
      candle.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    if (lastPrice != null) {
      priceLineRef.current = candle.createPriceLine({
        price: lastPrice,
        color: AMBER,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "now",
      });
    }

    chart.timeScale().fitContent();
  }, [bars, markers, lastPrice]);

  if (bars.length < 2) {
    return (
      <div className="text-dim text-[14px] italic py-10 text-center">
        Awaiting bars — the bot publishes each 1m close during the London/NY session.
      </div>
    );
  }

  return <div ref={wrapRef} style={{ width: "100%", height }} />;
}
