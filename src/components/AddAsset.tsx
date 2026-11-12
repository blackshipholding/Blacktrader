"use client";
// Suche nach ISIN, Symbol oder Name (z. B. "Apple") mit Vorschlagsliste.
import { useLiveQuote } from "@/lib/client/liveQuote";
import { money } from "@/lib/analysis/persona";
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeIsin, validateIsin } from "@/lib/analysis/isin";
import { haptic } from "@/lib/client/alerts";
import { api } from "@/lib/client/api";
import { actions, getData } from "@/lib/store/store";
import type { ResolvedAsset } from "@/lib/types";
import { IconSearch } from "./Icons";

const kindLabel = (c: ResolvedAsset) => (c.kind === "crypto" ? "Krypto" : c.kind === "commodity" ? "Rohstoff" : c.exchange ?? "Aktie/ETF");

/** `onPick`: statt zur Watchlist hinzufügen den gewählten Wert zurückgeben (z. B. Buy & Hold). */
/** Live-Kurs eines Suchtreffers (Yahoo/Binance) – Nutzer 12.11.2026: überall Live-Kurse, auch in der Suchliste */
function CandidatePrice({ c }: { c: ResolvedAsset }) {
  const q = useLiveQuote(c, true);
  if (!q) return <span className="num text-[13px] text-stone-500">Kurs lädt …</span>;
  return (
    <span className="num text-right">
      <span className="block text-[14px] font-semibold text-stone-100">{money(q.price, q.currency)}</span>
      <span className={`block text-[12px] ${q.changePct >= 0 ? "text-up" : "text-down"}`}>{`${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2).replace(".", ",")} %`}</span>
    </span>
  );
}

export function AddAsset({ onPick, actionLabel = "+ Hinzufügen" }: { onPick?: (c: ResolvedAsset) => void; actionLabel?: string } = {}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ResolvedAsset[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const seq = useRef(0);

  const isinState = useMemo(() => {
    const s = q.trim();
    if (!s) return null;
    if (looksLikeIsin(s) || (/^[A-Za-z]{2}\w{10}$/.test(s) && /\d/.test(s))) return validateIsin(s);
    return null;
  }, [q]);

  // Vorschläge während der Eingabe (ab 2 Zeichen, mit Verzögerung)
  useEffect(() => {
    const s = q.trim();
    setError(null);
    if (s.length < 2 || (isinState && !isinState.valid)) {
      setCandidates([]);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.resolve(s);
        if (my !== seq.current) return;
        setCandidates(r.candidates);
        if (r.candidates.length === 0) setError("Nichts gefunden. Name, Symbol (AAPL, SAP.DE, BTC) oder ISIN prüfen.");
      } catch (e) {
        if (my === seq.current) setError((e as Error).message);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q, isinState]);

  const choose = (c: ResolvedAsset) => {
    if (onPick) {
      onPick(c);
      setCandidates([]);
      setQ("");
      return;
    }
    actions.addWatch(c);
    if (getData().settings.haptics) haptic(20);
    setAdded(c.name);
    setCandidates([]);
    setQ("");
    setTimeout(() => setAdded(null), 2500);
  };

  return (
    <div className="card p-3">
      <label className="relative block">
        <span className="sr-only">Wert suchen</span>
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-500" />
        <input
          className={`input pl-11 ${isinState && !isinState.valid ? "border-red-400/70" : isinState?.valid ? "border-emerald-400/60" : ""}`}
          placeholder="Name, Symbol oder ISIN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="search"
          enterKeyHint="search"
        />
      </label>
      {isinState && !isinState.valid && <p className="mt-2 text-[14px] text-red-300">Ungültige ISIN: {isinState.reason}</p>}
      {isinState?.valid && <p className="mt-2 text-[14px] text-emerald-300">Gültige ISIN – Prüfziffer korrekt.</p>}
      {busy && <p className="mt-2 text-[14px] text-stone-400">Suche …</p>}
      {error && !busy && <p className="mt-2 text-[14px] text-red-300">{error}</p>}
      {added && <p className="mt-2 text-[14px] text-emerald-300">{added} zur Watchlist hinzugefügt.</p>}
      {candidates.length > 0 && (
        <ul className="mt-2 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10">
          {candidates.map((c) => (
            <li key={`${c.kind}:${c.symbol}`}>
              <button onClick={() => choose(c)} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-3 py-2 text-left active:bg-white/10">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-stone-100">{c.name}</span>
                  <span className="text-[13px] text-stone-400">
                    {c.symbol} · {kindLabel(c)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <CandidatePrice c={c} />
                  <span className="text-[13px] text-gold">{actionLabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
