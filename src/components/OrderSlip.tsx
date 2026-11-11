"use client";
// Order-Zettel für flatex: Stückzahl für 500 € und Preise in Euro, mit „Kopieren“.
import { useState } from "react";
import { makeOrderSlip, type SlipInput } from "@/lib/client/orderSlip";

const fmt = (x: number) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2 });

export function OrderSlip(p: SlipInput) {
  const s = makeOrderSlip(p);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-gold/30 bg-black/30 p-3 text-[14px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-gold-light">Order-Zettel für flatex</span>
        <button
          className="text-[13px] text-gold underline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(s.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* Kopieren nicht erlaubt */
            }
          }}
        >
          {copied ? "Kopiert ✓" : "Kopieren"}
        </button>
      </div>
      <pre className="num whitespace-pre-wrap font-sans text-stone-200">{s.text}</pre>
      {s.tooExpensive && <p className="mt-1 text-amber-300">1 Stück kostet mehr als {p.tranches?.length ? "ein Teil (ca. 183 €)" : "550 €"} – im Rahmen von 500 € (+ höchstens 50 €) ist hier kein ganzes Stück möglich.</p>}
      {s.fx !== 1 && <p className="mt-1 text-[13px] text-stone-500">Umgerechnet mit dem aktuellen Wechselkurs. Ändert er sich, meldet die App, wann du den Stop bei flatex anpassen solltest. Gesamt ca. {fmt(s.totalEur)} €.</p>}
    </div>
  );
}
