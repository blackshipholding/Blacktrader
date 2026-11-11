"use client";
// „Kurs in Deutschland“ für US-Aktien: Euro-Kurs an Xetra (z. B. Apple = APC.DE) – zum Vergleich mit gettex/Tradegate.
// Die Analyse bleibt auf der Heimatbörse (mehr Handel, sauberere Wellen).
import { useEffect, useState } from "react";
import { api } from "./api";

const KEY = "bt-de-listing-v1";
const readMap = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const writeMap = (m: Record<string, string>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ohne Speicher */
  }
};

async function findListing(a: { symbol: string; name: string; isin?: string }): Promise<string | null> {
  const m = readMap();
  if (m[a.symbol] != null) return m[a.symbol] || null;
  let found = "";
  for (const q of [a.isin, a.name].filter(Boolean) as string[]) {
    try {
      const r = await api.resolve(q);
      const c = r.candidates.find((x) => x.kind === "stock" && /\.DE$/i.test(x.yahooSymbol ?? x.symbol));
      if (c) {
        found = c.yahooSymbol ?? c.symbol;
        break;
      }
    } catch {
      /* nächster Versuch */
    }
  }
  writeMap({ ...readMap(), [a.symbol]: found });
  return found || null;
}

/** Euro-Kurs an Xetra für eine US-Aktie (null = keine Notierung gefunden / nicht nötig) */
export function useGermanQuote(a: { kind: string; symbol: string; name: string; isin?: string; yahooSymbol?: string }, currency?: string) {
  const [q, setQ] = useState<{ symbol: string; price: number } | null>(null);
  const relevant = a.kind === "stock" && currency === "USD" && !/[.=^]/.test(a.yahooSymbol ?? a.symbol);
  useEffect(() => {
    if (!relevant) return;
    let alive = true;
    const load = async () => {
      const sym = await findListing(a);
      if (!sym || !alive) return;
      try {
        const r = await api.quote({ kind: "stock", symbol: sym, name: sym, yahooSymbol: sym } as never);
        if (alive && r.price > 0 && (r.currency ?? "EUR") === "EUR") setQ({ symbol: sym, price: r.price });
      } catch {
        /* nicht erreichbar */
      }
    };
    void load();
    const t = setInterval(load, 60e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [relevant, a.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  return relevant ? q : null;
}
