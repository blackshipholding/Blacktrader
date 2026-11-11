"use client";
// flatex-Depot wählen (der Nutzer hat mehrere getrennte Depots). Die Wahl wird als Vorauswahl gemerkt.
import { actions, useAppData } from "@/lib/store/store";
import { money } from "@/lib/analysis/persona";

export function DepotPicker({ value, onChange, label = "In welchem flatex-Depot kaufst du?", noDefault = false }: { value?: number; onChange?: (d: number) => void; label?: string; noDefault?: boolean }) {
  const names = useAppData((d) => d.settings.depotNames);
  const last = useAppData((d) => d.settings.lastDepot);
  // Bei einem bestehenden Kauf ohne Depot nichts vorwählen (sonst sähe es gespeichert aus)
  const cur = value ?? (noDefault ? undefined : last);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n, i) => (
          <button
            key={i}
            type="button"
            className={`chip min-h-[38px] ${cur === i + 1 ? "border-gold bg-gold font-semibold text-stone-950" : "border-white/15 text-stone-300"}`}
            onClick={() => {
              if (onChange) onChange(i + 1);
              else actions.setSettings({ lastDepot: i + 1 });
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {noDefault && value == null && <p className="mt-1 text-[13px] text-amber-300">Noch kein Depot gespeichert – bitte antippen.</p>}
    </div>
  );
}

/** Kleines Depot-Schild */
export function DepotBadge({ depot, showMissing = false }: { depot?: number; showMissing?: boolean }) {
  const names = useAppData((d) => d.settings.depotNames);
  if (!depot) return showMissing ? <span className="ml-1.5 inline-block rounded-full border border-dashed border-stone-400 px-2 py-0.5 text-[11px] font-semibold text-stone-300">Depot ?</span> : null;
  return <span className="ml-1.5 inline-block rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold-light">{names[depot - 1] ?? `Depot ${depot}`}</span>;
}

/** Hinweis: Kurs liegt schon unter dem (oberen) Limit → Kauf sofort zum Marktpreis */
export function MarketNote({ price, top, cur }: { price?: number | null; top: number; cur?: string }) {
  if (!(price != null && price > 0 && price < top)) return null;
  const f = (x: number) => money(x, cur);
  return <p className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-2.5 text-[13px] text-amber-100">Kurs ({f(price)}) liegt schon unter dem Bereich ({f(top)}) – Kauf jetzt zum Marktpreis. Stück und Betrag sind mit dem aktuellen Kurs gerechnet.</p>;
}
