// Stop berührt, während die App geschlossen war? (Nutzer 13.11.2026) – Kerzen seit dem letzten Besuch gegen den Euro-Stop
// prüfen, mit dem Wechselkurs der jeweiligen Zeit. Es wird nichts gebucht, die App meldet nur „bei flatex prüfen“.
import type { Candle } from "../types";

export interface StopTouch {
  /** Stop berührt (Tief in Euro ≤ Stop) */
  touched: boolean;
  /** knapp darüber (innerhalb von nearPct) – nur wenn nicht berührt */
  near: boolean;
  /** Zeit der ersten berührenden Kerze (Unix-Sekunden) */
  at?: number;
  /** tiefster Wert in Euro im Zeitraum (bei Short: höchster) */
  extremeEur: number;
}

export const NEAR_PCT = 0.003;

/** Wechselkurs-Suche: Kerzen eines Paars wie EURUSD (Dollar je Euro) → Euro je Dollar zu einer Zeit */
export function fxLookup(fxCandles: Candle[], eurPerUnitFromClose: (close: number) => number): (timeSec: number) => number | null {
  const c = [...fxCandles].filter((x) => Number.isFinite(x.close) && x.close > 0).sort((a, b) => a.time - b.time);
  if (!c.length) return () => null;
  return (t) => {
    let lo = 0;
    let hi = c.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (c[m].time <= t) {
        ans = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return eurPerUnitFromClose(c[ans].close);
  };
}

/**
 * Prüft die Kerzen ab `sinceSec`. `stopEur` = Stop in Euro, `eurPer(t)` = Euro je Einheit der Kerzenwährung zur Zeit t
 * (bei Euro-Werten immer 1). `dir` 1 = Kauf (Tief zählt), −1 = Short (Hoch zählt).
 */
export function stopTouched(candles: Candle[], stopEur: number, eurPer: (timeSec: number) => number | null, sinceSec: number, intervalSec: number, dir: 1 | -1 = 1, nearPct = NEAR_PCT): StopTouch | null {
  if (!(stopEur > 0)) return null;
  let extreme = dir === 1 ? Infinity : -Infinity;
  let at: number | undefined;
  let any = false;
  for (const k of candles) {
    if (k.time + intervalSec < sinceSec) continue; // Kerze endete vor dem letzten Besuch
    const fx = eurPer(k.time);
    if (fx == null || !(fx > 0)) continue;
    const v = (dir === 1 ? k.low : k.high) * fx;
    if (!Number.isFinite(v)) continue;
    any = true;
    if (dir === 1 ? v < extreme : v > extreme) extreme = v;
    if (at == null && (dir === 1 ? v <= stopEur : v >= stopEur)) at = k.time;
  }
  if (!any) return null;
  const touched = at != null;
  const near = !touched && (dir === 1 ? extreme <= stopEur * (1 + nearPct) : extreme >= stopEur * (1 - nearPct));
  return { touched, near, at, extremeEur: extreme };
}

/** Kerzengröße nach Dauer der Abwesenheit (so weit reichen die Quellen: Yahoo 15 Min ~1 Monat, 1 Std ~1 Jahr; Binance 15 Min ~10 Tage, 1 Std ~41 Tage) */
export function intervalForGap(gapMs: number, crypto: boolean): "15m" | "1h" | "1d" {
  const d = gapMs / 86400e3;
  if (d <= (crypto ? 9 : 28)) return "15m";
  if (d <= (crypto ? 38 : 330)) return "1h";
  return "1d";
}
export const INTERVAL_SEC = { "15m": 900, "1h": 3600, "1d": 86400 } as const;
