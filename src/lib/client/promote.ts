"use client";
// Hochstufung GRÜN → BLAU für offene grüne Long-Trades (nach jeder Blacktrader-Suche).
// Bestätigt der Wochenchart (langfristiger Zeitraum) den Aufwärtstrend, wird der Trade blau; Stop und Ziel werden nach der
// Wellenstruktur nachgezogen. Der Stop wird NUR angehoben, nie zurückgesetzt.
import { checkPromotion } from "../analysis/promotion";
import { tradeCurrency } from "./eur";
import { money } from "../analysis/persona";
import { actions, getData } from "../store/store";
import { notify } from "./alerts";
import type { ScanEntry } from "./scanner";

export function applyPromotions(entries: ScanEntry[]) {
  const d = getData();
  for (const t of d.trades) {
    if (t.status !== "open" || t.direction !== "long" || t.strategy === "core" || t.strategy === "longterm") continue;
    const e = entries.find((x) => x.asset.kind === t.kind && x.asset.symbol === t.symbol);
    if (!e) continue;
    const price = t.lastPrice ?? e.horizons[t.horizon]?.res.price;
    if (price == null) continue;
    const weekly = e.horizons.long?.res;
    const daily = e.horizons[t.horizon]?.res ?? e.horizons.medium?.res;
    const p = checkPromotion(t, weekly, daily, price);
    if (!p) continue;
    if (!t.promotedAt) {
      actions.updateTrade(t.id, { promotedAt: Date.now(), promoteReason: p.reason, stop: p.stop, targets: p.targets, initialStop: t.initialStop ?? t.stop });
      notify(`Hochgestuft zu Blau: ${t.symbol}`, `${p.reason} Stop jetzt ${money(p.stop, tradeCurrency(t))}.`, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
    } else if (p.stop > t.stop) {
      actions.updateTrade(t.id, { stop: p.stop });
      notify(`Stop nachgezogen: ${t.symbol}`, `Neues Korrekturtief bestätigt – Stop auf ${money(p.stop, tradeCurrency(t))} angehoben.`, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
    }
  }
}
