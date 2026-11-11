"use client";
// Zonen-Alarm NUR für die Watchlist: Läuft der Kurs eines Watchlist-Werts in seinen Einstiegsbereich (blau/grün/rot),
// kommt einmal eine Nachricht. Chancen bekommen keinen Alarm (sie ändern sich täglich – zu viele Meldungen).
import { money } from "../analysis/persona";
import type { WatchItem } from "../store/store";
import { getData } from "../store/store";
import { notify } from "./alerts";
import { assetKey } from "./entries";
import { displayCurrency } from "./eur";
import type { LiveState } from "./market";
import { getScan } from "./scanner";

const KEY = "bt-zone-alerts-v1";
const load = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") ?? [];
  } catch {
    return [];
  }
};

const save = (ids: string[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    /* ohne Speicher */
  }
};

export function checkWatchZones(watchlist: WatchItem[], live: Record<string, LiveState>, keyOf: (a: WatchItem) => string) {
  const entries = getScan().entries;
  if (!entries.length) return;
  let done: string[] | null = null;
  // Allererster Lauf: Werte, die schon in der Zone sind, still merken (kein Schwall an Meldungen beim Einschalten)
  let first = false;
  try {
    first = localStorage.getItem(KEY) == null;
  } catch {
    return;
  }
  if (first) save([]);
  for (const w of watchlist) {
    const e = entries.find((x) => x.asset.kind === w.kind && x.asset.symbol === w.symbol);
    const b = e?.best;
    if (!e || !b || b.color === "gelb" || b.zoneTop == null || b.zoneBottom == null || e.financeWeak) continue;
    const lv = live[keyOf(w)];
    if (!lv?.price || lv.status === "offline") continue;
    const short = b.color === "rot";
    const inZone = short ? lv.price >= b.zoneBottom : lv.price <= b.zoneTop;
    if (!inZone) continue;
    const id = `${assetKey(w)}|${b.key}`;
    done ??= load();
    if (done.includes(id)) continue;
    done.push(id);
    save(done);
    if (first) continue;
    // Schon im Depot? Dann kein Alarm (der Trade meldet sich selbst)
    if (getData().trades.some((t) => t.status !== "closed" && t.kind === w.kind && t.symbol === w.symbol)) continue;
    const cur = displayCurrency(w, w.currency ?? e.asset.currency);
    const what = b.color === "blau" ? "im langfristigen Einstiegsbereich (Blau)" : short ? "in der Short-Zone (Rot)" : "in der Kaufzone (Grün)";
    const s = getData().settings;
    void notify(`Watchlist: ${w.name}`, `Der Kurs ist jetzt ${what} – Einstieg ${money(short ? b.zoneBottom : b.zoneTop, cur)}. Öffne die App, um den Trade zu übernehmen.`, { sound: s.sound, notifications: s.notifications, kind: short ? "sell" : "buy" });
  }
}
