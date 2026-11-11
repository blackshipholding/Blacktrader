// Signal-Protokoll: JEDES serverseitig erzeugte Signal wird mit Eingaben, Werten und späterem Ausgang gespeichert.
// Getrennt vom Journal der Nutzer. Ausgang mit denselben festen Trade-Regeln wie im EchoChart.
import type { AnalysisResult } from "../analysis/analyze";
import { runZoneBacktest } from "../analysis/zoneBacktest";
import type { ZoneSetup } from "../analysis/zones";
import { LOCKED } from "../analysis/locked-config";
import type { AssetKind, Candle, Horizon, Interval } from "../types";
import { metrics, type Metrics } from "./engine";
import type { CellKey } from "./universe";

export type SignalStatus = "wartet" | "offen" | "gewonnen" | "verloren" | "verfallen";

export interface SignalRecord {
  id: string;
  createdAt: string;
  /** Zeit der Signal-Kerze (Unix-Sekunden) */
  time: number;
  symbol: string;
  kind: AssetKind;
  horizon: Horizon;
  interval: Interval;
  version: number;
  direction: "long" | "short";
  orderType: "limit" | "market";
  entry: number;
  stop: number;
  targets: number[];
  cancelAbove: number;
  atr: number;
  riskReward: number;
  strength: number;
  /** Eingaben: Teil-Scores und Muster */
  inputs: { total: number; elliott: number; fundamental: number; volume: number; pattern?: string };
  /** Verwendete lernbare Werte (nur Abweichungen vom Standard) */
  params: Record<string, unknown>;
  status: SignalStatus;
  exit?: number;
  returnPct?: number;
  closedAt?: number;
}

export const MAX_SIGNALS = 1500;

export function recordFromAnalysis(r: AnalysisResult, a: { symbol: string; kind: AssetKind }, version: number, params: Record<string, unknown>): SignalRecord | null {
  const p = r.plan;
  if (!p || r.decision.level === "neutral") return null;
  return {
    id: `${a.symbol}:${r.horizon}:${r.time}`,
    createdAt: new Date().toISOString(),
    time: r.time,
    symbol: a.symbol,
    kind: a.kind,
    horizon: r.horizon,
    interval: r.interval,
    version,
    direction: p.direction,
    orderType: p.orderType ?? "market",
    entry: p.entry,
    stop: p.stop,
    targets: p.targets,
    cancelAbove: p.cancelAbove ?? p.entry,
    atr: (p.trailDistance ?? 0) / LOCKED.trade.trailAtr,
    riskReward: p.riskReward,
    strength: Math.round(p.direction === "long" ? r.total : 100 - r.total),
    inputs: { total: Math.round(r.total), elliott: Math.round(r.elliott.score), fundamental: Math.round(r.fundamental.score), volume: Math.round(r.volume.score), pattern: r.elliott.best?.pattern },
    params,
    status: "wartet",
  };
}

const isClosed = (s: SignalStatus) => s === "gewonnen" || s === "verloren" || s === "verfallen";

/**
 * Ausgang eines Signals aus den Kerzen NACH dem Signal (feste Regeln: Einstieg in der Zone,
 * Stop, Ziel 1, danach Nachziehen). Nur Kerzen ab der Signal-Kerze werden verwendet.
 */
export function evaluateSignal(rec: SignalRecord, candles: Candle[]): SignalRecord {
  if (isClosed(rec.status)) return rec;
  const start = candles.findIndex((c) => c.time >= rec.time);
  if (start < 0) return rec;
  const after = candles.slice(start);
  const setup: ZoneSetup = {
    direction: rec.direction,
    a: { index: 0, time: 0, price: 0, type: "L", confirmed: true },
    b: { index: 0, time: 0, price: rec.cancelAbove, type: "H", confirmed: true },
    zoneStart: rec.entry,
    zoneEnd: rec.entry,
    entry: rec.entry,
    stop: rec.stop,
    targets: rec.targets,
    riskReward: rec.riskReward,
    cancelAbove: rec.cancelAbove,
    inZone: rec.orderType === "market",
    atr: rec.atr,
  };
  const r = runZoneBacktest(after, { warmup: 0, step: 1, window: 1, signalAt: (h) => (h[h.length - 1].time === after[0].time ? setup : null) });
  const t = r.trades[0];
  if (t) {
    if (t.reason === "end") return { ...rec, status: "offen" };
    return { ...rec, status: t.returnPct > 0 ? "gewonnen" : "verloren", exit: t.exit, returnPct: Math.round(t.returnPct * 100) / 100, closedAt: t.exitTime };
  }
  // Kein Einstieg: verfallen, wenn die Wartezeit vorbei ist oder der Kurs ohne Einstieg weggelaufen ist
  const waited = after.length - 1;
  const ranAway = after.slice(1).some((c) => (rec.direction === "long" ? c.high > rec.cancelAbove : c.low < rec.cancelAbove));
  if (waited >= LOCKED.trade.maxWaitBars || ranAway) return { ...rec, status: "verfallen", closedAt: after[after.length - 1].time };
  return { ...rec, status: "wartet" };
}

/** Kennzahlen der abgeschlossenen Signale (gewonnen/verloren) je Zelle. */
export function liveMetrics(list: SignalRecord[]): Partial<Record<CellKey, Metrics & { open: number; expired: number }>> {
  const out: Partial<Record<CellKey, Metrics & { open: number; expired: number }>> = {};
  const groups = new Map<CellKey, SignalRecord[]>();
  for (const r of list) {
    const k = `${r.kind}:${r.horizon}` as CellKey;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, rs] of groups) {
    const closed = rs.filter((r) => r.status === "gewonnen" || r.status === "verloren");
    const times = rs.map((r) => r.time);
    const months = times.length ? (Math.max(...times) - Math.min(...times)) / (30.44 * 86400) : 0;
    out[k] = {
      ...metrics(closed.map((r) => ({ returnPct: r.returnPct ?? 0, exitTime: r.closedAt ?? r.time })), Math.max(1, months)),
      open: rs.filter((r) => r.status === "wartet" || r.status === "offen").length,
      expired: rs.filter((r) => r.status === "verfallen").length,
    };
  }
  return out;
}
