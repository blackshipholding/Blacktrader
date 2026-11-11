// Langfristiger Einstieg (blau): breiter Einstiegsbereich am erwarteten Ende einer großen Korrektur.
// Vorgehen wie bei professionellen Elliott-Analysten: Nach einer großen Aufwärtswelle (Welle 1 bzw. eine
// Impulswelle im Aufwärtstrend) wird die Korrektur (Welle 2) im Bereich 61,8–88,6 % erwartet. Eingestiegen
// wird in drei Teilen (Oberkante, Mitte, Unterkante). Es gibt zunächst KEINEN festen Stop – nur eine
// Invalidierung (Schlusskurs unter dem Wellenstart). Teilausstieg und Stop gibt es nur, wenn sich die
// Zählung ändert bzw. Blacktrader das Alternativszenario für wahrscheinlicher hält.
import type { Candle } from "../types";
import type { ElliottResult, WaveCount } from "./elliott";
import { atr, exhaustionAt, rsi } from "./indicators";
import { LOCKED } from "./locked-config";
import { zigzag, type Pivot } from "./zigzag";

export interface LongTermOptions {
  /** Swing-Grad für große Wellen (ATR-Vielfaches) */
  atrMult: number;
  /** Mindestgröße der Aufwärtswelle in ATR */
  minMoveAtr: number;
  /** Oberkante / Unterkante des Bereichs (Anteil der Welle, der korrigiert ist) */
  zoneTop: number;
  zoneBottom: number;
}

export const DEFAULT_LONGTERM: LongTermOptions = { atrMult: LOCKED.longterm.atrMult, minMoveAtr: LOCKED.longterm.minMoveAtr, zoneTop: LOCKED.longterm.zoneTop, zoneBottom: LOCKED.longterm.zoneBottom };

export type LongTermStatus = "zulaufend" | "in-zone" | "invalidiert";

export interface LongTermZone {
  /** Wellenstart (0) = Invalidierung, Hoch der Welle (1) */
  start: { time: number; price: number };
  high: { time: number; price: number };
  zoneTop: number;
  zoneBottom: number;
  /** Schlusskurs darunter = Zählung falsch */
  invalidation: number;
  /** Ziel 1 = altes Hoch (Welle 1), Ziel 2 = typisches Ziel von Welle 3 */
  targets: [number, number];
  /** Einstieg in drei Teilen */
  tranches: [number, number, number];
  status: LongTermStatus;
  /** Tiefster Kurs seit dem Hoch */
  deepest: number;
  /** "neuer Trend" (Boden + kräftiger Anstieg) oder "Trendfortsetzung" (höheres Hoch) */
  context: "neuer Trend" | "Trendfortsetzung";
  /** Kennung (bleibt gleich, solange es derselbe Bereich ist) */
  key: string;
}

/** Sucht den aktuellen Langfrist-Einstiegsbereich. null = keiner (z. B. kein Aufwärtstrend oder Bereich verpasst). */
export function findLongTermZone(candles: Candle[], o: LongTermOptions = DEFAULT_LONGTERM): LongTermZone | null {
  // Wie im Test (runLongTermEcho, Turnier): höchstens die letzten 600 Kerzen
  if (candles.length > 600) candles = candles.slice(-600);
  if (candles.length < 150) return null;
  const a = atr(candles)[candles.length - 1];
  if (!a) return null;
  const pv = zigzag(candles, o.atrMult);
  // Letztes BESTÄTIGTES Hoch mit dem Tief davor
  let hi = -1;
  for (let i = pv.length - 1; i >= 1; i--) {
    if (pv[i].type === "H" && pv[i].confirmed && pv[i - 1].type === "L") {
      hi = i;
      break;
    }
  }
  if (hi < 1) return null;
  const H = pv[hi];
  const L = pv[hi - 1];
  const move = H.price - L.price;
  if (move < o.minMoveAtr * a) return null;
  // Bullischer Zusammenhang: höheres Hoch (Trendfortsetzung) oder neues Tief mit kräftigem Anstieg (neuer Trend)
  const prevH = findPrev(pv, hi - 1, "H");
  const prevL = findPrev(pv, hi - 1, "L");
  let context: LongTermZone["context"] | null = null;
  if (prevH && H.price > prevH.price && (!prevL || L.price > prevL.price)) context = "Trendfortsetzung";
  else if (prevH && prevL && L.price < prevL.price && move >= 0.382 * (prevH.price - L.price)) context = "neuer Trend";
  else if (!prevH) context = "neuer Trend";
  if (!context) return null;

  const after = candles.slice(H.index + 1);
  if (after.some((c) => c.high > H.price)) return null; // neues Hoch: Welle läuft weiter
  const zoneTop = H.price - o.zoneTop * move;
  const zoneBottom = H.price - o.zoneBottom * move;
  const deepest = after.length ? Math.min(...after.map((c) => c.low)) : H.price;
  const invalid = after.some((c) => c.close < L.price);
  const entered = deepest <= zoneTop;
  const mid = (zoneTop + zoneBottom) / 2;
  return {
    start: { time: L.time, price: L.price },
    high: { time: H.time, price: H.price },
    zoneTop,
    zoneBottom,
    invalidation: L.price,
    targets: [H.price, mid + 1.618 * move],
    tranches: [zoneTop, mid, zoneBottom],
    status: invalid ? "invalidiert" : entered ? "in-zone" : "zulaufend",
    deepest,
    context,
    key: `${L.time}:${H.time}`,
  };
}

function findPrev(pv: Pivot[], from: number, type: "H" | "L"): Pivot | undefined {
  for (let i = from - 1; i >= 0; i--) if (pv[i].type === type) return pv[i];
  return undefined;
}

/** Kurzer, verständlicher Text zum Bereich. */
export function longTermText(z: LongTermZone, fmt: (n: number) => string): string {
  const what = z.context === "neuer Trend" ? "Nach dem Boden ist ein kräftiger Anstieg gelaufen (Welle 1)." : "Der große Aufwärtstrend läuft (höheres Hoch).";
  const state =
    z.status === "in-zone"
      ? "Der Kurs ist im Einstiegsbereich."
      : z.status === "zulaufend"
        ? "Erwartet wird ein Rücksetzer in den Einstiegsbereich."
        : "Die Zählung ist ungültig.";
  return `${what} ${state} Einstieg in drei Teilen ${fmt(z.zoneTop)} – ${fmt(z.zoneBottom)}. Ungültig unter ${fmt(z.invalidation)}. Ziel ${fmt(z.targets[0])}, danach ${fmt(z.targets[1])}.`;
}

// ---------------------------------------------------------------------------------------------
// Begleitung einer offenen Langfrist-Position: Meldungen NUR bei geänderter Zählung.

export interface LongTermPosition {
  direction: "long";
  /** Durchschnittlicher Einstieg (gefüllte Teile) */
  entry: number;
  invalidation: number;
  stop?: number;
  /** Noch gehaltener Anteil (1 = alles) */
  remaining: number;
  lastActionKey?: string;
}

export type LongTermAction =
  | { kind: "ausstieg"; key: string; reason: string }
  | { kind: "teilausstieg"; key: string; fraction: number; stop: number; reason: string }
  | { kind: "stop"; key: string; stop: number; reason: string };

/**
 * Bewertet eine offene Langfrist-Position mit den aktuellen Kerzen und der aktuellen Wellenzählung.
 * - Schlusskurs unter der Invalidierung → komplett aussteigen.
 * - Welle 5 fertig (Impuls aufwärts abgeschlossen, Momentum schwächer) → Hälfte verkaufen, Stop unter Welle 4.
 * - Alternativszenario (abwärts) wird wahrscheinlicher → im Gewinn: Hälfte verkaufen, Stop auf Einstieg;
 *   im Verlust: Stop unter das letzte Tief setzen.
 * Jede Meldung kommt nur einmal (Kennung).
 */
export function assessLongTerm(pos: LongTermPosition, candles: Candle[], elliott: ElliottResult): LongTermAction | null {
  if (!candles.length || pos.remaining <= 0) return null;
  const last = candles[candles.length - 1];
  const price = last.close;
  const once = (a: LongTermAction) => (a.key === pos.lastActionKey ? null : a);
  if (price < pos.invalidation) return once({ kind: "ausstieg", key: `inv:${pos.invalidation}`, reason: `Zählung ungültig: Schlusskurs unter dem Wellenstart – komplett aussteigen.` });

  const best = elliott.best;
  if (!best) return null;
  const pivTime = best.pivots[best.pivots.length - 1]?.time ?? 0;
  // Welle 5 abgeschlossen (aufwärts) + nachlassendes Momentum
  const w5 = best.direction === 1 && best.complete && (best.pattern === "impulse" || best.pattern === "ending-diagonal");
  if (w5) {
    const r = rsi(candles.map((c) => c.close));
    const tired = exhaustionAt(candles, r, candles.length - 1, 1, 60) || best.bias === -1;
    if (tired) {
      const w4 = best.pivots[4]?.price ?? pos.entry;
      const stop = Math.max(w4, pos.stop ?? 0);
      if (stop < price) return once({ kind: "teilausstieg", key: `w5:${pivTime}`, fraction: 0.5, stop, reason: "Welle 5 scheint abgeschlossen – Hälfte der Gewinne mitnehmen, Stop für den Rest unter das Tief von Welle 4." });
    }
  }
  // Alternativszenario wird wahrscheinlicher: Hauptzählung erwartet jetzt fallende Kurse
  const bullishAlt = elliott.counts.find((c) => c !== best && c.bias === 1);
  const altMoreLikely = best.bias === -1 && !elliott.contested && best.probability >= 0.5 && (!bullishAlt || bullishAlt.probability < best.probability);
  if (altMoreLikely) {
    if (price > pos.entry) {
      const stop = Math.max(pos.entry, pos.stop ?? 0);
      return once({ kind: "teilausstieg", key: `alt:${best.id}:${pivTime}`, fraction: 0.5, stop, reason: `Die Zählung hat sich geändert (${best.patternLabel}) – fallende Kurse sind jetzt wahrscheinlicher. Hälfte der Gewinne mitnehmen, Stop für den Rest auf den Einstieg.` });
    }
    const lows = recentLow(candles, 20);
    const stop = Math.max(lows, pos.invalidation, pos.stop ?? 0);
    if (stop < price) return once({ kind: "stop", key: `alt:${best.id}:${pivTime}`, stop, reason: `Die Zählung hat sich geändert (${best.patternLabel}) – das Alternativszenario ist wahrscheinlicher. Stop unter das letzte Tief setzen.` });
  }
  return null;
}

const recentLow = (c: Candle[], n: number) => Math.min(...c.slice(-n).map((x) => x.low));

/** Rendite einer Position mit Teilausstiegen (in %, bezogen auf den eingesetzten Betrag). */
export function blendedReturn(entry: number, partials: { fraction: number; price: number }[], exitPrice: number): number {
  let used = 0;
  let r = 0;
  for (const p of partials) {
    r += p.fraction * ((p.price - entry) / entry);
    used += p.fraction;
  }
  r += Math.max(0, 1 - used) * ((exitPrice - entry) / entry);
  return r * 100;
}

// ---------------------------------------------------------------------------------------------
// Messung über die Vergangenheit (EchoChart): Wie oft wurde ein Bereich erfolgreich, wie oft ungültig?

export interface LongTermEcho {
  zones: number;
  erfolgreich: number;
  invalidiert: number;
  offen: number;
  /** erreicht, aber nicht eingestiegen (Kurs lief vorher davon) */
  verpasst: number;
  /** erfolgreich / (erfolgreich + invalidiert) */
  quote: number;
  trades: { entry: number; exit: number; returnPct: number; entryTime: number; exitTime: number; result: "erfolgreich" | "invalidiert" | "offen"; invalidation?: number; target?: number; zoneTop?: number; zoneBottom?: number; key?: string }[];
}

/**
 * Spielt die Vergangenheit durch, nur mit Kerzen bis zum jeweiligen Zeitpunkt (kein Blick in die Zukunft):
 * jeder neue Bereich wird ab seiner Entstehung verfolgt. Einstieg in drei Teilen; erfolgreich = Ziel 1 (altes Hoch)
 * erreicht, invalidiert = Schlusskurs unter dem Wellenstart (Ausstieg zum Schlusskurs).
 */
export function runLongTermEcho(candles: Candle[], o: LongTermOptions = DEFAULT_LONGTERM, step = 1, window = 600): LongTermEcho {
  const seen = new Set<string>();
  const out: LongTermEcho = { zones: 0, erfolgreich: 0, invalidiert: 0, offen: 0, verpasst: 0, quote: 0, trades: [] };
  for (let i = 150; i < candles.length; i += step) {
    const z = findLongTermZone(candles.slice(Math.max(0, i + 1 - window), i + 1), o);
    if (!z || z.status !== "zulaufend" || seen.has(z.key)) continue;
    seen.add(z.key);
    out.zones++;
    // Verfolgen ab Kerze i+1
    const fills: number[] = [];
    let result: "erfolgreich" | "invalidiert" | "offen" | "verpasst" = "offen";
    let exit = candles[candles.length - 1].close;
    let exitTime = candles[candles.length - 1].time;
    let firstTime = 0;
    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      for (const t of z.tranches) if (fills.length < 3 && c.low <= t && !fills.includes(t)) (fills.push(t), (firstTime ||= c.time));
      if (c.close < z.invalidation) {
        result = fills.length ? "invalidiert" : "verpasst";
        exit = c.close;
        exitTime = c.time;
        break;
      }
      if (c.high >= z.targets[0]) {
        result = fills.length ? "erfolgreich" : "verpasst";
        exit = z.targets[0];
        exitTime = c.time;
        break;
      }
    }
    if (result === "verpasst") {
      out.verpasst++;
      out.zones--;
      continue;
    }
    if (!fills.length) {
      out.offen++;
      continue;
    }
    out[result]++;
    const entry = fills.reduce((s, x) => s + x, 0) / fills.length;
    out.trades.push({ entry, exit, returnPct: ((exit - entry) / entry) * 100, entryTime: firstTime, exitTime, result, invalidation: z.invalidation, target: z.targets[0], zoneTop: z.zoneTop, zoneBottom: z.zoneBottom, key: z.key });
  }
  const done = out.erfolgreich + out.invalidiert;
  out.quote = done ? out.erfolgreich / done : 0;
  return out;
}

/** Zum Einzeichnen: Start (0) und Hoch (1) als kleine Wellenzählung, nächste erwartete Welle = 2 in den Bereich. */
export function longTermWave(z: LongTermZone): Pick<WaveCount, "pivots" | "labels" | "direction" | "bias" | "complete" | "pattern"> {
  return {
    pivots: [
      { index: 0, time: z.start.time, price: z.start.price, type: "L", confirmed: true },
      { index: 0, time: z.high.time, price: z.high.price, type: "H", confirmed: true },
    ],
    labels: ["1"],
    direction: 1,
    bias: -1,
    complete: false,
    pattern: "impulse",
  };
}
