"use client";
// Buy & Hold: eigene Käufe von Aktien und ETFs. Eingabe: Datum, Preis je Stück (€), Stückzahl, Gebühr (Standard 7,90 €).
// Verkauft wird nur, wenn du es eingibst. Kurs jetzt: Börsenkurs, in Euro umgerechnet.
import { runScan, useScan } from "@/lib/client/scanner";
import { holdTrend } from "@/lib/client/holdingWatch";
import { getStopParams } from "@/lib/client/stopParams";
import type { ReasonNote } from "./AssetDetail";
import { useEffect, useMemo, useState } from "react";
import { AddAsset } from "./AddAsset";
import { Sheet } from "./Sheet";
import { displayCurrency } from "@/lib/client/eur";
import { api } from "@/lib/client/api";
import { HOLD_FEE, orderError, reservedForSale, summarizeHolding, totalTax, type HoldOrder, type Holding } from "@/lib/client/holdings";
import { clearHoldHit } from "@/lib/client/missedStop";
import { eurPerUnit, toEur } from "@/lib/fx";
import { dividendPerShareEur, netOfTax } from "@/lib/client/dividends";
import { creditsOfHolding, holdingSummary, loadForPositions, useDividendBook } from "@/lib/client/dividendBook";
import { useAnnualDividendsGross } from "@/lib/client/annualDividends";
import { DividendListSheet } from "./DividendList";
import { protectDue } from "@/lib/analysis/longterm";
import { actions, useAppData } from "@/lib/store/store";
import type { Horizon, ResolvedAsset } from "@/lib/types";
import { EntryTile } from "./EntryTile";
import { useAssetSheet } from "./AssetSheet";

const eur = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} %`;
/** Zahl aus der Eingabe: „1.234,56“ und „1234.56“ werden beide richtig gelesen */
const num = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  const v = t.includes(",") ? parseFloat(t.replace(/\./g, "").replace(",", ".")) : parseFloat(t);
  return Number.isFinite(v) ? v : 0;
};
const today = () => new Date().toISOString().slice(0, 10);

type OrderForm = { holding: Holding; kind: HoldOrder["kind"] } | null;
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

/**
 * EINE Karte pro Kauf (Nutzer 12.11.2026): oben deine Position (Antippen → Kauf/Verkauf/Dividende), darunter Blacktraders
 * Chart, Balken und Einstieg/Stop/Ziel (Antippen → Detailansicht). Es gilt EIN Szenario – das von Blacktrader (wie bei den
 * Aktien). Hinweise zur Position (großer Trend fällt, Shipmaster-Tipp) stehen in der Detailansicht unter der Begründung.
 */
function HoldCard({ h, price, value, open, onOpenPosition, onOpenAsset }: { h: Holding; price?: number; value: number | null; open: number | null; onOpenPosition: () => void; onOpenAsset: (a: ResolvedAsset, horizon: Horizon | undefined, notes: ReasonNote[]) => void }) {
  const scan = useScan();
  const e = scan.entries.find((x) => x.asset.kind === h.kind && x.asset.symbol === h.symbol);
  const asset = { symbol: h.symbol, name: h.name, kind: h.kind, yahooSymbol: h.yahooSymbol, binanceSymbol: h.binanceSymbol, isin: h.isin, exchange: h.exchange, currency: h.currency } as ResolvedAsset;
  const s = summarizeHolding(h);
  // Shipmaster 0.2 als TIPP (nichts wird gebucht): Kurs über der blauen Zone und ≥ +20 % über deinem Ø Kaufpreis → Stop-Loss auf die Oberkante
  const lt = e?.longterm;
  const last = e?.ltCandles?.at(-1)?.close;
  const gain = getStopParams().gain;
  const tip = !!lt && last != null && s.avg > 0 && protectDue(last, s.avg, lt.zoneTop, gain);
  const notes: ReasonNote[] = [];
  if (holdTrend(e) === -1) notes.push({ tone: "red", text: "Großer Trend fallend (Wochenchart) – prüfe deine Position." });
  if (tip && lt) notes.push({ tone: "blue", text: `Shipmaster 0.2 – Tipp: Kurs über der Zone und über +${Math.round(gain * 100)} % – Stop-Loss auf die Oberkante ${lt.zoneTop.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${h.currency ?? ""} erwägen.` });
  return (
    <EntryTile
      asset={asset}
      entry={e}
      price={price != null ? price / (eurPerUnit(displayCurrency(asset, asset.currency ?? e?.asset.currency)) ?? 1) : undefined}
      chart
      position={{ qty: s.qty, avg: s.avg, value, open, openPct: open != null && s.cost > 0 ? (open / s.cost) * 100 : null, livePrice: price ?? null, onOpenPosition }}
      onOpen={() => onOpenAsset(asset, e?.best.horizon ?? e?.ltHorizon, notes)}
    />
  );
}

const ORDER_LABEL = { stop: "Stop-Loss", sell: "Verkaufs-Limit", buy: "Kauf-Limit" } as const;
const qtyText = (q: number) => q.toLocaleString("de-DE", { maximumFractionDigits: 4 });

/** Hinweise: Order in der Abwesenheit berührt – nach Zeit sortiert; „Jetzt buchen“ trägt Kauf/Verkauf ein */
function HoldHitBanner() {
  const holdings = useAppData((d) => d.holdings);
  const items = holdings.flatMap((h) => (h.orders ?? []).filter((o) => o.hit).map((o) => ({ h, o }))).sort((a, b) => a.o.hit!.at - b.o.hit!.at);
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map(({ h, o }) => (
        <div key={o.id} className="card border-amber-400/40 bg-amber-500/10 p-3.5">
          <div className="text-[15px] font-semibold text-amber-200">
            {ORDER_LABEL[o.kind]} {o.hit!.near ? "knapp berührt" : "berührt"}: {h.name}
          </div>
          <div className="mt-1 text-[14px] text-stone-200">
            {qtyText(o.qty)} Stück bei {eur(o.priceEur)} – während die App zu war ({o.kind === "sell" ? "höchster" : "tiefster"} Stand {eur(o.hit!.extremeEur)}, {new Date(o.hit!.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}). Bitte bei flatex den echten Preis prüfen.
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {!o.hit!.near && (
              <button
                className="btn-primary"
                onClick={() => {
                  const v = window.prompt(`Echter Preis je Stück in € bei flatex (Vorschlag: ${o.priceEur.toFixed(2).replace(".", ",")})`, o.priceEur.toFixed(2).replace(".", ","));
                  const p = v == null ? 0 : num(v);
                  if (p > 0) actions.fillHoldOrder(h.id, o.id, p, new Date(o.hit!.at).toISOString().slice(0, 10), HOLD_FEE);
                }}
              >
                {o.kind === "buy" ? "Kauf buchen" : "Verkauf buchen"}
              </button>
            )}
            <button className={`btn ${o.hit!.near ? "col-span-2" : ""}`} onClick={() => clearHoldHit(h.id, o.id)}>
              {o.hit!.near ? "Erledigt" : "Nicht ausgelöst – Order bleibt"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Wartende Orders unter der Karte (Antippen → Detail) */
function HoldOrderLine({ h, onClick }: { h: Holding; onClick: () => void }) {
  const o = h.orders ?? [];
  if (!o.length) return null;
  return (
    <button className="num -mt-1 w-full rounded-xl bg-white/5 px-3 py-2 text-left text-[14px] text-stone-300 active:bg-white/10" onClick={onClick}>
      {[...o].sort((a, b) => b.priceEur - a.priceEur).map((x) => `${ORDER_LABEL[x.kind]} ${eur(x.priceEur)} · ${qtyText(x.qty)} Stück`).join("  ·  ")}
    </button>
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
  // Dividenden deiner Aktien: laden, am Auszahlungstag gutgeschrieben (von Hand eingetragene gehen vor)
  const divVer = useDividendBook();
  useEffect(() => {
    loadForPositions([], holdings);
  }, [holdings]);
  const [showDivs, setShowDivs] = useState(false);
  // Erwartete Dividenden pro Jahr (brutto, €) – aus den Firmenzahlen (Yahoo), nur Aktien
  const divGrossYear = useAnnualDividendsGross(holdings.map((h) => ({ id: h.id, asset: h, qty: summarizeHolding(h).qty, priceEur: prices[h.id] })));
  const [form, setForm] = useState<Form>(null);
  const [detail, setDetail] = useState<Holding | null>(null);
  const [orderForm, setOrderForm] = useState<OrderForm>(null);
  const { open: openSheet, sheet: assetSheet } = useAssetSheet();

  const rows = useMemo(
    () =>
      holdings.map((h) => {
        const s = holdingSummary(h);
        const price = prices[h.id];
        const value = price != null ? s.qty * price : null;
        const open = value != null ? value - s.cost : null;
        return { h, s, price, value, open };
      }),
    [holdings, prices, divVer], // eslint-disable-line react-hooks/exhaustive-deps
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
          <div className="label">Gebühren</div>
          <div className="num text-[17px] font-semibold text-stone-50">{eur(fees)}</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className="label">KESt (geschätzt)</div>
          <div className="num text-[17px] font-semibold text-stone-50">{eur(tax)}</div>
        </div>
        <button className="card px-3 py-2.5 text-left active:bg-white/10" onClick={() => setShowDivs(true)}>
          <div className="label">Dividende erhalten (netto)</div>
          <div className="num text-[17px] font-semibold text-up">{eur(netOfTax(dividends))}</div>
        </button>
        <div className="card px-3 py-2.5">
          <div className="label">Dividenden/Jahr (netto)</div>
          <div className="num text-[17px] font-semibold text-stone-50">{eur(netOfTax(divGrossYear))}</div>
        </div>
      </div>

      <HoldHitBanner />
      <button className="btn-primary w-full" onClick={() => setForm({ mode: "buy" })}>
        + Kauf eintragen (Aktie oder ETF)
      </button>

      {held.length === 0 && sold.length === 0 && <div className="card p-5 text-center text-[15px] text-stone-300">Noch keine Käufe. Trag deinen ersten Kauf mit Datum, Preis je Stück und Stückzahl ein.</div>}

      <div className="space-y-3">
        {held.map(({ h, price, value: v, open }) => (
          <div key={h.id} className="space-y-2">
            <HoldCard h={h} price={price} value={v} open={open} onOpenPosition={() => setDetail(h)} onOpenAsset={(a, hz, notes) => openSheet(a, hz, { withEntry: true, tipOnly: true, notes })} />
            <HoldOrderLine h={h} onClick={() => setDetail(h)} />
          </div>
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
      <OrderSheet form={orderForm} price={orderForm ? prices[orderForm.holding.id] : undefined} onClose={() => setOrderForm(null)} />
      <DividendListSheet
        open={showDivs}
        onClose={() => setShowDivs(false)}
        netTotal={netOfTax(dividends)}
        rows={rows.flatMap((r) => [
          ...creditsOfHolding(r.h).map((c) => ({ key: `${r.h.id}a${c.ex}`, name: r.h.name, date: c.date, sub: `Ex ${new Date(c.ex).toLocaleDateString("de-DE")} · ${c.shares.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück`, gross: c.grossEur })),
          ...r.h.txs.filter((t) => t.type === "div").map((t) => ({ key: `${r.h.id}m${t.id}`, name: r.h.name, date: t.date, sub: "von Hand eingetragen", gross: t.price })),
        ])}
      />
      {assetSheet}

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ""}>
        {detail && <HoldingDetail id={detail.id} onOrder={(h, kind) => (setDetail(null), setOrderForm({ holding: h, kind }))} onBuy={(h) => (setDetail(null), setForm({ mode: "buy", holding: h }))} onSell={(h) => (setDetail(null), setForm({ mode: "sell", holding: h }))} onDiv={(h) => (setDetail(null), setForm({ mode: "div", holding: h }))} onClose={() => setDetail(null)} />}
      </Sheet>
    </div>
  );
}

function HoldingDetail({ id, onOrder, onBuy, onSell, onDiv, onClose }: { id: string; onOrder: (h: Holding, kind: HoldOrder["kind"]) => void; onBuy: (h: Holding) => void; onSell: (h: Holding) => void; onDiv: (h: Holding) => void; onClose: () => void }) {
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
        <button className="btn" disabled={s.qty - reservedForSale(h) <= 1e-9} onClick={() => onOrder(h, "stop")}>
          Stop setzen
        </button>
        <button className="btn" onClick={() => onOrder(h, "sell")}>
          Orders (Limit)
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
      {(h.orders?.length ?? 0) > 0 && (
        <>
          <div className="label">Wartende Orders (bei flatex gesetzt)</div>
          <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
            {[...(h.orders ?? [])]
              .sort((a, b) => b.priceEur - a.priceEur)
              .map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="num text-[14px] text-stone-300">
                    <span className={o.kind === "buy" ? "text-up" : o.kind === "stop" ? "text-down" : "text-sky-200"}>{ORDER_LABEL[o.kind]}</span> {eur(o.priceEur)} · {qtyText(o.qty)} Stück
                  </span>
                  <button className="text-[13px] text-stone-500 underline" onClick={() => window.confirm("Diese Order löschen? (Bei flatex bitte auch löschen.)") && actions.removeHoldOrder(h.id, o.id)}>
                    löschen
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
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


/** Stop oder Order eintragen – Preis in Euro, Stückzahl frei wählbar (mehrere Stops je Aktie möglich) */
function OrderSheet({ form, price, onClose }: { form: OrderForm; price?: number; onClose: () => void }) {
  const [kind, setKind] = useState<HoldOrder["kind"]>("stop");
  const [p, setP] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!form) return;
    setKind(form.kind);
    setP("");
    setQ("");
    setErr(null);
  }, [form]);
  if (!form) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const h = form.holding;
  const free = summarizeHolding(h).qty - reservedForSale(h);
  const save = () => {
    const o = { kind, priceEur: num(p), qty: num(q) };
    const e = orderError(h, o, price);
    if (e) return setErr(e);
    actions.addHoldOrder(h.id, o);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`${ORDER_LABEL[kind]}: ${h.name}`}>
      <div className="space-y-3 text-[15px]">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1 text-[14px]">
          {(["stop", "sell", "buy"] as const).map((k) => (
            <button key={k} className={`rounded-lg py-2 ${kind === k ? "bg-white/15 text-stone-50" : "text-stone-400"}`} onClick={() => setKind(k)}>
              {ORDER_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="text-stone-400">
          {kind === "stop" ? "Verkauft bei flatex, wenn der Kurs auf diesen Preis fällt." : kind === "sell" ? "Verkauft bei flatex, wenn der Kurs auf diesen Preis steigt." : "Kauft bei flatex, wenn der Kurs auf diesen Preis fällt."} Hier trägst du sie genauso ein – die App prüft sie live und auch rückwirkend, wenn sie zu war.
          {price ? ` Kurs jetzt: ${eur(price)}.` : ""}
        </p>
        <label className="block text-stone-300">
          Preis je Stück in €
          <input className="input num mt-1" inputMode="decimal" placeholder="z. B. 95,00" value={p} onChange={(e) => setP(e.target.value)} />
        </label>
        <label className="block text-stone-300">
          Stückzahl{kind !== "buy" ? ` (frei: ${qtyText(Math.max(0, free))})` : ""}
          <input className="input num mt-1" inputMode="decimal" placeholder={kind !== "buy" ? `z. B. ${qtyText(Math.max(0, free))}` : "z. B. 10"} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {err && <p className="text-red-300">{err}</p>}
        <button className="btn-primary w-full" onClick={save}>
          {ORDER_LABEL[kind]} speichern
        </button>
      </div>
    </Sheet>
  );
}
