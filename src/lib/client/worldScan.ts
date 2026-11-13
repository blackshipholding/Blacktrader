"use client";
// Welt-Suche (Nutzer 13.11.2026): Chancen in rund 1.000 weiteren Werten (Industrieländer, große Schwellenländer Asiens, Coins,
// Rohstoffe) NUR messen – gleiche Analyse und gleiche Chancen-Regeln wie die normale Suche, aber ohne Firmenzahlen/Nachrichten.
// Die Ergebnisse stehen in einer EIGENEN Liste (bt-world-log-v1) und ändern weder Chancen-Liste noch die bisherige Live-Bilanz.
// Es wird nichts gehandelt. Läuft höchstens einmal am Tag (App offen), in Etappen, und setzt nach einer Unterbrechung fort.
import { useSyncExternalStore } from "react";
import { analyze } from "../analysis/analyze";
import { findLongTermZone } from "../analysis/longterm";
import { pickBestEntry } from "../analysis/bestEntry";
import type { Candle, Horizon, ResolvedAsset } from "../types";
import { api } from "./api";
import { evaluateChance, type ChanceLogEntry } from "./chanceLog";
import { isTopChance, potential, fetchMarketContext, type ScanEntry } from "./scanner";
import { effectiveWeights, learnedParams, refreshTrainerParams } from "./trainerParams";
import { getData } from "../store/store";
import { regionOf, worldAssets, type WorldRegion } from "./worldList";

const LOG_KEY = "bt-world-log-v1";
const PROG_KEY = "bt-world-scan-v1";
const OFF_KEY = "bt-world-scan-off";
const BATCH = 60;
const PARALLEL = 3;
/** Schutz für Yahoo: zwischen zwei Abfragen kurz warten; fällt mehr als die Hälfte einer Etappe aus (z. B. „zu viele Anfragen“), wird für heute abgebrochen */
const PAUSE_MS = 250;
const MAX_FAIL_SHARE = 0.5;

export type WorldEntry = ChanceLogEntry & { region: WorldRegion };
export interface WorldProgress {
  day: string;
  done: number;
  total: number;
  finishedAt?: number;
}

let cache: WorldEntry[] | null = null;
let busy: { running: boolean; text: string } = { running: false, text: "" };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const rd = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const wr = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* Speicher voll */
  }
};

export const getWorldLog = (): WorldEntry[] => (cache ??= rd<WorldEntry[]>(LOG_KEY, []));
const saveLog = (l: WorldEntry[]) => {
  cache = l;
  wr(LOG_KEY, l);
  emit();
};
export const useWorldLog = (): WorldEntry[] =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getWorldLog, () => []);
export const useWorldBusy = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => busy, () => busy);
export const worldScanOn = () => rd<boolean>(OFF_KEY, false) === false;
export const setWorldScanOn = (on: boolean) => {
  wr(OFF_KEY, !on);
  emit();
};
const today = () => new Date().toISOString().slice(0, 10);

export interface RegionStats {
  region: WorldRegion;
  total: number;
  ziel: number;
  stop: number;
  verpasst: number;
  open: number;
  hitRate: number | null;
}
export function worldStats(log: WorldEntry[]): { all: RegionStats; byRegion: RegionStats[]; byColor: Record<"gruen" | "blau", RegionStats> } {
  const mk = (region: WorldRegion, xs: WorldEntry[]): RegionStats => {
    const ziel = xs.filter((x) => x.result === "ziel").length;
    const stop = xs.filter((x) => x.result === "stop").length;
    return { region, total: xs.length, ziel, stop, verpasst: xs.filter((x) => x.result === "verpasst").length, open: xs.filter((x) => !x.result).length, hitRate: ziel + stop ? ziel / (ziel + stop) : null };
  };
  const regions = [...new Set(log.map((x) => x.region))];
  return {
    all: mk("USA", log),
    byRegion: regions.map((r) => mk(r, log.filter((x) => x.region === r))),
    byColor: { gruen: mk("USA", log.filter((x) => x.color === "gruen")), blau: mk("USA", log.filter((x) => x.color === "blau")) },
  };
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Einen Wert analysieren: neue Chance eintragen, offene Chancen dieses Werts prüfen */
async function scanOne(asset: ResolvedAsset, ctx: Awaited<ReturnType<typeof fetchMarketContext>>, log: WorldEntry[], add: WorldEntry[]): Promise<boolean> {
  const { settings } = getData();
  const [d, w] = await Promise.allSettled([api.candles(asset, "1d", 6 * 3600e3), api.candles(asset, "1w", 6 * 3600e3)]);
  if (d.status !== "fulfilled" || w.status !== "fulfilled") return false;
  const daily = d.value.candles;
  const weekly = w.value.candles;
  const currency = d.value.currency ?? asset.currency;
  const a: ResolvedAsset = { ...asset, currency };
  const res = (candles: Candle[], horizon: Horizon, interval: "1d" | "1w") =>
    candles.length >= 30 ? analyze({ symbol: a.symbol, name: a.name, candles, horizon, interval, weights: effectiveWeights(settings, a.kind, horizon), kind: a.kind, currency, params: learnedParams(a.kind, horizon) }) : null;
  const medium = daily.length >= 150 ? res(daily, "medium", "1d") : null;
  const long = weekly.length >= 150 ? res(weekly, "long", "1w") : null;
  const lt = weekly.length >= 150 ? findLongTermZone(weekly) : null;
  const ltOk = lt && lt.status !== "invalidiert" ? lt : null;
  const horizons: ScanEntry["horizons"] = {};
  if (medium) horizons.medium = { res: medium, candles: daily.slice(-150) };
  if (long) horizons.long = { res: long, candles: weekly.slice(-150) };
  const key = `${a.kind}:${a.symbol}`;
  // Offene Einträge dieses Werts mit den frischen Kerzen prüfen
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.result || `${e.kind}:${e.symbol}` !== key) continue;
    log[i] = { ...evaluateChance(e, e.color === "blau" ? weekly : daily), region: e.region };
  }
  const best = pickBestEntry({ symbol: a.symbol, kind: a.kind, views: { medium: medium ?? null, long: long ?? null }, lt: ltOk, ctx, done: new Set() });
  if (best.color === "gelb" || best.color === "rot" || best.zoneTop == null || best.zoneBottom == null) return true;
  const entry = { asset: a, horizons, longterm: ltOk, ltHorizon: "long", ltCandles: ltOk ? weekly.slice(-150) : undefined, best, history: { past: [] }, daily } as unknown as ScanEntry;
  if (!isTopChance(entry) || potential(entry) == null) return true;
  const blue = best.color === "blau";
  const stop = blue ? best.invalidation : best.stop;
  const target = best.targets?.[0];
  if (stop == null || target == null || !(stop > 0) || !(target > 0)) return true;
  const ckey = `${key}|${best.key}`;
  if (log.some((x) => x.key === ckey) || add.some((x) => x.key === ckey)) return true;
  const now = Math.floor(Date.now() / 1000);
  const fresh: WorldEntry = { key: ckey, symbol: a.symbol, name: a.name, kind: a.kind, color: best.color, dir: "long", zoneTop: best.zoneTop, zoneBottom: best.zoneBottom, stop, target, from: now, region: regionOf(a) };
  add.push(fresh);
  return true;
}

/** Heutige Welt-Suche starten (oder fortsetzen). `force`: auch wenn heute schon fertig. */
export async function runWorldScan(force = false): Promise<void> {
  if (busy.running || typeof window === "undefined") return;
  const day = today();
  const all = worldAssets();
  let prog = rd<WorldProgress | null>(PROG_KEY, null);
  if (!prog || prog.day !== day) prog = { day, done: 0, total: all.length };
  else if (prog.finishedAt && !force) return;
  else if (prog.finishedAt && force) prog = { day, done: 0, total: all.length };
  busy = { running: true, text: `Welt-Suche ${prog.done}/${all.length}` };
  emit();
  try {
    await Promise.race([refreshTrainerParams(), new Promise((r) => setTimeout(r, 3000))]);
    const ctx = await fetchMarketContext();
    while (prog.done < all.length) {
      const batch = all.slice(prog.done, prog.done + BATCH);
      const log = [...getWorldLog()];
      const add: WorldEntry[] = [];
      let failed = 0;
      await pool(batch, PARALLEL, async (a) => {
        try {
          if (!(await scanOne(a, ctx, log, add))) failed++;
        } catch {
          failed++;
        }
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      });
      saveLog([...log, ...add]);
      if (failed > batch.length * MAX_FAIL_SHARE) {
        // Yahoo bremst oder das Netz fehlt: nicht weiter hämmern, beim nächsten Start an derselben Stelle weitermachen
        busy = { running: false, text: "" };
        emit();
        return;
      }
      prog = { ...prog, done: prog.done + batch.length };
      wr(PROG_KEY, prog);
      busy = { running: true, text: `Welt-Suche ${prog.done}/${all.length}` };
      emit();
      if (typeof document !== "undefined" && document.visibilityState === "hidden") break; // im Hintergrund pausieren
    }
    if (prog.done >= all.length) wr(PROG_KEY, { ...prog, finishedAt: Date.now() });
  } finally {
    busy = { running: false, text: "" };
    emit();
  }
}

/** Beim App-Start: einmal am Tag, nach kurzer Wartezeit */
export function startWorldScan(): () => void {
  if (typeof window === "undefined") return () => {};
  const t = setTimeout(() => {
    if (worldScanOn()) void runWorldScan(false);
  }, 180e3);
  return () => clearTimeout(t);
}
