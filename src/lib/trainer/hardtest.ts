// Härtetest im Trainer (Shipmaster 0.1, Regelwerk B8) – die schnelle Version des großen Härtetests
// (100 × 1 Mio. Kunden, 11.11.2026). Ein neuer Lernstand wird nur gespeichert, wenn er ALLE Prüfungen besteht:
//   1. beide Zeithälften nicht schlechter
//   2. bärische Zeiträume nicht schlechter
//   3. nicht mehr Kunden mit Verlust, die schlechtesten 5 % nicht schlechter
//   4. Ausfall-Prüfung: 5 × ohne zufällige 20 % der Werte – in mindestens 4 von 5 Fällen besser
//   5. Kosten-Prüfung: doppelte Gebühren + 0,5 % schlechtere Kurse – nicht schlechter
//   6. die letzten 2 Jahre bleiben gesperrt (nur Schlusskontrolle, nie zum Lernen)
// … und netto mindestens +0,2 Prozentpunkte pro Jahr besser (kleinere Unterschiede = Zufall).
// Kunden = jeder Wochen-Start × 12 Depotgrößen (10.000 € – 1 Mio. €), je 5 Jahre, Shipmaster-Regeln für alle.
// B9: gegen die 9 Gegner dieses Turniers (sie wechseln sich ab) darf der neue Stand in der Rangliste nicht abrutschen.
import type { Candle } from "../types";
import { cagr, prepareWindow, regimeIndex, runWindow, type PoolTrade, type PreparedWindow, type RunOpts, type Scenario, type Window } from "./tournament";

const YEAR = 365.25 * 86400;
const WEEK = 7 * 86400;
/** 12 Depotgrößen von 10.000 € bis 1 Mio. € (gleichmäßig auf der Log-Skala) */
export const HT_CAPS: number[] = Array.from({ length: 12 }, (_, k) => Math.round((10000 * Math.pow(100, k / 11)) / 100) * 100);
export const HT_LOCK_YEARS = 2;
export const HT_MIN_GAIN = 0.002;
export const HT_STRESS: RunOpts = { fee: 2 * 7.9, slip: 0.005 };

/** Marktlage eines Zeitraums (wie die Turnier-Zeiträume) */
export function scenarioOf(spx: Candle[], a: number, b: number): Scenario {
  const regimeOf = regimeIndex(spx);
  const cnt = { bullisch: 0, neutral: 0, baerisch: 0 };
  let n = 0;
  for (const c of spx) {
    if (c.time < a || c.time > b) continue;
    const g = regimeOf(c.time);
    if (g) (cnt[g]++, n++);
  }
  const sh = (g: keyof typeof cnt) => (n ? cnt[g] / n : 0);
  return sh("baerisch") >= 0.15 ? "baerisch" : sh("bullisch") >= 0.55 ? "bullisch" : sh("bullisch") < 0.45 ? "neutral" : "gemischt";
}

/**
 * Kunden für den Härtetest: jeder Wochen-Start × alle Depotgrößen, je 5 Jahre. `learn` = nur Zeiträume, die vor der
 * Sperre (letzte 2 Jahre) enden; `locked` = Zeiträume, die in die Sperre reichen (nur Schlusskontrolle).
 */
export function hardtestWindows(spx: Candle[], from: number, caps: number[] = HT_CAPS, years = 5): { learn: Window[]; locked: Window[] } {
  const learn: Window[] = [];
  const locked: Window[] = [];
  if (!spx.length) return { learn, locked };
  const last = spx[spx.length - 1].time;
  const lockFrom = last - HT_LOCK_YEARS * YEAR;
  let k = 0;
  for (let a = from; a + years * YEAR <= last; a += WEEK, k++) {
    const b = a + years * YEAR;
    const scenario = scenarioOf(spx, a, b);
    const list = b <= lockFrom ? learn : locked;
    for (const cap of caps) list.push({ from: Math.round(a), to: Math.round(b), scenario, cap, k });
  }
  return { learn, locked };
}

export interface HtStats {
  n: number;
  avg: number;
  h1: number;
  h2: number;
  bear: number;
  lossShare: number;
  worst5: number;
  brokeShare: number;
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);

/** Kennzahlen eines Trade-Pools über die Härtetest-Kunden */
export function htStats(pool: PoolTrade[], windows: Window[], priceAt: (sym: string, t: number) => number | null, opts: RunOpts = {}): HtStats {
  const ks = windows.map((w) => w.k ?? 0);
  const mid = ks.length ? (Math.min(...ks) + Math.max(...ks)) / 2 : 0;
  const g: number[] = [];
  const h1: number[] = [];
  const h2: number[] = [];
  const bear: number[] = [];
  let broke = 0;
  // Reihenfolge je Zeitraum nur einmal bestimmen (alle Depotgrößen haben dieselben Termine)
  let prepKey = "";
  let prep: PreparedWindow | undefined;
  for (const w of windows) {
    const key = `${w.from}:${w.to}`;
    if (key !== prepKey) (prepKey = key), (prep = prepareWindow(pool, w));
    const r = runWindow(pool, w, priceAt, opts, prep);
    const x = cagr(r.end, r.cap ?? w.cap);
    g.push(x);
    ((w.k ?? 0) <= mid ? h1 : h2).push(x);
    if (w.scenario === "baerisch") bear.push(x);
    if (r.broke) broke++;
  }
  const sorted = [...g].sort((a, b) => a - b);
  const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)));
  return { n: g.length, avg: mean(g), h1: mean(h1), h2: mean(h2), bear: bear.length ? mean(bear) : 0, lossShare: g.length ? g.filter((x) => x < 0).length / g.length : 0, worst5: mean(worst), brokeShare: g.length ? broke / g.length : 0 };
}

/** Reproduzierbare Auswahl: Werte, die bei Ausfall-Durchgang `seed` fehlen (20 %) */
function dropped(sym: string, seed: number): boolean {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < sym.length; i++) h = Math.imul(h ^ sym.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100) < 20;
}

export interface HtResult {
  veto: string | null;
  base: HtStats;
  cand: HtStats;
  dropoutWins: number;
  stress: { base: number; cand: number };
}

const pc = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;

/** Werte des bisherigen Stands – bleiben in einer Lernsitzung gleich und werden nur einmal gerechnet */
export interface HtBaseCache {
  base?: HtStats;
  drop?: number[];
  stress?: number;
}

/** B8: alle Prüfungen des Härtetests – Rückgabe Grund für ein Nein, sonst veto = null */
export function b8Hardtest(basePool: PoolTrade[], candPool: PoolTrade[], windows: Window[], priceAt: (sym: string, t: number) => number | null, cache: HtBaseCache = {}): HtResult {
  const base = (cache.base ??= htStats(basePool, windows, priceAt));
  const cand = htStats(candPool, windows, priceAt);
  const tol = 1e-9;
  let dropoutWins = 0;
  cache.drop ??= [1, 2, 3, 4, 5].map((s) => htStats(basePool.filter((p) => !dropped(p.sym, s)), windows, priceAt).avg);
  for (let s = 1; s <= 5; s++) {
    if (htStats(candPool.filter((p) => !dropped(p.sym, s)), windows, priceAt).avg > cache.drop[s - 1] + tol) dropoutWins++;
  }
  cache.stress ??= htStats(basePool, windows, priceAt, HT_STRESS).avg;
  const stress = { base: cache.stress, cand: htStats(candPool, windows, priceAt, HT_STRESS).avg };
  let veto: string | null = null;
  if (cand.avg < base.avg + HT_MIN_GAIN) veto = `Härtetest: nicht genug besser (${pc(cand.avg)} statt ${pc(base.avg)}, nötig +0,2 Punkte)`;
  else if (cand.h1 < base.h1 - tol || cand.h2 < base.h2 - tol) veto = "Härtetest: in einer Zeithälfte schlechter";
  else if (cand.bear < base.bear - tol) veto = `Härtetest: in bärischen Zeiträumen schlechter (${pc(cand.bear)} statt ${pc(base.bear)})`;
  else if (cand.lossShare > base.lossShare + tol) veto = "Härtetest: mehr Kunden mit Verlust";
  else if (cand.worst5 < base.worst5 - tol) veto = "Härtetest: die schlechtesten 5 % der Kunden schneiden schlechter ab";
  else if (cand.brokeShare > base.brokeShare + tol) veto = "Härtetest: mehr Kunden ausgeschieden";
  else if (dropoutWins < 4) veto = `Härtetest: Ausfall-Prüfung nur ${dropoutWins} von 5 bestanden`;
  else if (stress.cand < stress.base - tol) veto = "Härtetest: mit doppelten Gebühren und schlechteren Kursen schlechter";
  return { veto, base, cand, dropoutWins, stress };
}

/** B9: Rangplatz gegen die Gegner dieses Turniers (höhere Ø-Rendite = besser) – darf nicht abrutschen */
export function b9Rank(baseAvg: number, candAvg: number, opponents: { avgPerYear: number }[]): { veto: string | null; baseRank: number; candRank: number } {
  const rankOf = (x: number) => 1 + opponents.filter((o) => o.avgPerYear > x + 1e-12).length;
  const baseRank = rankOf(baseAvg);
  const candRank = rankOf(candAvg);
  return { veto: candRank > baseRank ? `gegen die ${opponents.length} Gegner abgerutscht (Platz ${candRank} statt ${baseRank})` : null, baseRank, candRank };
}

/** Die Gegner wechseln sich ab: je Turnier `n` aus dem ganzen Pool, der Reihe nach (Startpunkt = Tag) */
export function rotateOpponents<T>(pool: T[], n: number, turn: number): T[] {
  if (pool.length <= n) return [...pool];
  const start = ((turn % pool.length) + pool.length) % pool.length;
  return Array.from({ length: n }, (_, i) => pool[(start + i * Math.max(1, Math.floor(pool.length / n))) % pool.length]).filter((x, i, a) => a.indexOf(x) === i).concat(pool).filter((x, i, a) => a.indexOf(x) === i).slice(0, n);
}
