"use client";
// Welt-Bilanz (Nutzer 13.11.2026): Chancen in Industrieländern, großen Schwellenländern Asiens, Coins und Rohstoffen – nur gemessen,
// nicht in der Chancen-Liste, nicht im Depot. Keine Knöpfe, keine Länder-Aufteilung (die liest Claude aus der Lerndaten-Datei).
import { useWorldBusy, useWorldLog, worldStats } from "@/lib/client/worldScan";

export function WorldRecord() {
  const log = useWorldLog();
  const busy = useWorldBusy();
  const s = worldStats(log).all;
  if (!s.total && !busy.running) return null;
  const rate = s.hitRate == null ? "–" : `${Math.round(s.hitRate * 100)} %`;
  return (
    <div className="card w-full p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-stone-300">Welt-Bilanz (nur Messung)</span>
        <span className="num text-[15px] font-semibold text-gold-light">Treffer {rate}</span>
      </div>
      <div className="num mt-0.5 text-[13px] text-stone-400">
        {s.total} Chancen · <span className="text-emerald-300">{s.ziel} Ziel</span> · <span className="text-red-300">{s.stop} Stop</span> · {s.verpasst} verpasst · {s.open} laufen
      </div>
      {busy.running && <div className="mt-1 text-[13px] text-amber-200">{busy.text}</div>}
    </div>
  );
}
