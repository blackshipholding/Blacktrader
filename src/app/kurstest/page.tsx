"use client";
// Testseite: Welche deutsche Börse liefert für DEINE Werte Euro-Kurse? (Nutzer 12.11.2026) – danach EINE Börse für die ganze App wählen.
import { useState } from "react";
import { api } from "@/lib/client/api";
import { EXCHANGES, getExchange, probeBinanceEur, probeExchange, probeXStock, setExchange, type AssetRef } from "@/lib/client/euroPrice";
import { eurPerUnit } from "@/lib/fx";
import { useAppData } from "@/lib/store/store";

type Cell = { price: number; time?: number; symbol?: string; note?: string } | null | undefined;
const fmt = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const age = (t?: number) => {
  if (!t) return "";
  const m = Math.round((Date.now() / 1000 - t) / 60);
  return m < 1 ? "jetzt" : m < 90 ? `vor ${m} Min.` : `vor ${Math.round(m / 60)} Std.`;
};

export default function KursTest() {
  const trades = useAppData((d) => d.trades);
  const holdings = useAppData((d) => d.holdings);
  const watch = useAppData((d) => d.watchlist);
  const [sel, setSel] = useState(getExchange().suffix);
  const [rows, setRows] = useState<{ a: AssetRef; cells: Record<string, Cell>; bin?: Cell; yahoo?: Cell; xs?: Cell }[]>([]);
  const [busy, setBusy] = useState(false);

  const assets = (() => {
    const m = new Map<string, AssetRef>();
    for (const x of [...trades.filter((t) => t.status !== "closed"), ...holdings, ...watch] as AssetRef[]) {
      if (x.kind === "commodity") continue;
      if (!m.has(`${x.kind}:${x.symbol}`)) m.set(`${x.kind}:${x.symbol}`, x);
    }
    return [...m.values()].slice(0, 25);
  })();

  async function run() {
    setBusy(true);
    const out: typeof rows = [];
    for (const a of assets) {
      const cells: Record<string, Cell> = {};
      let bin: Cell;
      let yahoo: Cell;
      let xs: Cell;
      if (a.kind === "crypto") {
        bin = await probeBinanceEur(a.binanceSymbol);
        xs = await probeXStock(a.symbol.replace(/[-.].*$/, ""), true);
      }
      else {
        // Standard-Kurs der App: Yahoo (mit Vor-/Nachbörse) in Dollar, umgerechnet in Euro
        try {
          const q = await api.quote(a as never);
          const f = eurPerUnit(q.currency);
          if (q.price > 0 && f) yahoo = { price: q.price * f, time: q.time, note: q.source };
        } catch {
          yahoo = null;
        }
        if (a.kind === "stock") xs = await probeXStock(a.symbol.replace(/[-.].*$/, ""));
        for (const e of EXCHANGES) if (e.suffix) cells[e.suffix] = await probeExchange(a, e.suffix);
      }
      out.push({ a, cells, bin, yahoo, xs });
      setRows([...out]);
    }
    setBusy(false);
  }
  const cover = (suffix: string) => rows.filter((r) => r.a.kind === "stock" && r.cells[suffix]).length;
  const stocks = rows.filter((r) => r.a.kind === "stock").length;

  return (
    <div className="space-y-4 pb-8">
      <h1 className="text-[20px] text-gold-light">Kurs-Test: welche Börse?</h1>
      <p className="text-[15px] text-stone-300">Zeigt für deine Werte (Depot, Buy & Hold, Watchlist) den Euro-Kurs je Börse. Die gewählte Börse gilt dann für die ganze App (Aktien). Krypto: Binance in Euro.</p>
      <button className="btn-primary w-full" disabled={busy || !assets.length} onClick={() => void run()}>
        {busy ? "Prüfe …" : "Kurse prüfen"}
      </button>
      {rows.map((r) => (
        <div key={`${r.a.kind}:${r.a.symbol}`} className="card space-y-1 p-3 text-[14px]">
          <div className="font-semibold text-stone-50">{r.a.name} <span className="text-stone-400">{r.a.symbol}</span></div>
          {r.a.kind === "crypto" ? (
            <>
              <div className="num text-stone-200">Binance EUR: {r.bin ? `${fmt(r.bin.price)} ${age(r.bin.time)}` : "kein Euro-Paar"}</div>
              <div className="num text-stone-200">Kraken EUR: {r.xs ? `${fmt(r.xs.price)} ${age(r.xs.time)}` : "kein Euro-Paar"}</div>
            </>
          ) : (
            <>
            <div className="num flex justify-between text-stone-200">
              <span>Yahoo × Dollar/Euro <span className="text-stone-500">(Standard)</span></span>
              <span className={r.yahoo ? "" : "text-stone-500"}>{r.yahoo ? `${fmt(r.yahoo.price)} · ${age(r.yahoo.time)}${r.yahoo.note ? ` · ${r.yahoo.note.replace("Yahoo ", "")}` : ""}` : "nicht verfügbar"}</span>
            </div>
            {r.a.kind === "stock" && (
              <div className="num flex justify-between text-stone-200">
                <span>Kraken Token (24 h)</span>
                <span className={r.xs ? "" : "text-stone-500"}>{r.xs ? `$ ${r.xs.price.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${age(r.xs.time)}` : "nicht verfügbar"}</span>
              </div>
            )}
            {EXCHANGES.filter((e) => e.suffix).map((e) => {
              const c = r.cells[e.suffix];
              return (
                <div key={e.suffix} className="num flex justify-between text-stone-200">
                  <span>{e.label}</span>
                  <span className={c ? "" : "text-stone-500"}>{c ? `${fmt(c.price)} · ${age(c.time)}` : "nicht gefunden"}</span>
                </div>
              );
            })}
            </>
          )}
        </div>
      ))}
      {rows.length > 0 && !busy && (
        <div className="card space-y-2 p-3">
          <div className="text-[15px] text-stone-200">Quelle für Aktien (Treffer der deutschen Börsen bei {stocks} Aktien):</div>
          {EXCHANGES.map((e) => (
            <label key={e.suffix} className="flex min-h-[44px] items-center justify-between rounded-xl bg-white/5 px-3 text-[15px] text-stone-200">
              <span>
                {e.label} {e.suffix ? <span className="text-stone-400">({cover(e.suffix)} von {stocks})</span> : null}
              </span>
              <input type="radio" name="bx" className="h-5 w-5 accent-[#C9A24A]" checked={sel === e.suffix} onChange={() => (setSel(e.suffix), setExchange(e.suffix))} />
            </label>
          ))}
          <p className="text-[13px] text-stone-400">Gewählt: {EXCHANGES.find((e) => e.suffix === sel)?.label}. Gilt sofort für die ganze App.</p>
        </div>
      )}
    </div>
  );
}
