"use client";
// Welt-Bilanz (Nutzer 13.11.2026): Chancen in Industrieländern, großen Schwellenländern Asiens, Coins und Rohstoffen – NUR gemessen,
// nicht in der Chancen-Liste, nicht im Depot. Getrennt nach Regionen, damit man sieht, wo die Trefferquote gut ist.
import { useState } from "react";
import { runWorldScan, setWorldScanOn, useWorldBusy, useWorldLog, worldScanOn, worldStats } from "@/lib/client/worldScan";

export function WorldRecord() {
  const log = useWorldLog();
  const busy = useWorldBusy();
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const s = worldStats(log);
  const rate = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)} %`);
  const on = worldScanOn();
  return (
    <div className="card w-full p-3 text-left">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="text-[14px] text-stone-300">Welt-Bilanz (nur Messung)</span>
        <span className="num text-[15px] font-semibold text-gold-light">Treffer {rate(s.all.hitRate)}</span>
      </button>
      <div className="num mt-0.5 text-[13px] text-stone-400">
        {s.all.total} Chancen · <span className="text-emerald-300">{s.all.ziel} Ziel</span> · <span className="text-red-300">{s.all.stop} Stop</span> · {s.all.verpasst} verpasst · {s.all.open} laufen
      </div>
      {busy.running && <div className="mt-1 text-[13px] text-amber-200">{busy.text}</div>}
      {open && (
        <div className="mt-2 space-y-0.5 text-[13px] text-stone-300">
          {s.byRegion.map((r) => (
            <div key={r.region} className="num flex justify-between gap-2">
              <span>{r.region}: {r.total} · {r.ziel} Ziel · {r.stop} Stop · {r.open} laufen</span>
              <span>{rate(r.hitRate)}</span>
            </div>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="btn" disabled={busy.running} onClick={() => void runWorldScan(true)}>
              Jetzt suchen
            </button>
            <button
              className="btn"
              onClick={() => {
                setWorldScanOn(!on);
                force((n) => n + 1);
              }}
            >
              Täglich: {on ? "an" : "aus"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
