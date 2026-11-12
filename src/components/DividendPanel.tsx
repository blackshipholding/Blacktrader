"use client";
// Finanzen (Detailansicht einer Aktie): Dividenden dieses Werts – Ex-Tag, Auszahlungstag, Betrag je Aktie, deine Stück, netto.
// Beträge und Auszahlungstag lassen sich von Hand ändern (gilt für Blacktrader-Depot UND Buy & Hold); eigene Dividenden
// können ergänzt werden. Anspruch: vor dem Ex-Tag besessen; Gutschrift am Auszahlungstag; 27,5 % KESt, keine Gebühr.
import { useEffect, useMemo, useState } from "react";
import { netOfTax, sharesAtEx, type DivEvent } from "@/lib/analysis/dividends";
import { eventsFor, divKey, hasData, loadDividends, lotsOfHolding, lotsOfTrade, useDividendBook } from "@/lib/client/dividendBook";
import { tradeCurrency } from "@/lib/client/eur";
import { eurPerUnit } from "@/lib/fx";
import { actions, useAppData } from "@/lib/store/store";
import type { ResolvedAsset } from "@/lib/types";
import { Sheet } from "./Sheet";

const eur = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

export function DividendPanel({ asset }: { asset: ResolvedAsset }) {
  const trades = useAppData((d) => d.trades);
  const holdings = useAppData((d) => d.holdings);
  useDividendBook();
  const key = divKey(asset);
  const cur = tradeCurrency({ symbol: asset.symbol, kind: asset.kind, currency: asset.currency });
  const fx = eurPerUnit(cur) ?? 1;
  const lots = useMemo(
    () => [...trades.filter((t) => t.kind === asset.kind && t.symbol === asset.symbol).flatMap(lotsOfTrade), ...holdings.filter((h) => h.kind === asset.kind && h.symbol === asset.symbol).flatMap(lotsOfHolding)],
    [trades, holdings, asset.kind, asset.symbol],
  );
  const since = useMemo(() => Math.min(Date.now() - 3 * 365 * 86400e3, ...lots.map((l) => l.from)), [lots]);
  useEffect(() => {
    void loadDividends(asset, since);
  }, [asset.symbol, asset.yahooSymbol, since]); // eslint-disable-line react-hooks/exhaustive-deps
  const events = eventsFor(asset);
  const [edit, setEdit] = useState<DivEvent | "new" | null>(null);
  if (asset.kind !== "stock") return null;
  const shown = [...events].reverse().slice(0, 12);
  const held = lots.length > 0;
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Dividenden</span>
        <button className="text-[14px] text-gold-light underline" onClick={() => setEdit("new")}>
          Hinzufügen
        </button>
      </div>
      {!hasData(asset) && <p className="text-[15px] text-stone-400">Dividenden werden geladen …</p>}
      {hasData(asset) && shown.length === 0 && <p className="text-[15px] text-stone-300">Keine Dividenden gefunden.</p>}
      <ul className="divide-y divide-white/5">
        {shown.map((e) => {
          const shares = held ? sharesAtEx(lots, e.ex) : 0;
          const future = e.pay > Date.now();
          return (
            <li key={e.ex}>
              <button className="flex w-full items-baseline justify-between gap-3 py-2 text-left active:opacity-70" onClick={() => setEdit(e)}>
                <span className="min-w-0">
                  <span className={`num block text-[15px] ${e.skip ? "text-stone-500 line-through" : "text-stone-100"}`}>
                    {e.amount.toLocaleString("de-DE", { maximumFractionDigits: 4 })} {cur} je Aktie{e.edited ? " ✎" : ""}
                  </span>
                  <span className="num block text-[13px] text-stone-400">
                    Ex {new Date(e.ex).toLocaleDateString("de-DE")} · Zahltag {new Date(e.pay).toLocaleDateString("de-DE")}
                    {future ? " (erwartet)" : ""}
                  </span>
                </span>
                {shares > 0 && !e.skip && (
                  <span className="num text-right text-[15px] text-up">
                    {eur(netOfTax(shares * e.amount * fx))}
                    <span className="block text-[12px] text-stone-400">{shares.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück netto</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {edit && <EditSheet asset={asset} cur={cur} event={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditSheet({ asset, cur, event, onClose }: { asset: ResolvedAsset; cur: string; event: DivEvent | null; onClose: () => void }) {
  const key = divKey(asset);
  const [ex, setEx] = useState(event ? dayStr(event.ex) : dayStr(Date.now()));
  const [amount, setAmount] = useState(event ? String(event.amount).replace(".", ",") : "");
  const [pay, setPay] = useState(event ? dayStr(event.pay) : "");
  const [skip, setSkip] = useState(event?.skip ?? false);
  const [err, setErr] = useState("");
  const save = () => {
    const exMs = Date.parse(`${ex}T00:00:00Z`);
    const a = num(amount);
    if (!Number.isFinite(exMs)) return setErr("Bitte den Ex-Tag eingeben.");
    if (!(a >= 0) || !Number.isFinite(a)) return setErr("Bitte den Betrag je Aktie eingeben.");
    const payMs = pay ? Date.parse(`${pay}T00:00:00Z`) : undefined;
    actions.setDivEdit(key, { ex: exMs, amount: a, pay: payMs, skip, manual: !event });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={event ? `Dividende ${new Date(event.ex).toLocaleDateString("de-DE")}` : "Dividende hinzufügen"}>
      <div className="space-y-3 pb-3 text-[15px]">
        <label className="block text-stone-300">
          Ex-Tag (ab hier ohne Dividende)
          <input type="date" className="input mt-1" value={ex} onChange={(e) => setEx(e.target.value)} disabled={!!event} />
        </label>
        <label className="block text-stone-300">
          Betrag je Aktie ({cur})
          <input className="input num mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-stone-300">
          Auszahlungstag
          <input type="date" className="input mt-1" value={pay} onChange={(e) => setPay(e.target.value)} />
        </label>
        <label className="flex items-center gap-3 text-stone-300">
          <input type="checkbox" className="h-6 w-6 accent-[#C9A24A]" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Diese Dividende zählt nicht
        </label>
        {err && <p className="text-red-300">{err}</p>}
        <div className="flex gap-2">
          {event?.edited && (
            <button
              className="btn flex-1"
              onClick={() => {
                actions.clearDivEdit(key, event.ex);
                onClose();
              }}
            >
              Zurücksetzen
            </button>
          )}
          <button className="btn-primary flex-1" onClick={save}>
            Speichern
          </button>
        </div>
      </div>
    </Sheet>
  );
}
