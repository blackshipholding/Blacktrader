"use client";
// Wochenbericht auf der Übersicht: einmal pro Woche eine Zusammenfassung seit dem letzten Lesen –
// Konto, Live-Bilanz der Chancen, Stops zum Anpassen, neue Chancen, Buy-&-Hold-Warnungen.
import { useEffect, useMemo } from "react";
import { brokerStop } from "@/lib/client/brokerStop";
import { chanceStats } from "@/lib/client/chanceLog";
import { notify } from "@/lib/client/alerts";
import { summarizeHolding } from "@/lib/client/holdings";
import { actions, getData, useAppData } from "@/lib/store/store";

const WEEK = 7 * 86400e3;
const eur = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function WeeklyReport({ equity, chances }: { equity: number; chances: number }) {
  const weekly = useAppData((d) => d.weekly);
  const trades = useAppData((d) => d.trades);
  const log = useAppData((d) => d.chanceLog);
  const holdings = useAppData((d) => d.holdings);
  const stats = chanceStats(log);
  const due = !!weekly && Date.now() - weekly.at >= WEEK;

  // Erster Start: Vergleichsbasis merken, der erste Bericht kommt nach einer Woche
  useEffect(() => {
    if (!getData().weekly) actions.setWeekly({ at: Date.now(), equity, ziel: stats.ziel, stop: stats.stop });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Einmal melden, wenn der Bericht fällig ist
  useEffect(() => {
    if (!due) return;
    const key = `bt-weekly-notified-${weekly!.at}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return;
    }
    const s = getData().settings;
    void notify("Blacktrader-Wochenbericht", "Deine Woche im Überblick liegt auf der Übersicht bereit.", { sound: s.sound, notifications: s.notifications, kind: "info" });
  }, [due, weekly]);

  const stopsToFix = useMemo(() => trades.filter((t) => brokerStop(t)?.adjust).length, [trades]);
  const bhWarn = useMemo(() => holdings.filter((h) => h.trend === -1 && summarizeHolding(h).qty > 0).map((h) => h.name), [holdings]);
  if (!due || !weekly) return null;
  const change = equity - weekly.equity;
  const newZiel = stats.ziel - weekly.ziel;
  const newStop = stats.stop - weekly.stop;
  return (
    <section className="card edge-core space-y-2 p-4 text-[15px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] text-gold-light">Wochenbericht</h2>
        <span className="text-[13px] text-stone-400">seit {new Date(weekly.at).toLocaleDateString("de-DE")}</span>
      </div>
      <ul className="space-y-1 text-stone-200">
        <li>
          Konto: <span className={`num ${change >= 0 ? "text-up" : "text-down"}`}>{eur(change, true)}</span> · jetzt {eur(equity)}
        </li>
        <li>
          Live-Bilanz: {newZiel} Ziel, {newStop} Stop neu · insgesamt Treffer {stats.hitRate == null ? "–" : `${Math.round(stats.hitRate * 100)} %`}
        </li>
        <li>Chancen gerade: {chances}</li>
        <li className={stopsToFix ? "text-amber-200" : ""}>{stopsToFix ? `${stopsToFix} Stop${stopsToFix > 1 ? "s" : ""} bei flatex anpassen (Depot)` : "Alle Stops bei flatex passen."}</li>
        {bhWarn.length > 0 && <li className="text-red-200">Buy & Hold – großer Trend fallend: {bhWarn.join(", ")}</li>}
      </ul>
      <button className="btn-primary w-full" onClick={() => actions.setWeekly({ at: Date.now(), equity, ziel: stats.ziel, stop: stats.stop })}>
        Gelesen
      </button>
    </section>
  );
}
