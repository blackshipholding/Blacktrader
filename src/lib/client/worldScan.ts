"use client";
// Welt-Suche (Nutzer 13.11.2026): Chancen in rund 1.000 weiteren Werten (Industrieländer, große Schwellenländer Asiens, Coins,
// Rohstoffe) NUR messen – gleiche Analyse und gleiche Chancen-Regeln wie die normale Suche, aber ohne Firmenzahlen/Nachrichten.
// Die Ergebnisse stehen in einer EIGENEN Liste (bt-world-log-v1) und ändern weder Chancen-Liste noch die bisherige Live-Bilanz.
// Es wird nichts gehandelt. Läuft höchstens einmal am Tag (App offen), in Etappen, und setzt nach einer Unterbrechung fort.
import { useSyncExternalStore } from "react";
import { analyze } from "../analysis/analyze";
import { financeCheck } from "../analysis/finance";
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
const ON_KEY = "bt-world-scan-on";
/** Anteil der Welt-Werte, die pro Tag angeschaut werden (Nutzer 13.11.2026: 30 %), verteilt über den Tag in kleinen Stücken */
export const DAILY_SHARE = 0.3;
/** Ein Stück = so viele Werte, danach Pause bis zum nächsten Stück (Yahoo schonen) */
export const SLICE = 25;
const SLICE_EVERY_MS = 40 * 60e3;
const BATCH = 60;
const PARALLEL = 3;
/** Schutz für Yahoo: zwischen zwei Abfragen kurz warten; fällt mehr als die Hälfte einer Etappe aus (z. B. „zu viele Anfragen“), wird für heute abgebrochen */
const PAUSE_MS = 250;
const MAX_FAIL_SHARE = 0.5;

/** `fin`: Aktie mit geprüften Firmenzahlen („geprüft“) oder ohne verfügbare Daten („ohne Daten“) – zum späteren Auswerten */
export type WorldEntry = ChanceLogEntry & { region: WorldRegion; fin?: "geprüft" | "ohne Daten" };
export interface WorldProgress {
  day: string;
  /** Wo der Umlauf als Nächstes weitermacht */
  cursor: number;
  /** Heute schon gesuchte Werte */
  doneToday: number;
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
/** Läuft automatisch wie die normale Suche (Nutzer 13.11.2026: kein Schalter); Yahoo wird durch die Tagesgrenze geschont */
export const worldScanOn = () => rd<boolean>(ON_KEY, true) === true;
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
  // Finanz-Prüfung wie in der normalen Suche, aber nur für die wenigen Werte, die tatsächlich eine Chance sind (1 Zusatz-Abruf je Chance):
  // schwache Firmen (hohe Schulden und Geld verbrennen) kommen nicht in die Messung; ohne verfügbare Zahlen bleibt der Wert, wird aber vermerkt
  let fin: WorldEntry["fin"];
  if (a.kind === "stock") {
    try {
      const f = (await api.fundamentals(a)).fundamentals;
      if (financeCheck(f).weak) return true;
      fin = f ? "geprüft" : "ohne Daten";
    } catch {
      fin = "ohne Daten";
    }
  }
  const blue = best.color === "blau";
  const stop = blue ? best.invalidation : best.stop;
  const target = best.targets?.[0];
  if (stop == null || target == null || !(stop > 0) || !(target > 0)) return true;
  const ckey = `${key}|${best.key}`;
  if (log.some((x) => x.key === ckey) || add.some((x) => x.key === ckey)) return true;
  const now = Math.floor(Date.now() / 1000);
  const fresh: WorldEntry = { key: ckey, symbol: a.symbol, name: a.name, kind: a.kind, color: best.color, dir: "long", zoneTop: best.zoneTop, zoneBottom: best.zoneBottom, stop, target, from: now, region: regionOf(a), ...(fin ? { fin } : {}) };
  add.push(fresh);
  return true;
}

/** Ein Stück der Welt-Suche (höchstens `slice` Werte; Tagesgrenze = DAILY_SHARE aller Werte, danach am nächsten Tag weiter). `force`: auch über die Tagesgrenze hinaus. */
export async function runWorldScan(force = false, slice = Infinity): Promise<void> {
  if (busy.running || typeof window === "undefined") return;
  const day = today();
  const all = worldAssets();
  const quota = Math.min(all.length, Math.ceil(all.length * DAILY_SHARE));
  let prog = rd<WorldProgress | null>(PROG_KEY, null) ?? { day, cursor: 0, doneToday: 0 };
  if (prog.day !== day) prog = { day, cursor: prog.cursor % all.length, doneToday: 0 };
  if (prog.doneToday >= quota && !force) return;
  if (force && prog.doneToday >= quota) prog = { ...prog, doneToday: 0 };
  busy = { running: true, text: `Welt-Suche 0/${quota}` };
  emit();
  try {
    await Promise.race([refreshTrainerParams(), new Promise((r) => setTimeout(r, 3000))]);
    const ctx = await fetchMarketContext();
    let doneNow = 0;
    while (prog.doneToday < quota && doneNow < slice) {
      const n = Math.min(BATCH, quota - prog.doneToday, slice - doneNow);
      const batch = Array.from({ length: n }, (_, i) => all[(prog.cursor + i) % all.length]);
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
      if (failed > batch.length * MAX_FAIL_SHARE) return; // Yahoo bremst oder kein Netz: nichts weiter, beim nächsten Mal an derselben Stelle
      doneNow += n;
      prog = { day, cursor: (prog.cursor + n) % all.length, doneToday: prog.doneToday + n };
      wr(PROG_KEY, prog);
      busy = { running: true, text: `Welt-Suche ${prog.doneToday}/${quota}` };
      emit();
      if (typeof document !== "undefined" && document.visibilityState === "hidden") break; // im Hintergrund pausieren
    }
  } finally {
    busy = { running: false, text: "" };
    emit();
  }
}

/** Über den Tag verteilt: erstes Stück 3 Minuten nach dem App-Start, dann alle 40 Minuten ein Stück, solange die App sichtbar ist */
export function startWorldScan(): () => void {
  if (typeof window === "undefined") return () => {};
  const tick = () => {
    if (!worldScanOn()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void runWorldScan(false, SLICE);
  };
  const first = setTimeout(tick, 180e3);
  const every = setInterval(tick, SLICE_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
