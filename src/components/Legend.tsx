"use client";
import { useState } from "react";
import { IconInfo } from "./Icons";

/** Legende als Info-Symbol: je Badge eine Zeile. */
export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex h-11 w-11 items-center justify-center rounded-full text-stone-300 active:bg-white/10" aria-label="Legende anzeigen" aria-expanded={open}>
        <IconInfo className="h-6 w-6" />
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-30 mt-1 w-72 space-y-2.5 p-4 text-[14px] text-stone-300">
          <p className="text-stone-400">Blacktrader zeigt je Wert genau einen Einstieg:</p>
          <div className="flex items-center gap-2">
            <span className="badge-core">Langfristig</span> Blau: Einstieg in 3 Teilen, kein fester Stop
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-trade">Trade</span> Grün: steigende Kurse, mit Stop und Ziel
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-short">Short</span> Rot: fallende Kurse, mit Stop und Ziel
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-wait">Abwarten</span> Gelb: gerade kein sauberer Einstieg
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-muted">Verlauf</span> Grau: alte Einstiege (erledigt, ungültig, abgelöst)
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-risk">Hohes Risiko</span> Stop sehr weit entfernt
          </div>
          <p className="border-t border-white/10 pt-2 text-stone-400">
            <b className="text-stone-200">Stärke 0–100</b> (grün und rot): je höher, desto stärker das Signal. Ein grüner Trade wird blau, wenn der Wochenchart den Aufwärtstrend bestätigt – der Stop wird dann nur noch nachgezogen.
          </p>
        </div>
      )}
    </div>
  );
}
