"use client";
// Hinweis im Order-Zettel: Limit über dem Kurs wird sofort zum Marktpreis ausgeführt.
import { money } from "@/lib/analysis/persona";

export function MarketNote({ price, top, cur }: { price?: number | null; top: number; cur?: string }) {
  if (!(price != null && price > 0 && price < top)) return null;
  const f = (x: number) => money(x, cur);
  return <p className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-2.5 text-[13px] text-amber-100">Kurs ({f(price)}) liegt schon unter dem Bereich ({f(top)}) – Kauf jetzt zum Marktpreis. Stück und Betrag sind mit dem aktuellen Kurs gerechnet.</p>;
}
