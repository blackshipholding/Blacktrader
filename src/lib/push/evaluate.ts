// Welche Push-Nachrichten fällig sind – reine Logik (testbar), ohne Netzwerk.
// Langfristig: Teil gekauft, geänderte Zählung (Teilausstieg / Stop / Ausstieg).
// Trades: Einstieg, Stop, Ziel 1. Watchlist: neuer langfristiger Einstiegsbereich bzw. Kurs im Bereich.
import { analyzeElliott } from "../analysis/elliott";
import { assessLongTerm, findLongTermZone } from "../analysis/longterm";
import { fmtPrice } from "../analysis/persona";
import type { Candle, Interval } from "../types";
import type { PushRecord, PushTrade, PushWatch } from "./types";

export interface PushMessage {
  key: string;
  title: string;
  body: string;
  url: string;
}

export type CandleLoader = (a: PushWatch | PushTrade, interval: Interval) => Promise<Candle[]>;

const recent = (c: Candle[], n = 3) => c.slice(-n);

export async function evaluatePush(rec: PushRecord, load: CandleLoader, deadline = Infinity): Promise<{ messages: PushMessage[]; silent: string[] }> {
  const sent = new Set(rec.sent);
  const messages: PushMessage[] = [];
  const silent: string[] = [];
  const add = (m: PushMessage) => {
    if (!sent.has(m.key)) (sent.add(m.key), messages.push(m));
  };

  for (const t of rec.trades) {
    if (Date.now() > deadline) break;
    if (t.status === "closed") continue;
    let c: Candle[];
    try {
      c = await load(t, t.interval);
    } catch {
      continue;
    }
    if (c.length < 5) continue;
    const url = "/depot";
    if (t.strategy === "longterm" && t.lt) {
      const filled = (t.tranches ?? []).filter((x) => x.filledAt);
      const lowNow = Math.min(...recent(c).map((x) => x.low));
      if (!t.lastActionKey)
        for (const [i, x] of (t.tranches ?? []).entries())
          if (!x.filledAt && lowNow <= x.price) add({ key: `fill:${t.id}:${i}`, title: `Langfristig ${t.name}`, body: `Kurs im Einstiegsbereich – Teil ${i + 1} von 3 bei ${fmtPrice(x.price)}.`, url });
      const entry = filled.length ? filled.reduce((s, x) => s + x.price, 0) / filled.length : t.entry;
      const a = assessLongTerm({ direction: "long", entry, invalidation: t.lt.invalidation, stop: t.stop || undefined, remaining: t.remaining ?? 1, lastActionKey: t.lastActionKey }, c, analyzeElliott(c.slice(-600)));
      if (a) {
        const what = a.kind === "ausstieg" ? "Komplett aussteigen" : a.kind === "teilausstieg" ? "Teilausstieg" : "Stop setzen";
        // Nur ein Vorschlag: der Nutzer setzt ihn bei flatex um und bestätigt im Depot
        add({ key: `act:${t.id}:${a.key}`, title: `Vorschlag – ${what}: ${t.name}`, body: `${a.kind === "ausstieg" ? a.reason : `${a.reason} Stop ${fmtPrice(a.stop)}.`} Bei flatex umsetzen und im Depot bestätigen.`, url });
      }
      continue;
    }
    if (t.strategy === "core") continue;
    const last = recent(c);
    const dir = t.direction === "long" ? 1 : -1;
    const hit = (p: number, side: "below" | "above") => last.some((x) => (side === "below" ? x.low <= p : x.high >= p));
    if (t.status === "pending") {
      if (hit(t.entry, dir === 1 ? "below" : "above")) add({ key: `in:${t.id}`, title: `Einstieg erreicht: ${t.name}`, body: `Der Kurs hat die ${dir === 1 ? "Kaufzone" : "Verkaufszone"} bei ${fmtPrice(t.entry)} erreicht.`, url });
      continue;
    }
    if (t.stop && hit(t.stop, dir === 1 ? "below" : "above")) add({ key: `stop:${t.id}:${t.stop}`, title: `Stop erreicht: ${t.name}`, body: `Stop bei ${fmtPrice(t.stop)} wurde erreicht.`, url });
    else if (t.targets[0] != null && hit(t.targets[0], dir === 1 ? "above" : "below")) add({ key: `t1:${t.id}`, title: `Ziel 1 erreicht: ${t.name}`, body: `Ziel ${fmtPrice(t.targets[0])} erreicht – Stop auf Einstieg, der Rest läuft weiter.`, url });
  }

  for (const w of rec.watch) {
    if (Date.now() > deadline) break;
    let c: Candle[];
    try {
      c = await load(w, rec.ltInterval);
    } catch {
      continue;
    }
    if (c.length < 150) continue;
    const z = findLongTermZone(c);
    if (!z || z.status === "invalidiert") continue;
    const m =
      z.status === "in-zone"
        ? { key: `ltin:${w.symbol}:${z.key}`, title: `Im Einstiegsbereich: ${w.name}`, body: `Langfristiger Einstiegsbereich ${fmtPrice(z.zoneTop)} – ${fmtPrice(z.zoneBottom)} erreicht. Ungültig unter ${fmtPrice(z.invalidation)}.`, url: "/watchlist" }
        : { key: `ltnew:${w.symbol}:${z.key}`, title: `Neuer Einstiegsbereich: ${w.name}`, body: `Langfristig ${fmtPrice(z.zoneTop)} – ${fmtPrice(z.zoneBottom)} (noch nicht erreicht).`, url: "/watchlist" };
    if (!rec.sent.includes("primed")) {
      // Erste Prüfung nach dem Einschalten: vorhandene Bereiche nur merken, nicht melden (keine Nachrichtenflut)
      if (!sent.has(m.key)) (sent.add(m.key), silent.push(m.key));
    } else add(m);
  }
  if (!rec.sent.includes("primed")) silent.push("primed");
  return { messages, silent };
}
