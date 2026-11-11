// Blacktrader schaut auf dein Buy & Hold: großer Trend aus dem Wochenchart (Elliott). Kippt er nach unten, gibt es
// einmal eine Nachricht – verkauft wird nichts, du entscheidest selbst.
import { bigTrend } from "../analysis/promotion";
import { actions, getData } from "../store/store";
import { notify } from "./alerts";
import { summarizeHolding } from "./holdings";
import type { ScanEntry } from "./scanner";

export type HoldTrend = 1 | -1 | 0;

/** Großer Trend eines Werts: Wochenchart, sonst Tageschart */
export const holdTrend = (e: ScanEntry | undefined): HoldTrend => (e ? bigTrend(e.horizons.long?.res ?? e.horizons.medium?.res) : 0);

export function checkHoldings(entries: ScanEntry[]) {
  const d = getData();
  for (const h of d.holdings) {
    if (summarizeHolding(h).qty <= 0) continue;
    const e = entries.find((x) => x.asset.kind === h.kind && x.asset.symbol === h.symbol);
    if (!e) continue;
    const trend = holdTrend(e);
    if (h.trend === trend) continue;
    actions.setHoldingTrend(h.id, trend);
    if (trend === -1)
      notify(`Buy & Hold: ${h.name}`, "Der große Trend (Wochenchart) zeigt jetzt nach unten. Blacktrader verkauft nichts – prüfe selbst, ob du absichern oder verkaufen willst.", { sound: d.settings.sound, notifications: d.settings.notifications, kind: "sell" });
    else if (trend === 1 && h.trend === -1)
      notify(`Buy & Hold: ${h.name}`, "Der große Trend (Wochenchart) zeigt wieder nach oben.", { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
  }
}
