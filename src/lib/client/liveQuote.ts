"use client";
// Live-Kurs (Yahoo / Binance) für Kacheln, die nicht in Watchlist oder Depot stehen (Übersicht, Chancen, Detailansicht von
// Suchtreffern) – Nutzer 12.11.2026: überall in der ganzen App der Live-Kurs, nicht nur in den Depots.
// Ein Abruf je Wert und Minute, mehrfach geöffnete Kacheln teilen sich ihn.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Quote } from "../types";

type Ref = { kind: string; symbol: string; name: string; yahooSymbol?: string; binanceSymbol?: string };
const cache = new Map<string, { at: number; q: Quote }>();
const pending = new Map<string, Promise<Quote | null>>();

async function fetchQuote(a: Ref, maxAgeMs: number): Promise<Quote | null> {
  const key = `${a.kind}:${a.symbol}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < maxAgeMs) return c.q;
  const p0 = pending.get(key);
  if (p0) return p0;
  const p = api
    .quote(a as never)
    .then((q) => (q.price > 0 ? (cache.set(key, { at: Date.now(), q }), q) : null))
    .catch(() => null)
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Live-Kurs eines Werts (undefined = noch keiner). `enabled=false`: kein Abruf. */
export function useLiveQuote(a: Ref, enabled: boolean): Quote | undefined {
  const [q, setQ] = useState<Quote | undefined>(() => cache.get(`${a.kind}:${a.symbol}`)?.q);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => void fetchQuote(a, 50e3).then((r) => alive && r && setQ(r));
    load();
    const t = setInterval(load, 60e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled, a.kind, a.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  return enabled ? q : undefined;
}
