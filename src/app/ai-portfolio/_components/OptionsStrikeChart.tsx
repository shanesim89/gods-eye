"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
} from "lightweight-charts";

const mono = "JetBrains Mono, Consolas, monospace";
const GREEN = "#4dffb0";
const RED = "#ff7575";
const AMBER = "#ffc94d";

export type StrikeBar = { t: number; o: number; h: number; l: number; c: number };
export type StrikeLevel = { strike: number; optType: "C" | "P"; side: string; label: string };

/** Candles + dashed strike-level lines (short put/call, LEAPS) — the options analog
 * of PDHL's PDH/PDL lines: shows spot vs the levels the wheel/PMCC is watching. */
export function OptionsStrikeChart({
  bars,
  levels = [],
  lastPrice,
  height = 200,
}: {
  bars: StrikeBar[];
  levels?: StrikeLevel[];
  lastPrice?: number | null;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const levelLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const chart = createChart(wrapRef.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a8cadd",
        fontFamily: mono,
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(47,74,94,0.6)" },
      timeScale: { borderColor: "rgba(47,74,94,0.6)", timeVisible: false, secondsVisible: false },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
      borderVisible: false,
      priceLineVisible: false,
    });
    chartRef.current = chart;
    candleRef.current = candle;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      levelLinesRef.current = [];
      priceLineRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart) return;

    const byTime = new Map<number, StrikeBar>();
    for (const b of bars) byTime.set(b.t, b);
    const clean = [...byTime.values()].sort((a, b) => a.t - b.t);
    const candleData: CandlestickData<UTCTimestamp>[] = clean.map((b) => ({
      time: b.t as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
    candle.setData(candleData);

    for (const line of levelLinesRef.current) candle.removePriceLine(line);
    levelLinesRef.current = levels.map((lvl) =>
      candle.createPriceLine({
        price: lvl.strike,
        color: lvl.optType === "C" ? RED : GREEN,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: lvl.label,
      })
    );

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
  }, [bars, levels, lastPrice]);

  if (bars.length < 2) {
    return (
      <div className="text-dim text-[12px] italic py-8 text-center">
        Awaiting candle history — CoinGecko OHLC feed populates on next publish.
      </div>
    );
  }

  return <div ref={wrapRef} style={{ width: "100%", height }} />;
}
