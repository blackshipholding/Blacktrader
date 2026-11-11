"use client";
// Kerzenchart (TradingView lightweight-charts): Einstiegszonen wie bei HKCM als farbige Kästen (blau/grün, alte grau)
// mit Stop und Ziel, Elliott-Wellen. Volumen, RSI, Fibonacci und Alternativzählung nur in der Expertenansicht.
import { useEffect, useRef, useState } from "react";
import { eurPerUnit, fxVersion, onFx } from "@/lib/fx";
import { fmtPrice } from "@/lib/analysis/persona";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { rsi } from "@/lib/analysis/indicators";
import type { WaveCount } from "@/lib/analysis/elliott";
import type { TradePlan } from "@/lib/analysis/score";
import type { Candle } from "@/lib/types";
import { ZonesPrimitive, type ChartEntry } from "./chartZones";

interface Props {
  candles: Candle[];
  best?: WaveCount;
  alternative?: WaveCount;
  plan?: TradePlan | null;
  showAlternative?: boolean;
  height?: number;
  /** Einfache Ansicht: nur Einstieg, Stop und Ziele – keine Wellen-Nummern */
  simple?: boolean;
  /** Einstiege als Kästen: aktueller (blau/grün) und alte (grau) */
  entries?: ChartEntry[];
  fmt?: (n: number) => string;
  /** Währung des Werts – die Preisachse zeigt Euro */
  currency?: string;
}

const GOLD = "#C9A24A";
/** Sichtbare Kerzen (die letzten Monate, wie bei HKCM) und freier Platz rechts für Zone, Stop, Ziel und Pfeil */
const VISIBLE = 160;
const futureBars = (n: number) => Math.max(18, Math.round(Math.min(n, VISIBLE) * 0.35));
const WINE = "#a32234";

export function PriceChart({ candles, best, alternative, plan, showAlternative = true, height = 460, simple = false, entries = [], fmt = (n) => n.toFixed(2), currency }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ candle: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram"> | null; rsi: ISeriesApi<"Line"> | null; wave: ISeriesApi<"Line">; alt: ISeriesApi<"Line"> } | null>(null);
  const zonesRef = useRef<ZonesPrimitive | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const linesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const fittedRef = useRef<string>("");
  const [fxV, setFxV] = useState(fxVersion());
  useEffect(() => onFx(() => setFxV(fxVersion())), []);

  // Chart einmalig erzeugen
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#bdb6a4", fontFamily: "Inter, sans-serif", panes: { separatorColor: "rgba(201,162,74,0.2)" } },
      grid: { vertLines: { color: "rgba(201,162,74,0.06)" }, horzLines: { color: "rgba(201,162,74,0.06)" } },
      rightPriceScale: { borderColor: "rgba(201,162,74,0.25)" },
      timeScale: { borderColor: "rgba(201,162,74,0.25)", timeVisible: true },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const candle = chart.addSeries(CandlestickSeries, { upColor: "#3fae6a", downColor: "#d1495b", borderVisible: false, wickUpColor: "#3fae6a", wickDownColor: "#d1495b" });
    const zones = new ZonesPrimitive();
    candle.attachPrimitive(zones);
    zonesRef.current = zones;
    // Volumen und RSI nur in der Expertenansicht (einfache Ansicht bleibt aufgeräumt)
    let volume: ISeriesApi<"Histogram"> | null = null;
    let rsiS: ISeriesApi<"Line"> | null = null;
    if (!simple) {
      volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    const wave = chart.addSeries(LineSeries, { color: simple ? "rgba(201,162,74,0.7)" : GOLD, lineWidth: simple ? 1 : 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const alt = chart.addSeries(LineSeries, { color: "rgba(201,162,74,0.45)", lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    if (!simple) {
      rsiS = chart.addSeries(LineSeries, { color: GOLD, lineWidth: 1, priceLineVisible: false }, 1);
      rsiS.createPriceLine({ price: 70, color: WINE, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
      rsiS.createPriceLine({ price: 30, color: "#3fae6a", lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: "" });
      chart.panes()[1]?.setHeight(Math.round(height * 0.2));
    }
    chartRef.current = chart;
    seriesRef.current = { candle, volume, rsi: rsiS, wave, alt };
    markersRef.current = createSeriesMarkers(wave, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      zonesRef.current = null;
      linesRef.current = [];
      fittedRef.current = "";
    };
  }, [height, simple]);

  // Daten
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || candles.length === 0) return;
    const t = (x: number) => x as UTCTimestamp;
    // Rechts freier Platz (wie bei HKCM) für Zone, Stop, Ziel und den erwarteten Weg
    const step = candles.length > 2 ? candles[candles.length - 1].time - candles[candles.length - 2].time || 86400 : 86400;
    const extra = futureBars(candles.length);
    const future = Array.from({ length: extra }, (_, i) => candles[candles.length - 1].time + step * (i + 1));
    s.candle.setData([...candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })), ...future.map((x) => ({ time: t(x) }))]);
    s.volume?.setData(candles.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? "rgba(63,174,106,0.35)" : "rgba(209,73,91,0.35)" })));
    if (s.rsi) {
      const r = rsi(candles.map((c) => c.close));
      s.rsi.setData(candles.map((c, i) => (r[i] == null ? { time: t(c.time) } : { time: t(c.time), value: r[i]! })));
    }
    const key = `${candles[0].time}:${candles.length > 0}`;
    if (fittedRef.current !== key) {
      fittedRef.current = key;
      const n = candles.length;
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE), to: n - 1 + extra });
    }
  }, [candles, simple]);

  // Preisachse in Euro (umgerechnet zum aktuellen Wechselkurs)
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const r = eurPerUnit(currency);
    c.applyOptions({ localization: { locale: "de-DE", priceFormatter: (p: number) => fmtPrice(r != null ? p * r : p) } });
  }, [currency, height, simple, fxV]);

  // Einstiege (Kästen)
  useEffect(() => {
    const z = zonesRef.current;
    if (!z || candles.length < 2) return;
    const step = candles[candles.length - 1].time - candles[candles.length - 2].time || 86400;
    const extra = futureBars(candles.length);
    const times = [...candles.map((c) => c.time), ...Array.from({ length: extra }, (_, i) => candles[candles.length - 1].time + step * (i + 1))];
    z.set(entries, times, candles.length - 1, candles[candles.length - 1].close, fmt);
  }, [entries, candles, fmt, simple]);

  // Wellen, Labels, Fibo-Zonen, Plan
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const t = (x: number) => x as UTCTimestamp;
    const toLine = (c?: WaveCount) => (c ? c.pivots.map((p) => ({ time: t(p.time), value: p.price })).filter((p, i, arr) => i === 0 || (p.time as number) > (arr[i - 1].time as number)) : []);
    s.wave.setData(toLine(best));
    s.alt.setData(showAlternative && !simple ? toLine(alternative) : []);
    const markers: SeriesMarker<Time>[] = [];
    const addLabels = (c: WaveCount | undefined, primary: boolean) => {
      if (!c) return;
      c.pivots.forEach((p, i) => {
        const label = i === 0 ? (primary ? "0" : "") : c.labels[i - 1];
        if (!label) return;
        markers.push({
          time: t(p.time),
          position: p.type === "H" ? "aboveBar" : "belowBar",
          color: primary ? GOLD : "rgba(201,162,74,0.55)",
          shape: primary ? "circle" : "square",
          size: primary ? 0.6 : 0.3,
          text: primary ? label : `(${label})`,
        });
      });
    };
    addLabels(best, true);
    if (!simple && showAlternative) addLabels(alternative, false);
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);

    linesRef.current.forEach((l) => s.candle.removePriceLine(l));
    linesRef.current = [];
    if (best && !simple) {
      for (const lv of best.levels) {
        linesRef.current.push(
          s.candle.createPriceLine({
            price: lv.price,
            color: lv.kind === "invalidation" ? WINE : lv.kind === "target" ? "rgba(201,162,74,0.85)" : "rgba(189,182,164,0.45)",
            lineStyle: lv.kind === "retracement" ? LineStyle.Dotted : LineStyle.Dashed,
            lineWidth: lv.kind === "invalidation" ? 2 : 1,
            axisLabelVisible: lv.kind !== "retracement",
            title: lv.label,
          }),
        );
      }
    }
    if (plan && !simple) {
      linesRef.current.push(s.candle.createPriceLine({ price: plan.entry, color: plan.direction === "short" ? "#f87171" : "#34d399", lineStyle: LineStyle.Solid, lineWidth: 2, axisLabelVisible: true, title: plan.direction === "short" ? "Verkauf" : "Kauf" }));
      {
        // Stop und Ziele des Trades immer zeigen (auch in der Expertenansicht neben den Wellen-Levels)
        linesRef.current.push(s.candle.createPriceLine({ price: plan.stop, color: WINE, lineStyle: LineStyle.Dashed, lineWidth: 2, axisLabelVisible: true, title: simple ? "Stop" : "Trade-Stop" }));
        plan.targets.forEach((t, i) =>
          linesRef.current.push(s.candle.createPriceLine({ price: t, color: "rgba(63,174,106,0.9)", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `Ziel ${i + 1}` })),
        );
      }
    }
  }, [best, alternative, plan, showAlternative, simple]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
