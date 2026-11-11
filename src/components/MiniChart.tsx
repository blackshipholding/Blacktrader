"use client";
// Kleiner SVG-Chart für Karten: Kursverlauf, Wellenzählung, Einstiegszone (grün bzw. blau), Stop (rot), Ziel (grün), alte Einstiege grau.
import type { WaveCount } from "@/lib/analysis/elliott";
import type { TradePlan } from "@/lib/analysis/score";
import type { Candle } from "@/lib/types";
import { arrow, nextWave } from "./waveText";

/** Langfrist-Bereich (blau): Wellenstart (0), Hoch (1), Einstiegsbereich für Welle 2, Invalidierung, Ziel */
export interface MiniLongTerm {
  start: { time: number; price: number };
  high: { time: number; price: number };
  zoneTop: number;
  zoneBottom: number;
  invalidation: number;
  target: number;
}

/** Alter Einstieg (grau) mit Zeitraum */
export interface MiniPast {
  from: number;
  to?: number;
  zoneTop?: number;
  zoneBottom?: number;
}

/** Höchstens so viele Punkte im Kursverlauf (lange Zeiträume werden ausgedünnt – Hochs/Tiefs bleiben erhalten) */
const MAX_POINTS = 240;

function pickWindow(candles: Candle[], from: number | undefined, min: number): Candle[] {
  let data = candles.slice(-min);
  if (from != null) {
    // ab etwas vor dem ersten Wellenpunkt, damit die ganze Zählung zu sehen ist
    const i = candles.findIndex((c) => c.time >= from);
    if (i >= 0) data = candles.slice(Math.max(0, Math.min(i - 5, candles.length - min)));
  }
  if (data.length <= MAX_POINTS) return data;
  // Ausdünnen: je Gruppe eine Kerze mit Hoch, Tief und letztem Schlusskurs
  const step = Math.ceil(data.length / MAX_POINTS);
  const out: Candle[] = [];
  for (let i = 0; i < data.length; i += step) {
    const g = data.slice(i, i + step);
    out.push({ ...g[g.length - 1], open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)) });
  }
  return out;
}

export function MiniChart({ candles, plan, best, height = 92, showWaves = true, longterm, past = [], from }: { candles: Candle[]; plan?: TradePlan | null; best?: WaveCount; height?: number; showWaves?: boolean; longterm?: MiniLongTerm | null; past?: MiniPast[]; from?: number }) {
  const data = pickWindow(candles, from, longterm ? 150 : 90);
  if (data.length < 5) return <div style={{ height }} className="rounded-xl bg-white/5" />;
  const W = 320;
  const H = height;
  const pad = 6;
  const levels = [...data.map((c) => c.high), ...data.map((c) => c.low)];
  if (plan) levels.push(plan.stop, plan.targets[0], plan.zoneStart ?? plan.entry, plan.zoneEnd ?? plan.entry);
  if (longterm) levels.push(longterm.invalidation, longterm.zoneBottom, longterm.target);
  const t00 = data[0].time;
  const greys = past.filter((p) => p.zoneTop != null && p.zoneBottom != null && (p.to ?? Infinity) >= t00);
  for (const g of greys) levels.push(g.zoneTop!, g.zoneBottom!);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const y = (p: number) => pad + (1 - (p - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const x = (i: number) => (i / (data.length - 1)) * (W - 40);
  const t0 = data[0].time;
  const tN = data[data.length - 1].time;
  const xt = (t: number) => x(((t - t0) / (tN - t0 || 1)) * (data.length - 1));
  const path = data.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`).join("");
  const up = data[data.length - 1].close >= data[0].close;
  const pivots = showWaves ? best?.pivots.filter((p) => p.time >= t0) ?? [] : [];
  const nx = showWaves && best ? nextWave(best) : null;
  const lastX = x(data.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label="Mini-Chart mit Zonen">
      {greys.map((g, i) => {
        const x1 = Math.max(0, xt(Math.max(g.from, t0)));
        const x2 = Math.min(W, g.to ? xt(g.to) : W);
        return <rect key={i} x={x1} width={Math.max(3, x2 - x1)} y={y(g.zoneTop!)} height={Math.max(3, y(g.zoneBottom!) - y(g.zoneTop!))} fill="rgba(168,162,158,0.18)" stroke="rgba(168,162,158,0.5)" strokeWidth="1" strokeDasharray="3 2" rx="2" />;
      })}
      {plan && (
        <>
          <rect x={lastX - 70} width={W - lastX + 70} y={Math.min(y(plan.zoneStart ?? plan.entry), y(plan.zoneEnd ?? plan.entry)) - 1} height={Math.max(3, Math.abs(y(plan.zoneStart ?? plan.entry) - y(plan.zoneEnd ?? plan.entry)) + 2)} fill={plan.direction === "short" ? "rgba(248,113,113,0.25)" : "rgba(52,211,153,0.25)"} stroke={plan.direction === "short" ? "rgba(248,113,113,0.75)" : "rgba(52,211,153,0.75)"} strokeWidth="1" rx="2" />
          <line x1={lastX - 70} x2={W} y1={y(plan.stop)} y2={y(plan.stop)} stroke="#f87171" strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1={lastX - 70} x2={W} y1={y(plan.targets[0])} y2={y(plan.targets[0])} stroke="#34d399" strokeWidth="1.5" strokeDasharray="4 3" />
        </>
      )}
      {longterm && (() => {
        const xs = Math.max(0, xt(longterm.high.time));
        const pts = [longterm.start, longterm.high].filter((p) => p.time >= t0);
        return (
          <>
            <rect x={xs} width={W - xs} y={y(longterm.zoneTop)} height={Math.max(3, y(longterm.zoneBottom) - y(longterm.zoneTop))} fill="rgba(56,189,248,0.28)" stroke="rgba(56,189,248,0.7)" strokeWidth="1" rx="2" />
            <line x1={xs} x2={W} y1={y(longterm.invalidation)} y2={y(longterm.invalidation)} stroke="#f87171" strokeWidth="1.5" strokeDasharray="4 3" />
            <line x1={xs} x2={W} y1={y(longterm.target)} y2={y(longterm.target)} stroke="#34d399" strokeWidth="1.5" strokeDasharray="4 3" />
            {pts.length === 2 && <line x1={xt(pts[0].time)} y1={y(pts[0].price)} x2={xt(pts[1].time)} y2={y(pts[1].price)} stroke="#38bdf8" strokeWidth="1.2" opacity="0.8" />}
            {pts.map((p) => (
              <text key={p.time} x={Math.max(6, xt(p.time))} y={p === longterm.high ? Math.max(11, y(p.price) - 4) : Math.min(H - 2, y(p.price) + 12)} fontSize="11" fill="#7dd3fc" textAnchor="middle" fontFamily="Inter, sans-serif">
                {p === longterm.high ? "1" : "0"}
              </text>
            ))}
            <text x={W - 4} y={Math.min(H - 4, y(longterm.zoneBottom) + 12)} fontSize="12" fontWeight="600" fill="#7dd3fc" textAnchor="end" fontFamily="Inter, sans-serif">
              2 ↓
            </text>
          </>
        );
      })()}
      <path d={path} fill="none" stroke={up ? "#d6c08a" : "#bfb6a3"} strokeWidth="1.6" />
      {pivots.length > 1 && (
        <polyline points={pivots.map((p) => `${xt(p.time).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ")} fill="none" stroke="#C9A24A" strokeWidth="1" opacity="0.7" />
      )}
      {pivots.map((p, i) => {
        const k = best!.pivots.indexOf(p);
        const label = k === 0 ? "0" : best!.labels[k - 1];
        if (!label) return null;
        return (
          <text key={p.time} x={Math.max(6, xt(p.time))} y={Math.min(H - 2, Math.max(11, p.type === "H" ? y(p.price) - 4 : y(p.price) + 12))} fontSize="11" fill="#e3c57a" textAnchor="middle" fontFamily="Inter, sans-serif">
            {label}
          </text>
        );
      })}
      {nx && pivots.length > 0 && (
        <text x={W - 4} y={nx.dir === 1 ? 14 : H - 6} fontSize="13" fontWeight="600" fill={nx.dir === 1 ? "#34d399" : "#f87171"} textAnchor="end" fontFamily="Inter, sans-serif">
          {/^[0-9A-Z]$/.test(nx.label) ? `${nx.label} ${arrow(nx.dir)}` : arrow(nx.dir)}
        </text>
      )}
    </svg>
  );
}
