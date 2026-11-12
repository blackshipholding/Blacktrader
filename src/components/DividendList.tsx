"use client";
// Liste der ausgezahlten Dividenden (netto nach 27,5 % KESt) – für Blacktrader-Depot und Buy & Hold
import { netOfTax } from "@/lib/analysis/dividends";
import { Sheet } from "./Sheet";

export interface DivRow {
  key: string;
  name: string;
  /** Datum der Gutschrift (JJJJ-MM-TT) */
  date: string;
  sub: string;
  gross: number;
}

const eur = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function DividendListSheet({ open, onClose, rows, netTotal }: { open: boolean; onClose: () => void; rows: DivRow[]; netTotal?: number }) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const total = netTotal ?? sorted.reduce((a, r) => a + netOfTax(r.gross), 0);
  return (
    <Sheet open={open} onClose={onClose} title="Dividenden (netto nach 27,5 % KESt)">
      <div className="space-y-2 text-[15px]">
        {sorted.length === 0 && <p className="text-stone-300">Noch keine Dividende ausgezahlt.</p>}
        {sorted.map((c) => (
          <div key={c.key} className="num flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
            <span>
              <b>{c.name}</b>
              <span className="block text-[13px] text-stone-400">
                {new Date(c.date).toLocaleDateString("de-DE")} · {c.sub}
              </span>
            </span>
            <span className="text-up">{eur(netOfTax(c.gross))}</span>
          </div>
        ))}
        {sorted.length > 0 && (
          <div className="num flex justify-between border-t border-white/10 pt-2 font-semibold">
            <span>Summe netto</span>
            <span className="text-up">{eur(total)}</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}
