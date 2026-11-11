// EchoChart: Wie haben die Zonen von Blacktrader in der Vergangenheit gehalten? (gezählt wie HKCM)
// Jede Zone wird nur mit Kerzen bis zu ihrem Entstehen gefunden und danach mit den folgenden Kerzen bewertet.
import type { Candle, Horizon, Interval, AssetKind } from "../types";
import type { BacktestResult } from "./backtest";
import { findLongTermZone, runLongTermEcho, type LongTermEcho } from "./longterm";
import { LOCKED } from "./locked-config";
import { DEFAULT_PARAMS, type LearnableParams } from "./params";
import { runZoneBacktestAsync } from "./zoneBacktest";
import { zoneOutcome } from "./zoneOutcome";
import { signalFromAnalysis } from "../trainer/engine";

export type EchoKind = "trade" | "short" | "core";

export interface EchoZone {
  kind: EchoKind;
  /** Zeitpunkt der Zone und des Ergebnisses */
  t: number;
  at: number;
  top: number;
  bottom: number;
  ok: 0 | 1;
}

export interface EchoResult {
  zones: EchoZone[];
  trades: BacktestResult;
  /** Blaue Langfrist-Trades */
  ltTrades: LongTermEcho["trades"];
  from: number;
  to: number;
  bars: number;
}

export interface EchoSummary {
  zones: number;
  held: number;
  rate: number | null;
  byKind: Record<EchoKind, { zones: number; held: number }>;
}

export function summarize(zones: EchoZone[]): EchoSummary {
  const byKind: EchoSummary["byKind"] = { trade: { zones: 0, held: 0 }, short: { zones: 0, held: 0 }, core: { zones: 0, held: 0 } };
  for (const z of zones) {
    byKind[z.kind].zones++;
    byKind[z.kind].held += z.ok;
  }
  const held = zones.reduce((s, z) => s + z.ok, 0);
  return { zones: zones.length, held, rate: zones.length ? held / zones.length : null, byKind };
}

export async function runEcho(
  candles: Candle[],
  o: { kind: AssetKind; horizon: Horizon; interval: Interval; params?: LearnableParams },
  onProgress?: (p: number) => void,
): Promise<EchoResult> {
  const zones: EchoZone[] = [];
  const seen = new Set<string>();
  const params = o.params ?? DEFAULT_PARAMS;
  // Grün / Rot: dieselben Signale wie in der App und im Turnier (Analyse mit allen Prüfungen, auch ohne gelernte Werte)
  const trades = await runZoneBacktestAsync(
    candles,
    {
      warmup: 200,
      signalAt: (h: Candle[]) => signalFromAnalysis(h, { kind: o.kind, horizon: o.horizon, interval: o.interval }, params),
      onSignal: ({ index, time, setup }) => {
        const key = `${setup.zoneStart}:${setup.zoneEnd}`;
        if (seen.has(key)) return;
        seen.add(key);
        const dir = setup.direction === "long" ? 1 : -1;
        const r = zoneOutcome(candles, index, { top: setup.zoneStart, bottom: setup.zoneEnd, dir, cancel: setup.cancelAbove, maxWait: LOCKED.trade.maxWaitBars });
        if (r) zones.push({ kind: dir === 1 ? "trade" : "short", t: time, at: r.at, top: setup.zoneStart, bottom: setup.zoneEnd, ok: r.result === "erfolg" ? 1 : 0 });
      },
    },
    (p) => onProgress?.(p * 0.8),
  );
  // Blau: langfristige Einstiegsbereiche
  const step = Math.max(1, Math.ceil(candles.length / 2000));
  const lseen = new Set<string>();
  for (let i = 150, n = 0; i < candles.length; i += step, n++) {
    if (n % 100 === 0) {
      onProgress?.(0.8 + 0.2 * (i / candles.length));
      await new Promise((r) => setTimeout(r, 0));
    }
    const z = findLongTermZone(candles.slice(Math.max(0, i - 599), i + 1));
    if (!z || z.status !== "zulaufend" || lseen.has(z.key)) continue;
    lseen.add(z.key);
    const r = zoneOutcome(candles, i, { top: z.zoneTop, bottom: z.zoneBottom, dir: 1, cancel: z.high.price, maxWait: Number.MAX_SAFE_INTEGER });
    if (r) zones.push({ kind: "core", t: candles[i].time, at: r.at, top: z.zoneTop, bottom: z.zoneBottom, ok: r.result === "erfolg" ? 1 : 0 });
  }
  // Blaue Trades (Einstieg in drei Teilen, wie im Turnier) für die Kontorechnung
  const ltTrades = runLongTermEcho(candles, undefined, step).trades;
  onProgress?.(1);
  zones.sort((a, b) => a.t - b.t);
  return { zones, trades, ltTrades, from: candles[0].time, to: candles[candles.length - 1].time, bars: candles.length };
}
