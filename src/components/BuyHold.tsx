"use client";
// Buy & Hold: eigene Käufe von Aktien und ETFs. Eingabe: Datum, Preis je Stück (€), Stückzahl, Gebühr (Standard 7,90 €).
// Verkauft wird nur, wenn du es eingibst. Kurs jetzt: Börsenkurs, in Euro umgerechnet.
import { runScan, useScan } from "@/lib/client/scanner";
import { holdTrend } from "@/lib/client/holdingWatch";
import { COLOR_LABEL } from "./AssetCard";
import { useEffect, useMemo, useState } from "react";
import { AddAsset } from "./AddAsset";
import { Sheet } from "./Sheet";
import { api } from "@/lib/client/api";
import { HOLD_FEE, summarizeHolding, totalTax, type Holding } from "@/lib/client/holdings";
import { toEur } from "@/lib/fx";
import { actions, useAppData } from "@/lib/store/store";
import type { ResolvedAsset } from "@/lib/types";

const eur = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} %`;
/** Zahl aus der Eingabe: „1.234,56“ und „1234.56“ werden beide richtig gelesen */
const num = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  const v = t.includes(",") ? parseFloat(t.replace(/\./g, "").replace(",", ".")) : parseFloat(t);
  return Number.isFinite(v) ? v : 0;
};
const today = () => new Date().toISOString().slice(0, 10);

type Form = { mode: "buy" | "sell" | "div"; holding?: Holding; asset?: ResolvedAsset } | null;

/** Aktueller Kurs in Euro je Wert (alle 60 Sekunden) */
function usePrices(holdings: Holding[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const key = holdings.map((h) => h.id).join(",");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      for (const h of holdings) {
        try {
          const q = await api.quote(h);
          const p = toEur(q.price, q.currency ?? h.currency) ?? q.price;
          if (alive && p > 0) setPrices((x) => ({ ...x, [h.id]: p }));
        } catch {
          /* Kurs gerade nicht erreichbar */
        }
      }
    };
    void load();
    const t = setInterval(load, 60e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return prices;
}

/** Was Blacktrader zu deinem Wert sagt: großer Trend (Wochenchart) und aktueller Einstieg – nur zur Info, kein Verkauf. */
function BlacktraderView({ h }: { h: Holding }) {
  const scan = useScan();
  const e = scan.entries.find((x) => x.asset.kind === h.kind && x.asset.symbol === h.symbol);
  if (!e) return <div className="mt-1 text-[13px] text-stone-500">{scan.busy ? "Blacktrader rechnet …" : "Blacktrader: noch keine Analyse"}</div>;
  const t = holdTrend(e);
  return (
    <div className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[13px] ${t === -1 ? "bg-red-500/15 text-red-200" : "bg-white/5 text-stone-300"}`}>
      Blacktrader: großer Trend {t === 1 ? "steigend ↑" : t === -1 ? "fallend ↓ – Achtung, prüfe deine Position" : "unklar"} · aktuell {COLOR_LABEL[e.best.color]}
    </div>
  );
}

export function BuyHold() {
  const holdings = useAppData((d) => d.holdings);
  const scan = useScan();
  // Blacktrader-Analyse für deine Werte: Suche starten; fehlt ein neu eingetragener Wert, nach 1 Minute erneut suchen
  const missing = holdings.some((h) => !scan.entries.some((x) => x.asset.kind === h.kind && x.asset.symbol === h.symbol));
  useEffect(() => {
    void runScan(missing ? 60e3 : undefined);
  }, [missing]);
  const prices = usePrices(holdings);
  const [form, setForm] = useState<Form>(null);
  const [detail, setDetail] = useState<Holding | null>(null);

  const rows = useMemo(
    () =>
      holdings.map((h) => {
        const s = summarizeHolding(h);
        const price = prices[h.id];
        const value = price != null ? s.qty * price : null;
        const open = value != null ? value - s.cost : null;
        return { h, s, price, value, open };
      }),
    [holdings, prices],
  );
  const held = rows.filter((r) => r.s.qty > 0);
  const sold = rows.filter((r) => r.s.qty === 0);
  const value = held.reduce((a, r) => a + (r.value ?? r.s.cost), 0);
  const cost = held.reduce((a, r) => a + r.s.cost, 0);
  const openPl = held.reduce((a, r) => a + (r.open ?? 0), 0);
  const realized = rows.reduce((a, r) => a + r.s.realized, 0);
  const fees = rows.reduce((a, r) => a + r.s.fees, 0);
  const dividends = rows.reduce((a, r) => a + r.s.dividends, 0);
  const tax = totalTax(rows.map((r) => r.s));
  const total = openPl + realized + dividends - fees - tax;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="label">Wert deiner Buy-&-Hold-Positionen</div>
        <div className="num text-[30px] font-semibold leading-tight text-stone-50">{eur(value)}</div>
        <div className={`num text-[16px] ${total >= 0 ? "text-up" : "text-down"}`}>
          {eur(total, true)} gesamt nach Gebühren (KESt fällt erst beim Verkauf an){cost > 0 ? ` · offen ${pct((openPl / cost) * 100)}` : ""}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[14px]">
        <div className="card px-3 py-2.5">
          <div className="label">Gewinn offen</div>
          <div className={`num text-[17px] font-semibold ${openPl >= 0 ? "text-up" : "text-down"}`}>{eur(openPl, true)}</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className="label">Gewinn verkauft</div>
          <div className={`num text-[17px] font-semibold ${realized >= 0 ? "text-up" : "text-down"}`}>{eur(realized, true)}</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className="label">Dividenden (brutto)</div>
          <div className="num text-[17px] font-semibold text-stone-50">{eur(dividends)}</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className="label">Gebühren</div>
          <div className="num text-[17px] font-semibold text-stone-50">{eur(fees)}</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className="label">KESt (geschätzt)</div>
          <div className="num text-[17px] font-semibold text-stone-50">{eur(tax)}</div>
        </div>
      </div>

      <button className="btn-primary w-full" onClick={() => setForm({ mode: "buy" })}>
        + Kauf eintragen (Aktie oder ETF)
      </button>

      {held.length === 0 && sold.length === 0 && <div className="card p-5 text-center text-[15px] text-stone-300">Noch keine Käufe. Trag deinen ersten Kauf mit Datum, Preis je Stück und Stückzahl ein.</div>}

      <div className="space-y-3">
        {held.map(({ h, s, price, value: v, open }) => (
          <button key={h.id} className="card edge-core w-full p-4 text-left" onClick={() => setDetail(h)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold text-stone-50">{h.name}</div>
                <div className="text-[13px] text-stone-400">
                  {h.symbol} · {s.qty.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück · Ø {eur(s.avg)}
                </div>
              </div>
              <div className="text-right">
                <div className="num text-[17px] font-semibold text-stone-50">{v != null ? eur(v) : "–"}</div>
                <div className={`num text-[14px] ${open == null ? "text-stone-400" : open >= 0 ? "text-up" : "text-down"}`}>{open == null ? "Kurs lädt …" : `${eur(open, true)} (${pct((open / s.cost) * 100)})`}</div>
              </div>
            </div>
            <div className="mt-1 text-[13px] text-stone-400">Kurs jetzt {price != null ? eur(price) : "–"} · gekauft für {eur(s.cost)}</div>
            <BlacktraderView h={h} />
          </button>
        ))}
        {sold.length > 0 && (
          <>
            <div className="label pt-2">Ganz verkauft</div>
            {sold.map(({ h, s }) => (
              <button key={h.id} className="card w-full p-3 text-left" onClick={() => setDetail(h)}>
                <div className="flex justify-between">
                  <span className="text-[15px] text-stone-200">{h.name}</span>
                  <span className={`num text-[15px] ${s.realized >= 0 ? "text-up" : "text-down"}`}>{eur(s.realized, true)}</span>
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {holdings.length > 0 && (
        <button
          className="btn-danger w-full"
          onClick={() => {
            if (window.confirm("Alle Buy-&-Hold-Einträge löschen? Was Blacktrader gelernt hat, bleibt erhalten.")) actions.clearHoldings();
          }}
        >
          Buy & Hold löschen
        </button>
      )}
      <p className="text-[13px] text-stone-500">KESt geschätzt wie in Österreich: 27,5 % auf verkaufte Gewinne (gleitender Durchschnittspreis, Gebühren nicht abziehbar, Gewinne und Verluste eines Jahres verrechnet). Maßgeblich ist die Abrechnung deiner Bank.</p>

      <TxSheet form={form} onClose={() => setForm(null)} />

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ""}>
        {detail && <HoldingDetail id={detail.id} onBuy={(h) => (setDetail(null), setForm({ mode: "buy", holding: h }))} onSell={(h) => (setDetail(null), setForm({ mode: "sell", holding: h }))} onDiv={(h) => (setDetail(null), setForm({ mode: "div", holding: h }))} onClose={() => setDetail(null)} />}
      </Sheet>
    </div>
  );
}

function HoldingDetail({ id, onBuy, onSell, onDiv, onClose }: { id: string; onBuy: (h: Holding) => void; onSell: (h: Holding) => void; onDiv: (h: Holding) => void; onClose: () => void }) {
  const h = useAppData((d) => d.holdings.find((x) => x.id === id));
  if (!h) return <p className="text-stone-400">Gelöscht.</p>;
  const s = summarizeHolding(h);
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-300">
        {s.qty.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück · Ø Kaufpreis {eur(s.avg)} · Gewinn verkauft {eur(s.realized, true)} · Gebühren {eur(s.fees)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary" onClick={() => onBuy(h)}>
          Nachkaufen
        </button>
        <button className="btn" disabled={s.qty <= 0} onClick={() => onSell(h)}>
          Verkaufen
        </button>
        <button className="btn col-span-2" onClick={() => onDiv(h)}>
          Dividende eintragen
        </button>
        <button
          className="btn-danger col-span-2"
          onClick={() => {
            if (window.confirm(`${h.name} mit allen Käufen und Verkäufen löschen?`)) {
              onClose();
              actions.removeHolding(h.id);
            }
          }}
        >
          Wert löschen
        </button>
      </div>
      <div className="label">Käufe und Verkäufe</div>
      <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
        {[...h.txs]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="num text-[14px] text-stone-300">
                {new Date(t.date).toLocaleDateString("de-DE")} ·{" "}
                {t.type === "div" ? (
                  <span className="text-sky-200">Dividende {eur(t.price)}</span>
                ) : (
                  <>
                    <span className={t.type === "buy" ? "text-up" : "text-down"}>{t.type === "buy" ? "Kauf" : "Verkauf"}</span> {t.qty.toLocaleString("de-DE", { maximumFractionDigits: 4 })} × {eur(t.price)}
                    {t.fee ? ` + ${eur(t.fee)} Gebühr` : ""}
                  </>
                )}
              </span>
              <button
                className="text-[13px] text-stone-500 underline"
                onClick={() => {
                  if (window.confirm("Diesen Eintrag löschen?")) {
                    if (h.txs.length === 1) onClose();
                    actions.removeHoldingTx(h.id, t.id);
                  }
                }}
              >
                löschen
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

function TxSheet({ form, onClose }: { form: Form; onClose: () => void }) {
  const [asset, setAsset] = useState<ResolvedAsset | null>(null);
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [fee, setFee] = useState(String(HOLD_FEE).replace(".", ","));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!form) return;
    setAsset(form.asset ?? null);
    setDate(today());
    setPrice("");
    setQty("");
    setFee(String(HOLD_FEE).replace(".", ","));
    setErr(null);
  }, [form]);
  if (!form) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const h = form.holding;
  const sell = form.mode === "sell";
  const div = form.mode === "div";
  const held = h ? summarizeHolding(h).qty : 0;
  const target = h ?? asset;
  const save = () => {
    const p = num(price);
    const q = num(qty);
    const f = num(fee);
    if (!target) return setErr("Bitte zuerst den Wert suchen und auswählen.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr("Bitte ein Datum eingeben.");
    if (div) {
      if (!(p > 0) || !h) return setErr("Bitte den Dividenden-Betrag (brutto, in €) eingeben.");
      actions.addHoldingTx(h.id, { type: "div", date, price: p, qty: 1, fee: 0 });
      return onClose();
    }
    if (!(p > 0)) return setErr("Bitte den Preis je Stück in Euro eingeben.");
    if (!(q > 0)) return setErr("Bitte die Stückzahl eingeben.");
    if (sell && q > held + 1e-9) return setErr(`Du hast nur ${held.toLocaleString("de-DE")} Stück.`);
    const tx = { type: form.mode, date, price: p, qty: q, fee: f >= 0 ? f : 0 };
    if (h) actions.addHoldingTx(h.id, tx);
    else if (asset) actions.addHolding({ symbol: asset.symbol, name: asset.name, kind: asset.kind, yahooSymbol: asset.yahooSymbol, binanceSymbol: asset.binanceSymbol, isin: asset.isin, exchange: asset.exchange, currency: asset.currency }, tx);
    onClose();
  };
  const p = num(price);
  const q = num(qty);
  return (
    <Sheet open onClose={onClose} title={div ? `Dividende: ${h?.name}` : sell ? `Verkauf: ${h?.name}` : h ? `Nachkauf: ${h.name}` : "Kauf eintragen"}>
      <div className="space-y-3 text-[15px]">
        {!h &&
          (asset ? (
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
              <span>
                <span className="block font-medium text-stone-100">{asset.name}</span>
                <span className="text-[13px] text-stone-400">{asset.symbol}</span>
              </span>
              <button className="text-[14px] text-gold underline" onClick={() => setAsset(null)}>
                ändern
              </button>
            </div>
          ) : (
            <AddAsset onPick={setAsset} actionLabel="Auswählen" />
          ))}
        <label className="block text-stone-300">
          Datum
          <input className="input mt-1" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        {div ? (
          <label className="block text-stone-300">
            Dividende gesamt in € (brutto, vor Steuer)
            <input className="input num mt-1" inputMode="decimal" placeholder="z. B. 12,40" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        ) : (
          <>
        <label className="block text-stone-300">
          Preis je Stück in €
          <input className="input num mt-1" inputMode="decimal" placeholder="z. B. 123,45" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="block text-stone-300">
          Stückzahl{sell ? ` (du hast ${held.toLocaleString("de-DE", { maximumFractionDigits: 4 })})` : ""}
          <input className="input num mt-1" inputMode="decimal" placeholder="z. B. 10" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="block text-stone-300">
          Gebühr in €
          <input className="input num mt-1" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
          </>
        )}
        {!div && p > 0 && q > 0 && <p className="num text-stone-400">{sell ? "Erlös" : "Betrag"}: {eur(p * q)} {sell ? "−" : "+"} {eur(num(fee))} Gebühr</p>}
        {err && <p className="text-red-300">{err}</p>}
        <button className="btn-primary w-full" onClick={save}>
          {div ? "Dividende speichern" : sell ? "Verkauf speichern" : "Kauf speichern"}
        </button>
      </div>
    </Sheet>
  );
}
