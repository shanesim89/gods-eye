"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type SeriesMarker,
} from "lightweight-charts";

const mono = "JetBrains Mono, Consolas, monospace";
const GREEN = "#4dffb0";
const RED = "#ff7575";
const AMBER = "#ffc94d";

export type CandleBar = { t: number; o: number; h: number; l: number; c: number };
export type BuyOrderMarker = { date: string; price: number | null; status: string };

export function TokenCandleChart({
  bars,
  orders = [],
  maxPrice,
  lastPrice,
  height = 220,
}: {
  bars: CandleBar[];
  orders?: BuyOrderMarker[];
  maxPrice?: number | null;
  lastPrice?: number | null;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ceilLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
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
      timeScale: {
        borderColor: "rgba(47,74,94,0.6)",
        timeVisible: false,
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
    chartRef.current = chart;
    candleRef.current = candle;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      ceilLineRef.current = null;
      priceLineRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart) return;

    const byTime = new Map<number, CandleBar>();
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

    if (clean.length > 0) {
      const times = clean.map((b) => b.t);
      const first = times[0];
      const last = times[times.length - 1];
      const ms: SeriesMarker<UTCTimestamp>[] = [];
      for (const o of orders) {
        if (o.status !== "filled" || o.price == null) continue;
        const ts = Math.round(new Date(o.date).getTime() / 1000);
        if (ts < first) continue;
        // snap to the latest bar boundary at or before this order's timestamp
        let snapped = first;
        for (const t of times) {
          if (t <= Math.min(ts, last)) snapped = t;
          else break;
        }
        ms.push({
          time: snapped as UTCTimestamp,
          position: "belowBar",
          color: GREEN,
          shape: "arrowUp",
          text: "BUY",
        });
      }
      ms.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candle, ms);
    }

    if (ceilLineRef.current) {
      candle.removePriceLine(ceilLineRef.current);
      ceilLineRef.current = null;
    }
    if (maxPrice != null) {
      ceilLineRef.current = candle.createPriceLine({
        price: maxPrice,
        color: RED,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "ceiling",
      });
    }

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
  }, [bars, orders, maxPrice, lastPrice]);

  if (bars.length < 2) {
    return (
      <div className="text-dim text-[12px] italic py-8 text-center">
        Awaiting candle history — CoinGecko OHLC feed populates on next publish.
      </div>
    );
  }

  return <div ref={wrapRef} style={{ width: "100%", height }} />;
}
