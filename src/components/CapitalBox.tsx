"use client";
// Startkapital direkt im Depot eingeben (Shipmaster 0.1, Wunsch des Nutzers). Blacktrader rechnet daraus fest:
// 1. Kauf 10 % vom Kontostand, Nachkauf (nur Blau) höchstens 2 × 2 %. Unter 10.000 € handelt Blacktrader nicht.
import { useEffect, useState } from "react";
import { addStakeFor, SHIPMASTER, stakeFor } from "@/lib/client/account";
import { actions, normalizeCapital } from "@/lib/store/store";
import { netOfTax } from "@/lib/analysis/dividends";
import type { TradeCredit } from "@/lib/client/dividendBook";
import { Sheet } from "./Sheet";

const eurInt = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

export function CapitalBox({ capital, accountValue, dividends }: { capital: number; accountValue: number; dividends?: { net: number; gross: number; items: TradeCredit[] } }) {
  const [showDiv, setShowDiv] = useState(false);
  const eur2 = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const [text, setText] = useState(String(capital));
  useEffect(() => setText(String(capital)), [capital]);
  const typed = Number(text.replace(/\./g, "").replace(",", "."));
  const preview = Number.isFinite(typed) && typed > 0 ? normalizeCapital(typed) : capital;
  const changed = preview !== capital;
  // Vorschau: bei geändertem Startkapital so, als würde neu gestartet; sonst vom aktuellen Kontostand
  const base = changed ? preview : accountValue;
  const save = () => {
    actions.setSettings({ capitalEur: preview });
    setText(String(preview));
  };
  const low = preview < SHIPMASTER.minCapital;
  return (
    <div className="card space-y-3 p-4">
      <label className="block text-[14px] text-stone-300">
        Mein Startkapital
        <div className="mt-1 flex gap-2">
          <input className="input num" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, ""))} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Startkapital in Euro" />
          <button className={`btn ${changed ? "btn-primary" : ""}`} disabled={!changed} onClick={save}>
            Speichern
          </button>
        </div>
      </label>
      {/* Nur die Beträge nach Shipmaster – der Kontostand steht groß darunter (Nutzer 11.11.2026) */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/5 p-2">
          <div className="text-[12px] text-stone-400">1. Kauf (10 %)</div>
          <div className="num text-[16px] text-gold-light">{low ? "–" : eurInt(stakeFor(base))}</div>
        </div>
        <div className="rounded-xl bg-white/5 p-2">
          <div className="text-[12px] text-stone-400">Nachkauf</div>
          <div className="num text-[16px] text-sky-300">{low ? "–" : `${SHIPMASTER.addMax} × ${eurInt(addStakeFor(base))}`}</div>
        </div>
        <button className="rounded-xl bg-white/5 p-2 active:bg-white/10" onClick={() => setShowDiv(true)} aria-label="Dividenden anzeigen">
          <div className="text-[12px] text-stone-400">Dividende</div>
          <div className="num text-[16px] text-up">{eur2(dividends?.net ?? 0)}</div>
        </button>
      </div>
      <Sheet open={showDiv} onClose={() => setShowDiv(false)} title="Dividenden (netto nach 27,5 % KESt)">
        <div className="space-y-2 text-[15px]">
          {(dividends?.items.length ?? 0) === 0 && <p className="text-stone-300">Noch keine Dividende ausgezahlt.</p>}
          {dividends?.items.map((c, i) => (
            <div key={`${c.tradeId}${c.ex}${i}`} className="num flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
              <span>
                <b>{c.name}</b>
                <span className="block text-[13px] text-stone-400">
                  Ex {new Date(c.ex).toLocaleDateString("de-DE")} · Zahltag {new Date(c.pay).toLocaleDateString("de-DE")} · {c.shares.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stück
                </span>
              </span>
              <span className="text-up">{eur2(netOfTax(c.grossEur))}</span>
            </div>
          ))}
          {dividends && dividends.items.length > 0 && (
            <div className="num flex justify-between border-t border-white/10 pt-2 font-semibold">
              <span>Summe netto</span>
              <span className="text-up">{eur2(dividends.net)}</span>
            </div>
          )}
        </div>
      </Sheet>
      {low && (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[14px] text-amber-200">
          Blacktrader handelt erst ab {SHIPMASTER.minCapital.toLocaleString("de-DE")} € Startkapital – darunter fressen die Gebühren den Gewinn.
        </p>
      )}
    </div>
  );
}
