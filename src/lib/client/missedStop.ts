"use client";
// Beim Öffnen der App: Kerzen seit dem letzten Besuch gegen den Euro-Stop prüfen (Nutzer 13.11.2026).
// Nur Hinweis „Stop wurde berührt – bei flatex prüfen“, gebucht wird nichts automatisch (nur flatex kennt den echten Verkaufskurs).
import { brokerStop } from "./brokerStop";
import { notify } from "./alerts";
import { api } from "./api";
import { tradeCurrency } from "./eur";
import { fxLookup, intervalForGap, INTERVAL_SEC, stopTouched } from "../analysis/missedStop";
import { actions, getData, type Trade } from "../store/store";
import type { Candle } from "../types";

const KEY = "bt-last-seen";
const MIN_GAP_MS = 10 * 60e3;

const read = (): number | null => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};
const mark = () => {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ohne Speicher */
  }
};

/** Währungspaar bei Yahoo (Dollar je Euro usw.) und Umrechnung Schlusskurs → Euro je Einheit */
function fxPair(cur: string): { sym: string; toEur: (close: number) => number } | null {
  if (cur === "EUR") return null;
  const c = ["USD", "USDT", "USDC"].includes(cur) ? "USD" : cur === "GBp" || cur === "GBX" ? "GBP" : cur;
  const pence = cur === "GBp" || cur === "GBX";
  return { sym: `EUR${c}=X`, toEur: (close) => (pence ? 1 / close / 100 : 1 / close) };
}

async function checkTrade(t: Trade, sinceMs: number, now: number): Promise<void> {
  const hint = brokerStop(t);
  if (!hint) return;
  const crypto = t.kind === "crypto";
  const iv = intervalForGap(now - sinceMs, crypto);
  const cur = tradeCurrency(t);
  const pair = fxPair(cur);
  let candles: Candle[];
  let eurPer: (t: number) => number | null = () => 1;
  try {
    candles = (await api.candles(t, iv, 60e3)).candles;
    if (pair) {
      const fx = (await api.candles({ kind: "stock", symbol: pair.sym, name: pair.sym, yahooSymbol: pair.sym }, iv, 60e3)).candles;
      eurPer = fxLookup(fx, pair.toEur);
    }
  } catch {
    return; // keine Daten – beim nächsten Öffnen erneut
  }
  const r = stopTouched(candles, hint.setEur, eurPer, sinceMs / 1000, INTERVAL_SEC[iv], t.direction === "short" ? -1 : 1);
  if (!r || (!r.touched && !r.near)) return;
  const at = r.at ? r.at * 1000 : now;
  if (t.missedStop && t.missedStop.at === at && t.missedStop.near === !r.touched) return; // schon gemeldet
  actions.updateTrade(t.id, { missedStop: { at, near: !r.touched, stopEur: hint.setEur, lowEur: r.extremeEur } });
  const s = getData().settings;
  const when = new Date(at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  const eur = (x: number) => `${x.toFixed(2).replace(".", ",")} €`;
  void notify(
    `${r.touched ? "Stop berührt" : "Stop knapp berührt"}: ${t.name}`,
    `Während die App zu war, ${r.touched ? "fiel" : "kam"} der Kurs ${r.touched ? "auf" : "nahe an"} deinen Stop ${eur(hint.setEur)} (tiefster Stand ${eur(r.extremeEur)}, ${when}). Bitte bei flatex prüfen und im Depot eintragen.`,
    { sound: s.sound, notifications: s.notifications, kind: "sell" },
  );
}

async function checkAll(sinceMs: number): Promise<void> {
  const now = Date.now();
  for (const t of getData().trades) {
    if (t.status !== "open" || t.strategy === "core") continue;
    await checkTrade(t, Math.max(sinceMs, t.openedAt ?? 0), now);
  }
}

/** Startet die Prüfung (beim Start und wenn die App nach langer Pause wieder sichtbar wird) und merkt sich den letzten Besuch */
export function startMissedStopCheck(): () => void {
  if (typeof window === "undefined") return () => {};
  const last = read();
  mark();
  // Erst nach kurzer Zeit, damit Wechselkurse und Trades geladen sind
  const first = last && Date.now() - last > MIN_GAP_MS ? setTimeout(() => void checkAll(last), 6000) : null;
  const beat = setInterval(() => {
    if (document.visibilityState === "visible") mark();
  }, 60e3);
  const onVis = () => {
    if (document.visibilityState === "hidden") return mark();
    const l = read();
    if (l && Date.now() - l > MIN_GAP_MS) {
      void checkAll(l);
    }
    mark();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", mark);
  return () => {
    if (first) clearTimeout(first);
    clearInterval(beat);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", mark);
  };
}

/** „Erledigt“: Hinweis entfernen */
export const clearMissedStop = (id: string) => actions.updateTrade(id, { missedStop: undefined });
