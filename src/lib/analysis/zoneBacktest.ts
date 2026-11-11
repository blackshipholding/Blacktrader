// EchoChart für Zielzonen: wartende Limit-Order in der Zone, Einstieg nur bei Erreichen.
import type { Candle } from "../types";
import type { BacktestResult, BacktestTrade } from "./backtest";
import { LOCKED } from "./locked-config";
import { MIN_RISK_REWARD } from "./score";
import { atr, exhaustionAt, rsi } from "./indicators";
import { performance, tradeReturnPct } from "./stats";
import { DEFAULT_ZONE_OPTIONS, findZoneSetup, type ZoneOptions, type ZoneSetup } from "./zones";

export interface ZoneBacktestOptions {
  zone?: Partial<ZoneOptions>;
  /**
   * Eigene Signalquelle (z. B. vollständige Analyse mit lernbaren Werten). Erhält NUR Kerzen bis zum
   * aktuellen Zeitpunkt (kein Blick in die Zukunft). Standard: Zielzonen-Erkennung.
   */
  signalAt?: (hist: Candle[]) => ZoneSetup | null;
  /** Wird für jedes erzeugte Signal aufgerufen (Signal-Protokoll, Tests auf Look-ahead-Freiheit) */
  onSignal?: (s: { index: number; time: number; setup: ZoneSetup }) => void;
  warmup?: number;
  step?: number;
  window?: number;
  /** Wie lange eine Order in der Zone wartet (Kerzen) */
  maxWait?: number;
  /** Wie lange ein Trade maximal läuft (Kerzen) */
  maxHold?: number;
  /** Welches Ziel schließt den Trade (0 = Ziel 1) */
  targetIndex?: number;
  /**
   * Ausstieg: "fixed" = bei Ziel 1; "trail" = ab Ziel 1 Stop auf Einstieg und mit `trailAtr` × ATR nachziehen;
   * "partial" = Hälfte bei Ziel 1, Rest wie "trail".
   */
  exitMode?: "fixed" | "trail" | "partial";
  trailAtr?: number;
  /** Nachzieh-Abstand fest mit dem ATR beim Setup (wie die Papier-Trades in der App) statt laufend */
  trailAtSignal?: boolean;
  /** Einstieg erst, wenn eine Kerze in der Zone in Trade-Richtung über das Hoch der Vorkerze schließt */
  confirmEntry?: boolean;
  /** Nach Ziel 1: Gewinn sichern, sobald ein Wellen-5-Ende mit RSI-Divergenz erkannt wird (Standard: aus bzw. aus dem Signal) */
  wave5Exit?: boolean;
}

function* steps(candles: Candle[], opts: ZoneBacktestOptions): Generator<number, BacktestResult> {
  const zo = { ...DEFAULT_ZONE_OPTIONS, ...(opts.zone ?? {}) };
  const warmup = opts.warmup ?? 120;
  const step = opts.step ?? Math.max(1, Math.ceil((candles.length - warmup) / 5000));
  const window = opts.window ?? 400;
  const maxWait = opts.maxWait ?? LOCKED.trade.maxWaitBars;
  const maxHold = opts.maxHold ?? LOCKED.trade.maxHoldBars;
  const ti = opts.targetIndex ?? 0;
  const exitMode = opts.exitMode ?? LOCKED.trade.exitMode; // gemessen: Prüfdaten Gewinnfaktor 1,59 (fixed: 1,18)
  const trailAtr = opts.trailAtr ?? LOCKED.trade.trailAtr;
  const atrs = atr(candles);
  const rsis = rsi(candles.map((c) => c.close));
  const trades: BacktestTrade[] = [];
  let evaluated = 0;
  let i = warmup;
  while (i < candles.length - 1) {
    if (evaluated % 50 === 0) yield (i - warmup) / Math.max(1, candles.length - 1 - warmup);
    evaluated++;
    const hist = candles.slice(Math.max(0, i + 1 - window), i + 1);
    const setup = opts.signalAt ? opts.signalAt(hist) : findZoneSetup(hist, zo);
    if (setup && setup.riskReward >= MIN_RISK_REWARD) opts.onSignal?.({ index: i, time: candles[i].time, setup });
    if (!setup || setup.riskReward < MIN_RISK_REWARD) {
      i += step;
      continue;
    }
    const dir = setup.direction === "long" ? 1 : -1;
    const target = setup.targets[Math.min(ti, setup.targets.length - 1)];
    // 1) Warten auf Einstieg
    let fillIdx = -1;
    let fill = 0;
    if (setup.inZone) {
      fillIdx = i;
      fill = candles[i].close;
    } else {
      let touched = false;
      for (let j = i + 1; j < candles.length && j <= i + maxWait; j++) {
        const c = candles[j];
        const reached = dir === 1 ? c.low <= setup.entry : c.high >= setup.entry;
        if ((dir === 1 ? c.high > setup.cancelAbove : c.low < setup.cancelAbove) && !reached && !touched) {
          break; // Setup verfällt: neues Extrem ohne Einstieg
        }
        if (!opts.confirmEntry) {
          if (reached) {
            fillIdx = j;
            fill = dir === 1 ? Math.min(setup.entry, c.open) : Math.max(setup.entry, c.open);
            break;
          }
          continue;
        }
        // Mit Bestätigung: fällt der Kurs vor der Bestätigung durch den Stop, wurde nie eingestiegen
        if (dir === 1 ? c.low <= setup.stop : c.high >= setup.stop) break;
        if (reached) touched = true;
        // Bestätigung: Kerze schließt in Trade-Richtung über/unter der Vorkerze, Kurs noch unter dem alten Extrem
        const prev = candles[j - 1];
        if (touched && (c.close - c.open) * dir > 0 && (dir === 1 ? c.close > prev.high : c.close < prev.low) && (c.close - setup.cancelAbove) * dir < 0) {
          fillIdx = j;
          fill = c.close;
          break;
        }
      }
    }
    if (fillIdx < 0) {
      i += step;
      continue;
    }
    // 2) Trade verwalten (Stop zuerst, wenn beides in derselben Kerze)
    let exitIdx = -1;
    let exit = 0;
    let reason: BacktestTrade["reason"] = "end";
    let stop = setup.stop;
    let reachedT1 = false;
    let partialExit: number | null = null;
    const startJ = fillIdx + (setup.inZone || opts.confirmEntry ? 1 : 0);
    const holdLimit = exitMode === "fixed" ? maxHold : maxHold * 5;
    for (let j = startJ; j < candles.length && j <= fillIdx + holdLimit; j++) {
      const c = candles[j];
      if (j === fillIdx) {
        if (dir === 1 ? c.low <= stop : c.high >= stop) {
          exitIdx = j;
          exit = stop;
          reason = "stop";
          break;
        }
        continue;
      }
      if (dir === 1 ? c.low <= stop : c.high >= stop) {
        exitIdx = j;
        exit = dir === 1 ? Math.min(stop, c.open) : Math.max(stop, c.open);
        reason = reachedT1 ? "target" : "stop";
        break;
      }
      if (!reachedT1 && (dir === 1 ? c.high >= target : c.low <= target)) {
        if (exitMode === "fixed") {
          exitIdx = j;
          exit = target;
          reason = "target";
          break;
        }
        reachedT1 = true;
        if (exitMode === "partial") partialExit = target;
        stop = fill; // Stop auf Einstieg
      }
      // Wellen-5-Ende erkannt (nur mit Kerzen bis j): Gewinn zum Schlusskurs sichern
      if (reachedT1 && (opts.wave5Exit ?? setup.wave5Exit) && exhaustionAt(candles, rsis, j, dir as 1 | -1)) {
        exitIdx = j;
        exit = c.close;
        reason = "target";
        break;
      }
      if (reachedT1) {
        const a = opts.trailAtSignal ?? true ? setup.atr : atrs[j] ?? 0; // Standard wie in der App: fester Abstand
        const trail = dir === 1 ? c.close - trailAtr * a : c.close + trailAtr * a;
        if ((trail - stop) * dir > 0) stop = trail;
      }
    }
    if (exitIdx < 0) {
      exitIdx = Math.min(candles.length - 1, fillIdx + holdLimit);
      exit = candles[exitIdx].close;
      reason = exitIdx === candles.length - 1 ? "end" : "timeout";
    }
    // Teilausstieg: Hälfte bei Ziel 1, Rest beim endgültigen Ausstieg
    const effExit = partialExit != null ? (partialExit + exit) / 2 : exit;
    trades.push({
      direction: setup.direction,
      entryTime: candles[fillIdx].time,
      entry: fill,
      stop: setup.stop,
      target,
      exitTime: candles[exitIdx].time,
      exit: effExit,
      reason,
      returnPct: tradeReturnPct(setup.direction, fill, effExit),
      score: setup.riskReward,
      pattern: setup.direction === "long" ? "Kaufzone im Aufwärtstrend" : "Verkaufszone im Abwärtstrend",
    });
    i = exitIdx + 1;
  }
  const stats = performance(trades.map((t) => ({ returnPct: t.returnPct, closedAt: t.exitTime * 1000 })));
  const first = candles[Math.min(warmup, candles.length - 1)]?.close ?? 0;
  const lastC = candles[candles.length - 1]?.close ?? 0;
  return { trades, stats, buyAndHold: first ? ((lastC - first) / first) * 100 : 0, evaluatedBars: evaluated };
}

export function runZoneBacktest(candles: Candle[], opts: ZoneBacktestOptions = {}): BacktestResult {
  const g = steps(candles, opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

export async function runZoneBacktestAsync(candles: Candle[], opts: ZoneBacktestOptions, onProgress?: (p: number) => void): Promise<BacktestResult> {
  const g = steps(candles, opts);
  let r = g.next();
  let last = Date.now();
  while (!r.done) {
    if (Date.now() - last > 40) {
      onProgress?.(r.value);
      await new Promise((res) => setTimeout(res, 0));
      last = Date.now();
    }
    r = g.next();
  }
  onProgress?.(1);
  return r.value;
}
