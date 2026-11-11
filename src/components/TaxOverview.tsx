"use client";
// Steuer-Jahresübersicht: Blacktrader-Trades und Buy & Hold zusammen (zum Abgleich mit der flatex-Abrechnung).
import { useMemo } from "react";
import { taxYears } from "@/lib/client/taxYear";
import { useAppData } from "@/lib/store/store";

const eur = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function TaxOverview() {
  const trades = useAppData((d) => d.trades);
  const holdings = useAppData((d) => d.holdings);
  const years = useMemo(() => taxYears(trades, holdings), [trades, holdings]);
  if (!years.length) return null;
  return (
    <details className="card p-4 text-[14px]">
      <summary className="cursor-pointer text-[15px] font-medium text-gold-light">Steuer-Jahresübersicht (KESt geschätzt)</summary>
      <div className="mt-2 space-y-3">
        {years.map((r) => (
          <div key={r.year} className="rounded-xl bg-white/5 p-3">
            <div className="flex justify-between font-semibold text-stone-100">
              <span>{r.year}</span>
              <span className="num">KESt {eur(r.kest)}</span>
            </div>
            <div className="num mt-1 grid grid-cols-2 gap-x-2 text-stone-300">
              <span>Blacktrader-Trades</span>
              <span className={`text-right ${r.trades >= 0 ? "text-up" : "text-down"}`}>{eur(r.trades, true)}</span>
              <span>Buy & Hold verkauft</span>
              <span className={`text-right ${r.sold >= 0 ? "text-up" : "text-down"}`}>{eur(r.sold, true)}</span>
              <span>Dividenden</span>
              <span className="text-right">{eur(r.dividends)}</span>
              <span className="font-medium">Summe (verrechnet)</span>
              <span className={`text-right font-medium ${r.total >= 0 ? "text-up" : "text-down"}`}>{eur(r.total, true)}</span>
            </div>
          </div>
        ))}
        <p className="text-[13px] text-stone-500">27,5 % KESt auf die Summe eines Jahres; Verluste werden mit Gewinnen und Dividenden verrechnet, Gebühren sind nicht abziehbar. Ausländische Quellensteuer auf Dividenden ist nicht berücksichtigt. Maßgeblich ist die Abrechnung von flatex.</p>
      </div>
    </details>
  );
}
