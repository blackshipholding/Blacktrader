// Live-Bilanz aller Chancen: Jede Chance, die in der Liste steht (höchstens 20), wird ab dem ersten Erscheinen mitgeschrieben
// – auch wenn du sie nicht übernimmst. Danach prüft jede Suche mit den neuen Kerzen, was daraus wurde:
//   Ziel erreicht (nach dem Einstieg) · Stop bzw. ungültig · verpasst (Ziel ohne Einstieg) · läuft noch.
// So entsteht eine ehrliche Trefferquote ab heute, die nicht nachträglich schöngerechnet ist.
import type { Candle } from "../types";
import { actions, getData } from "../store/store";
import { notify } from "./alerts";
import { liveCheck } from "./liveCheck";
import { creditsFor } from "../analysis/dividends";
import { eventsFor, loadDividends } from "./dividendBook";

export type ChanceResult = "ziel" | "stop" | "verpasst";

export interface ChanceLogEntry {
  /** Wert + Einstieg (gleiche Chance wird nur einmal gezählt) */
  key: string;
  symbol: string;
  name: string;
  kind: string;
  color: "blau" | "gruen" | "rot";
  dir: "long" | "short";
  zoneTop: number;
  zoneBottom: number;
  /** Stop (grün/rot) bzw. Ungültig-Grenze (blau, Schlusskurs) */
  stop: number;
  target: number;
  /** erstes Erscheinen (Unix-Sekunden) */
  from: number;
  /** Einstieg ausgelöst */
  entered?: number;
  result?: ChanceResult;
  at?: number;
  /** Dividenden zwischen Einstieg und Ergebnis (bzw. heute), brutto in % des Einstiegskurses – nur Aktien; Treffer (Ziel/Stop) bleiben unverändert */
  divPct?: number;
}

export interface ChanceCandidate {
  key: string;
  symbol: string;
  name: string;
  kind: string;
  color: "blau" | "gruen" | "rot";
  dir: "long" | "short";
  zoneTop: number;
  zoneBottom: number;
  stop: number;
  target: number;
  candles: Candle[];
}

/** Prüft einen offenen Eintrag mit Kerzen (nur Kerzen nach dem ersten Erscheinen). */
export function evaluateChance(e: ChanceLogEntry, candles: Candle[]): ChanceLogEntry {
  if (e.result) return e;
  const out = { ...e };
  const long = e.dir === "long";
  const entryPx = long ? e.zoneTop : e.zoneBottom;
  for (const c of candles) {
    if (c.time <= e.from) continue;
    if (!out.entered) {
      const hit = long ? c.low <= entryPx : c.high >= entryPx;
      if (hit) out.entered = c.time;
      else if (long ? c.high >= e.target : c.low <= e.target) return { ...out, result: "verpasst", at: c.time };
      if (!hit) continue;
    }
    // Nach dem Einstieg: was kommt zuerst? (bei Blau zählt der Schlusskurs unter der Ungültig-Grenze)
    const stopHit = e.color === "blau" ? c.close < e.stop : long ? c.low <= e.stop : c.high >= e.stop;
    const targetHit = long ? c.high >= e.target : c.low <= e.target;
    if (stopHit) return { ...out, result: "stop", at: c.time };
    if (targetHit) return { ...out, result: "ziel", at: c.time };
  }
  return out;
}

/**
 * Nach jeder Suche: neue Chancen (aus der Liste) eintragen, offene mit den neuen Kerzen prüfen.
 * `check`: Kerzen aller Werte der Suche (auch solcher, die gerade nicht mehr in der Liste stehen).
 */
/** Wo die Liste liegt: Standard = Live-Bilanz der App; die „alte Variante“ während einer Variantenmessung liegt getrennt (client/trial.ts) */
export interface LogStore {
  get: () => ChanceLogEntry[];
  set: (l: ChanceLogEntry[]) => void;
  /** Warnung „Live-Bilanz deutlich schlechter“ erlauben (nur für die sichtbare Live-Bilanz) */
  warn: boolean;
}
const APP_STORE: LogStore = { get: () => getData().chanceLog, set: (l) => actions.setChanceLog(l), warn: true };

export function updateChanceLog(cands: ChanceCandidate[], now = Math.floor(Date.now() / 1000), check: ChanceCandidate[] = cands, store: LogStore = APP_STORE) {
  const log = [...store.get()];
  const byKey = new Map(log.map((x, i) => [x.key, i]));
  let changed = false;
  for (const c of cands) {
    if (byKey.has(c.key) || !(c.target > 0) || !(c.stop > 0)) continue;
    const { candles: _c, ...rest } = c;
    void _c;
    byKey.set(c.key, log.length);
    log.push({ ...rest, from: now });
    changed = true;
  }
  const candlesOf = new Map(check.map((c) => [`${c.kind}:${c.symbol}`, c.candles]));
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.result) continue;
    const candles = candlesOf.get(`${e.kind}:${e.symbol}`);
    if (!candles?.length) continue;
    const next = evaluateChance(e, candles);
    if (next.result !== e.result || next.entered !== e.entered) {
      log[i] = next;
      changed = true;
    }
  }
  // Dividenden zwischen Einstieg und Ergebnis (Anspruch: vor dem Ex-Tag besessen, ausgezahlt bis heute) – nur Rendite, nicht die Treffer
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.kind !== "stock" || !e.entered || e.dir !== "long") continue;
    const from = e.entered * 1000;
    void loadDividends({ kind: e.kind, symbol: e.symbol }, from);
    const ev = eventsFor({ kind: e.kind, symbol: e.symbol });
    if (!ev.length) continue;
    const entryPx = e.zoneTop;
    const sum = creditsFor([{ qty: 1, from, to: e.at != null ? e.at * 1000 : undefined }], ev).reduce((a, c) => a + c.amount, 0);
    const pct = entryPx > 0 ? (sum / entryPx) * 100 : 0;
    if (Math.abs(pct - (e.divPct ?? 0)) > 1e-6) {
      log[i] = { ...e, divPct: pct };
      changed = true;
    }
  }
  if (changed) {
    store.set(log);
    if (store.warn) warnIfWorse(log);
  }
}

/** Einmal melden, wenn die Live-Bilanz deutlich schlechter ist als erwartet (Stufe 1 der Kontrolle) */
function warnIfWorse(log: ChanceLogEntry[]) {
  const c = liveCheck(log);
  if (!c.warn) return;
  try {
    const key = "bt-live-warned";
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  const s = getData().settings;
  const rate = c.all.rate != null ? Math.round(c.all.rate * 100) : null;
  void notify("Live-Bilanz schlechter als erwartet", `Treffer ${rate ?? "–"} % bei ${c.all.n} Ergebnissen – laut Test wären etwa ${Math.round(c.all.expected * 100)} % zu erwarten. Das ist mehr als Zufall – die Regeln sollten geprüft werden.`, { sound: s.sound, notifications: s.notifications, kind: "info" });
}

export interface ChanceStats {
  since?: number;
  total: number;
  ziel: number;
  stop: number;
  verpasst: number;
  open: number;
  /** Ziel / (Ziel + Stop) */
  hitRate: number | null;
}

export function chanceStats(log: ChanceLogEntry[], color?: ChanceLogEntry["color"]): ChanceStats {
  const xs = color ? log.filter((x) => x.color === color) : log;
  const n = (r: ChanceResult) => xs.filter((x) => x.result === r).length;
  const ziel = n("ziel");
  const stop = n("stop");
  return { since: xs.reduce<number | undefined>((m, x) => (m == null || x.from < m ? x.from : m), undefined), total: xs.length, ziel, stop, verpasst: n("verpasst"), open: xs.filter((x) => !x.result).length, hitRate: ziel + stop ? ziel / (ziel + stop) : null };
}
