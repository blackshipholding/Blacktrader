"use client";
// Beim Öffnen der App: Kerzen seit dem letzten Besuch gegen Stop, Kauf-Limits und Ziele prüfen (Nutzer 13.11.2026) – in Euro mit dem
// Wechselkurs der jeweiligen Kerze. Nur Hinweise „bei flatex prüfen“, gebucht wird nichts (nur flatex kennt die echte Ausführung).
// Dazu Watchlist: war ein Wert in der Abwesenheit im Einstiegsbereich?
import { brokerStop } from "./brokerStop";
import { notify } from "./alerts";
import { api } from "./api";
import { tradeCurrency } from "./eur";
import { assetKey } from "./entries";
import { getScan } from "./scanner";
import { eurPerUnit } from "../fx";
import { fxLookup, intervalForGap, INTERVAL_SEC, levelTouched } from "../analysis/missedStop";
import { actions, getData, type Trade } from "../store/store";
import type { Candle } from "../types";

const KEY = "bt-last-seen";
const ZONES_KEY = "bt-zone-alerts-v1";
const MIN_GAP_MS = 10 * 60e3;

type Hit = NonNullable<Trade["missed"]>[number];

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

const eur = (x: number) => `${x.toFixed(2).replace(".", ",")} €`;
const same = (a: Hit, b: Hit) => a.kind === b.kind && a.part === b.part && a.at === b.at && a.near === b.near;

async function checkTrade(t: Trade, sinceMs: number, now: number): Promise<void> {
  const iv = intervalForGap(now - sinceMs, t.kind === "crypto");
  const cur = tradeCurrency(t);
  const pair = fxPair(cur);
  const fxNow = eurPerUnit(cur) ?? 1;
  const fxBuy = t.fxEntry ?? fxNow;
  const since = sinceMs / 1000;
  const sec = INTERVAL_SEC[iv];

  // Marken in Euro: (Art, Teil, Euro-Wert, Seite)
  const checks: { kind: Hit["kind"]; part?: number; level: number; side: "below" | "above" }[] = [];
  const hint = brokerStop(t);
  if (hint) {
    checks.push({ kind: "stop", level: hint.setEur, side: t.direction === "short" ? "above" : "below" });
    const tg = [...t.targets].sort((a, b) => (t.direction === "short" ? b - a : a - b))[0];
    if (tg != null && tg > 0 && t.strategy !== "longterm") checks.push({ kind: "target", level: tg * fxNow, side: t.direction === "short" ? "below" : "above" });
    if (t.strategy === "longterm" && t.lt?.targets?.[0] != null) checks.push({ kind: "target", level: t.lt.targets[0] * fxNow, side: "above" });
  }
  if (t.strategy === "longterm") {
    (t.tranches ?? []).forEach((x, i) => {
      if (!x.filledAt) checks.push({ kind: "entry", part: i + 1, level: x.price * fxBuy, side: "below" });
    });
  } else if (t.status === "pending") {
    checks.push({ kind: "entry", level: t.entry * fxBuy, side: t.direction === "short" ? "above" : "below" });
  }
  if (!checks.length) return;

  let candles: Candle[];
  let eurPer: (t: number) => number | null = () => 1;
  try {
    candles = (await api.candles(t, iv, 60e3)).candles;
    if (pair) eurPer = fxLookup((await api.candles({ kind: "stock", symbol: pair.sym, name: pair.sym, yahooSymbol: pair.sym }, iv, 60e3)).candles, pair.toEur);
  } catch {
    return; // keine Daten – beim nächsten Öffnen erneut
  }

  const found: Hit[] = [];
  for (const c of checks) {
    const r = levelTouched(candles, c.level, eurPer, since, sec, c.side);
    if (r && (r.touched || r.near)) found.push({ kind: c.kind, part: c.part, at: r.at ? r.at * 1000 : now, near: !r.touched, levelEur: c.level, extremeEur: r.extremeEur });
  }
  const fresh = found.filter((h) => !(t.missed ?? []).some((o) => same(o, h)));
  if (!fresh.length) return;
  actions.updateTrade(t.id, { missed: [...(t.missed ?? []).filter((o) => !found.some((h) => h.kind === o.kind && h.part === o.part)), ...found] });
  const s = getData().settings;
  for (const h of fresh) {
    const when = new Date(h.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    const what = h.kind === "stop" ? "Stop" : h.kind === "target" ? "Ziel" : `Kauf-Limit${h.part ? ` Teil ${h.part}` : ""}`;
    void notify(
      `${what} ${h.near ? "knapp berührt" : "berührt"}: ${t.name}`,
      `Während die App zu war, ${h.near ? "kam" : h.kind === "stop" ? "fiel" : "lief"} der Kurs ${h.near ? "nahe an" : h.kind === "stop" ? "auf" : "an"} ${what} ${eur(h.levelEur)} (${h.kind === "target" || h.kind === "entry" && t.direction === "short" ? "höchster" : "tiefster"} Stand ${eur(h.extremeEur)}, ${when}). Bitte bei flatex prüfen und im Depot eintragen.`,
      { sound: s.sound, notifications: s.notifications, kind: h.kind === "stop" ? "sell" : "info" },
    );
  }
}

/** Watchlist: war ein Wert in der Abwesenheit im Einstiegsbereich? (nur Hinweis, einmal je Zone wie der Zonen-Alarm) */
async function checkWatch(sinceMs: number, now: number): Promise<void> {
  const entries = getScan().entries;
  const d = getData();
  let done: string[] = [];
  try {
    done = JSON.parse(localStorage.getItem(ZONES_KEY) ?? "[]") ?? [];
  } catch {
    return;
  }
  const iv = intervalForGap(now - sinceMs, false);
  const names: string[] = [];
  for (const w of d.watchlist) {
    const e = entries.find((x) => x.asset.kind === w.kind && x.asset.symbol === w.symbol);
    const b = e?.best;
    if (!e || !b || b.color === "gelb" || b.zoneTop == null || b.zoneBottom == null || e.financeWeak) continue;
    if (d.trades.some((t) => t.status !== "closed" && t.kind === w.kind && t.symbol === w.symbol)) continue;
    const id = `${assetKey(w)}|${b.key}`;
    if (done.includes(id)) continue;
    const short = b.color === "rot";
    try {
      const candles = (await api.candles(w, iv, 60e3)).candles;
      const r = levelTouched(candles, short ? b.zoneBottom : b.zoneTop, () => 1, sinceMs / 1000, INTERVAL_SEC[iv], short ? "above" : "below", 0);
      if (r?.touched) {
        done.push(id);
        names.push(w.name);
      }
    } catch {
      /* nächstes Mal */
    }
  }
  if (!names.length) return;
  try {
    localStorage.setItem(ZONES_KEY, JSON.stringify(done.slice(-200)));
  } catch {
    /* ohne Speicher */
  }
  void notify(`Watchlist: ${names.length === 1 ? names[0] : `${names.length} Werte`} im Einstiegsbereich`, `Während die App zu war, lief der Kurs in den Einstiegsbereich: ${names.join(", ")}. Prüfe die Chance in der Watchlist.`, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
}

async function checkAll(sinceMs: number): Promise<void> {
  const now = Date.now();
  for (const t of getData().trades) {
    if ((t.status !== "open" && t.status !== "pending") || t.strategy === "core") continue;
    await checkTrade(t, Math.max(sinceMs, t.openedAt ?? 0), now);
  }
  await checkWatch(sinceMs, now);
}

/** Startet die Prüfung (beim Start und wenn die App nach langer Pause wieder sichtbar wird) und merkt sich den letzten Besuch */
export function startMissedStopCheck(): () => void {
  if (typeof window === "undefined") return () => {};
  const last = read();
  mark();
  // Erst nach kurzer Zeit, damit Wechselkurse, Trades und Suche geladen sind
  const first = last && Date.now() - last > MIN_GAP_MS ? setTimeout(() => void checkAll(last), 8000) : null;
  const beat = setInterval(() => {
    if (document.visibilityState === "visible") mark();
  }, 60e3);
  const onVis = () => {
    if (document.visibilityState === "hidden") return mark();
    const l = read();
    if (l && Date.now() - l > MIN_GAP_MS) void checkAll(l);
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

/** „Erledigt“: Hinweis entfernen (ein Eintrag oder alle eines Trades) */
export const clearMissed = (id: string, index?: number) => {
  const t = getData().trades.find((x) => x.id === id);
  if (!t) return;
  const rest = index == null ? [] : (t.missed ?? []).filter((_, i) => i !== index);
  actions.updateTrade(id, { missed: rest.length ? rest : undefined });
};
