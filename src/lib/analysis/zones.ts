// Zielzonen-Analyse (angelehnt an das Vorgehen professioneller Elliott-Dienste):
// Statt zum aktuellen Kurs einzusteigen, wird im Trend die letzte Impulswelle (A → B) gesucht und eine
// Kaufzone (bzw. Verkaufszone) im Fibonacci-Korrekturbereich berechnet. Eingestiegen wird nur, wenn der
// Kurs die Zone erreicht (Limit-Order). Stop = Invalidierung (Start der Welle), Ziel 1 = letztes Extrem B.
import type { Candle } from "../types";
import { atr, ema } from "./indicators";
import { LOCKED } from "./locked-config";
import { zigzag, type Pivot } from "./zigzag";

export interface ZoneOptions {
  /** Swing-Grad (ATR-Vielfaches für ZigZag) */
  atrMult: number;
  /** Einstieg bei diesem Korrektur-Anteil der Welle A→B */
  entryRetrace: number;
  /** Untere Zonengrenze (tiefste sinnvolle Korrektur) – nur ohne `bottomAboveStop` */
  zoneDeep: number;
  /**
   * Untere Zonengrenze knapp über dem Stop (Anteil, 0,01 = 1 %): Die grüne Box reicht von 61,8 % bis 1 % über den Stop
   * (Stop am Wellenstart). Getestet 1963–2026, 191 Werte: +7,9 % statt +7,8 % pro Jahr, schlechtester 5-Jahres-Zeitraum
   * −6,8 % statt −8,1 % (vorher Unterkante bei 78,6 %).
   */
  bottomAboveStop?: number;
  /** Stop-Puffer jenseits von A in ATR */
  stopBufferAtr: number;
  /** Mindestgröße der Welle A→B in ATR */
  minWaveAtr: number;
  /** Nur mit dem übergeordneten Trend */
  trendFilter: boolean;
  /** Ziel 1 = B + Anteil × Wellenlänge (0 = genau das letzte Extrem) */
  target1Ext: number;
}

/** Gewählt auf Entwicklungsdaten, bestätigt auf Prüfdaten (Gewinnfaktor 1,18) – siehe scripts/evaluate.ts. */
export const DEFAULT_ZONE_OPTIONS: ZoneOptions = {
  // Pivot-Empfindlichkeit (lernbar, Standard 4) …
  atrMult: 4,
  // … alles andere ist Methode/Risiko und fest (locked-config.ts)
  entryRetrace: LOCKED.zone.entryRetrace,
  zoneDeep: LOCKED.zone.zoneDeep,
  bottomAboveStop: LOCKED.zone.bottomAboveStop,
  stopBufferAtr: LOCKED.zone.stopBufferAtr,
  minWaveAtr: LOCKED.zone.minWaveAtr,
  trendFilter: LOCKED.zone.trendFilter,
  target1Ext: LOCKED.zone.target1Ext,
};

export interface ZoneSetup {
  direction: "long" | "short";
  /** Welle A → B (Start und Ende des Impulses) */
  a: Pivot;
  b: Pivot;
  /** Einstiegszone (zoneStart = erster Einstiegskurs, zoneEnd = tiefste Korrektur) */
  zoneStart: number;
  zoneEnd: number;
  entry: number;
  stop: number;
  targets: number[];
  riskReward: number;
  /** Setup verfällt, wenn der Kurs vor dem Einstieg über B (Long) hinausläuft */
  cancelAbove: number;
  /** Kurs ist bereits in der Zone */
  inZone: boolean;
  /** ATR zum Zeitpunkt des Setups (für das Nachziehen des Stops) */
  atr: number;
  /** Nach Ziel 1 bei Wellen-5-Ende aussteigen (gelernt) */
  wave5Exit?: boolean;
}

/**
 * Sucht ein Zielzonen-Setup auf den letzten Kerzen. Gibt null zurück, wenn kein sauberes Setup existiert.
 */
export function findZoneSetup(candles: Candle[], o: ZoneOptions = DEFAULT_ZONE_OPTIONS): ZoneSetup | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const a_ = atr(candles)[candles.length - 1];
  if (!a_) return null;
  let trend: 1 | -1 | 0 = 0;
  if (o.trendFilter) {
    const e200 = ema(closes, Math.min(200, Math.floor(closes.length * 0.6)))[closes.length - 1];
    const e50 = ema(closes, 50)[closes.length - 1];
    if (e200 == null || e50 == null) return null;
    trend = price > e200 && e50 > e200 ? 1 : price < e200 && e50 < e200 ? -1 : 0;
    if (trend === 0) return null;
  }
  const pv = zigzag(candles, o.atrMult);
  if (pv.length < 3) return null;
  // Letzter bestätigter Impuls A→B in Trendrichtung; danach läuft die Korrektur (letzter Pivot = laufendes Extrem)
  // Fall 1: letzter Pivot ist B (Impuls läuft noch / Korrektur beginnt gerade)
  // Fall 2: letzter Pivot ist das laufende Korrekturextrem C, B ist der vorletzte
  for (const offset of [1, 2]) {
    const bIdx = pv.length - offset;
    const aIdx = bIdx - 1;
    if (aIdx < 0) continue;
    const a = pv[aIdx];
    const b = pv[bIdx];
    const dir: 1 | -1 = b.price > a.price ? 1 : -1;
    if (o.trendFilter && dir !== trend) continue;
    const L = Math.abs(b.price - a.price);
    if (L < o.minWaveAtr * a_) continue;
    // B muss das Extrem seit A sein und danach nicht überschritten worden sein
    const after = candles.slice(b.index + 1);
    if (after.some((c) => (dir === 1 ? c.high > b.price : c.low < b.price))) continue;
    // Korrektur darf A nicht verletzt haben
    if (after.some((c) => (dir === 1 ? c.low <= a.price : c.high >= a.price))) continue;
    const zoneStart = b.price - dir * L * o.entryRetrace;
    const stop = a.price - dir * o.stopBufferAtr * a_;
    const zoneEnd = o.bottomAboveStop != null ? stop * (1 + dir * o.bottomAboveStop) : b.price - dir * L * o.zoneDeep;
    if ((zoneStart - zoneEnd) * dir <= 0) continue; // Box hätte keine Höhe
    // Bereits tiefer als die Zone gelaufen? Dann Einstieg zum aktuellen Kurs nur, wenn er noch in der Zone ist
    const deepest = after.length ? (dir === 1 ? Math.min(...after.map((c) => c.low)) : Math.max(...after.map((c) => c.high))) : b.price;
    const inZone = (price - zoneStart) * dir <= 0 && (price - zoneEnd) * dir >= 0;
    if ((deepest - zoneEnd) * dir < 0 && !inZone) continue; // Zone bereits durchlaufen
    const entry = inZone ? price : zoneStart;
    // Ziele unter 0 sind unmöglich (große Abwärtswellen im Monatschart): solche Shorts sind kein sinnvoller Einstieg
    const targets = [b.price + dir * L * o.target1Ext, entry + dir * L * 1.618].filter((t) => t > 0);
    if (targets.length === 0 || (dir === -1 && targets[0] >= entry)) continue;
    const risk = (entry - stop) * dir;
    if (!(risk > 0)) continue;
    const riskReward = ((targets[0] - entry) * dir) / risk;
    return { direction: dir === 1 ? "long" : "short", a, b, zoneStart, zoneEnd, entry, stop, targets, riskReward, cancelAbove: b.price, inZone, atr: a_ };
  }
  return null;
}
