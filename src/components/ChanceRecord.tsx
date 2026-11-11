"use client";
// Live-Bilanz aller Chancen (ab dem ersten Erscheinen mitgeschrieben – auch nicht übernommene).
import { useState } from "react";
import { chanceStats } from "@/lib/client/chanceLog";
import { LIVE_CHECK, liveCheck } from "@/lib/client/liveCheck";
import { actions, useAppData } from "@/lib/store/store";

export function ChanceRecord() {
  const log = useAppData((d) => d.chanceLog);
  const [open, setOpen] = useState(false);
  const s = chanceStats(log);
  if (!s.total) return null;
  const chk = liveCheck(log);
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)} %`);
  const rate = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)} %`);
  return (
    <div role="button" tabIndex={0} className="card w-full cursor-pointer p-3 text-left" onClick={() => setOpen(!open)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-stone-300">
          Live-Bilanz seit {s.since ? new Date(s.since * 1000).toLocaleDateString("de-DE") : "–"}
        </span>
        <span className="num text-[15px] font-semibold text-gold-light">Treffer {rate(s.hitRate)}</span>
      </div>
      <LiveStatus chk={chk} pct={pct} />
      <div className="num mt-0.5 text-[13px] text-stone-400">
        {s.total} Chancen · <span className="text-emerald-300">{s.ziel} Ziel</span> · <span className="text-red-300">{s.stop} Stop</span> · {s.verpasst} verpasst · {s.open} laufen
      </div>
      {open && (
        <div className="mt-2 space-y-0.5 text-[13px] text-stone-300">
          {(["gruen", "blau", "rot"] as const).map((c) => {
            const x = chanceStats(log, c);
            return x.total ? (
              <div key={c} className="num flex justify-between">
                <span>{c === "gruen" ? "Grün" : c === "blau" ? "Blau" : "Rot"}: {x.total} · {x.ziel} Ziel · {x.stop} Stop · {x.verpasst} verpasst · {x.open} laufen</span>
                <span>{rate(x.hitRate)}</span>
              </div>
            ) : null;
          })}
          <button
            className="btn-danger mt-2 w-full"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm("Live-Bilanz löschen und neu beginnen? Was Blacktrader gelernt hat, bleibt erhalten.")) actions.setChanceLog([]);
            }}
          >
            Live-Bilanz löschen
          </button>
        </div>
      )}
    </div>
  );
}

/** Stufe 1: echte Trefferquote gegen die Erwartung aus den Tests (gleiche Regeln) */
function LiveStatus({ chk, pct }: { chk: ReturnType<typeof liveCheck>; pct: (x: number | null) => string }) {
  if (chk.warn)
    return (
      <p className="mt-1 rounded-lg bg-red-500/15 px-2 py-1 text-[13px] text-red-200">
        ⚠️ Live schlechter als erwartet: Treffer {pct(chk.all.rate)} bei {chk.all.n} Ergebnissen, laut Test ca. {pct(chk.all.expected)}. Das ist mehr als Zufall – Regeln prüfen.
      </p>
    );
  if (chk.all.verdict === "zu-wenig") return <p className="mt-1 text-[13px] text-stone-500">Kontrolle gegen den Test ab {LIVE_CHECK.minAll} Ergebnissen (bisher {chk.all.n}).</p>;
  return (
    <p className="mt-1 text-[13px] text-emerald-300">
      Live {chk.all.verdict === "besser" ? "besser als erwartet" : "im erwarteten Bereich"} (Test: ca. {pct(chk.all.expected)}).
    </p>
  );
}
