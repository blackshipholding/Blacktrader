"use client";
// Erwartete Dividenden pro Jahr (brutto, €) für gehaltene Aktien – aus den Firmenzahlen (Yahoo: Dividende je Aktie, sonst Rendite × Kurs).
import { useEffect, useMemo, useState } from "react";
import type { ResolvedAsset } from "../types";
import { api } from "./api";
import { dividendPerShareEur } from "./dividends";

export interface HeldItem {
  id: string;
  asset: Pick<ResolvedAsset, "kind" | "symbol" | "name" | "yahooSymbol" | "currency"> & { coingeckoId?: string };
  qty: number;
  /** aktueller Kurs in € je Stück (für „Rendite × Kurs“, wenn keine Dividende je Aktie bekannt ist) */
  priceEur?: number;
}

export function useAnnualDividendsGross(items: HeldItem[]): number {
  const [gross, setGross] = useState<Record<string, number>>({});
  const key = items.filter((i) => i.asset.kind === "stock" && i.qty > 0).map((i) => `${i.id}:${i.qty}`).join(",");
  const priced = items.filter((i) => i.priceEur != null).length;
  useEffect(() => {
    let alive = true;
    const run = async () => {
      for (const i of items) {
        if (i.asset.kind !== "stock" || !(i.qty > 0)) continue;
        try {
          const f = (await api.fundamentals(i.asset as ResolvedAsset)).fundamentals;
          const per = dividendPerShareEur(f);
          const perEur = per ?? (f && f.kind === "stock" && f.dividendYield && i.priceEur ? f.dividendYield * i.priceEur : null);
          if (alive) setGross((x) => ({ ...x, [i.id]: perEur != null ? perEur * i.qty : 0 }));
        } catch {
          /* ohne Firmenzahlen keine Dividende */
        }
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [key, priced]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => items.filter((i) => i.asset.kind === "stock" && i.qty > 0).reduce((a, i) => a + (gross[i.id] ?? 0), 0), [gross, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
