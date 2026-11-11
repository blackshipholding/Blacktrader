"use client";
// Depot: eine Karte je Wert für alle blauen Käufe (Erstkauf + Nachkäufe) – mit Verkaufen, Stop und Orders.
import { useState, type ReactNode } from "react";
import { money } from "@/lib/analysis/persona";
import { tradeCurrency } from "@/lib/client/eur";
import { correctFill, heldShares, sharesExact, trancheRows } from "@/lib/client/longterm";
import { investedOf } from "@/lib/client/account";
import { clearPositionStop, positionSummary, sellPosition, setPositionStop, updateWaitingOrder } from "@/lib/client/position";
import { eurPerUnit } from "@/lib/fx";
import type { Trade } from "@/lib/store/store";
import { ProposalBox } from "./ProposalBox";
import { Sheet } from "./Sheet";

const eur = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const qtyStr = (q: number) => q.toLocaleString("de-DE", { maximumFractionDigits: 4 });
const num = (s: string) => Number(s.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
const inputVal = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const KEST = 0.275;
const FEE = 7.9;

export function PositionCard({ group, price, onOpen, onAction, nachkauf }: { group: Trade[]; price?: number; onOpen: () => void; onAction: (t: Trade) => void; nachkauf?: ReactNode }) {
  const first = group[0];
  const fx = eurPerUnit(tradeCurrency(first)) ?? 1;
  const cur = tradeCurrency(first);
  const priceNow = price ?? first.lastPrice ?? null;
  const priceEur = priceNow != null ? priceNow * fx : null;
  const s = positionSummary(group, priceNow);
  const unit = first.kind === "crypto" ? first.symbol.replace(/-USD$/, "") : "Stück";
  const [showBuys, setShowBuys] = useState(true);
  const [sheet, setSheet] = useState<null | "sell" | "stop" | "orders" | "fix">(null);
  // Jeder Kauf ist bei flatex eine eigene Position (eigenes Depot): erst den Kauf wählen
  const [lots, setLots] = useState<Trade[] | null>(null);
  const [choose, setChoose] = useState<null | "sell" | "stop" | "orders">(null);
  const openFor = (what: "sell" | "stop" | "orders" | "fix", sel: Trade[]) => {
    setLots(sel);
    setSheet(what);
  };
  // gewählte Käufe immer frisch aus der Gruppe (z. B. nach Depot-Änderung)
  const sel = lots ? lots.map((l) => group.find((g) => g.id === l.id)).filter((x): x is Trade => !!x) : null;
  // Namen der Käufe der Reihe nach (Wunsch des Nutzers): Zentraldepot, 2. Kauf, 3. Kauf …
  const lotName = (_t: Trade, k: number) => (k <= 0 ? "Zentraldepot" : `${k + 1}. Kauf`);
  const pending = group.every((t) => t.status === "pending");
  // Einstiege fortlaufend zählen (Wunsch des Nutzers): gekaufte Teile nach Kaufzeit über alle Käufe, danach die
  // wartenden – z. B. Zentraldepot Teil 1, 2. Kauf (= 2. Einstieg), dann Zentraldepot Teil 3 und 4 (wartend)
  const entryNo = new Map<string, number>();
  {
    const all = group.flatMap((t, g) => trancheRows(t).map((x, i) => ({ k: `${t.id}:${i}`, at: x.filledAt ?? Infinity, g, i })));
    all.sort((a, b) => a.at - b.at || a.g - b.g || a.i - b.i).forEach((x, n) => entryNo.set(x.k, n + 1));
  }
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <article className="card edge-core relative p-4" onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-stone-50">
            {first.name} <span className="text-[14px] font-normal text-gold">›</span>
          </div>
          <div className="text-[13px] text-stone-400">{first.symbol} · Langfristig</div>
        </div>
        <div className="text-right">
          <div className={`num text-[19px] font-semibold ${s.pct == null ? "text-amber-300" : s.pct >= 0 ? "text-up" : "text-down"}`}>{s.pct == null ? "–" : `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(2).replace(".", ",")} %`}</div>
          <div className="text-[13px] text-stone-400">Stand gesamt</div>
        </div>
      </div>

      {group.map((t) => t.proposal && <ProposalBox key={`p${t.id}`} t={t} price={price} />)}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="badge-core">Langfristig</span>
        <span className={pending ? "badge-wait" : "badge-muted"}>{pending ? "wartend" : "offen"}</span>
        {group.length > 1 && <span className="badge-muted">{group.length} Käufe</span>}
      </div>

      <div className="num mt-2 grid grid-cols-3 gap-2 text-[14px]">
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <span className="label block">Gekauft</span>
          <span className="font-semibold text-stone-50">
            {qtyStr(group.reduce((a, t) => a + heldShares(t), 0))} {unit}
          </span>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <span className="label block">Investiert</span>
          <span className="font-semibold text-stone-50">{eur(s.invested)}</span>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <span className="label block">Ø Einstieg</span>
          <span className="font-semibold text-stone-50">{s.avgEur != null ? eur(s.avgEur) : "–"}</span>
        </div>
      </div>
      <div className="num mt-2 flex flex-wrap justify-between gap-x-3 text-[14px]">
        <span>Kurs {priceEur != null ? <b>{eur(priceEur)}</b> : "–"}</span>
        {s.profit != null && <span className={s.profit >= 0 ? "text-up" : "text-down"}>{s.profit >= 0 ? "Gewinn" : "Verlust"} {eur(s.profit, true)}</span>}
        <span className="text-stone-400">{s.invalidation && s.invalidation > 0 ? `Ungültig ${money(s.invalidation, cur)}` : group.length === 1 && s.stop > 0 ? `Stop ${money(s.stop, cur)}` : "kein fester Stop"}</span>
      </div>

      {showBuys &&
        group.map((t, k) => {
          const rows = trancheRows(t);
          return (
            <div
              key={t.id}
              role="button"
              className="num mt-2 rounded-xl bg-sky-500/10 p-2.5 text-[13px] text-sky-100 active:bg-sky-500/20"
              onClick={(e) => {
                stop(e);
                openFor("sell", [t]);
              }}
            >
              <div className="mb-1 flex items-center justify-between font-semibold text-sky-300">
                <span>
                  {lotName(t, k)} · {eur(rows.reduce((a, x) => a + x.eur, 0))}
                </span>
                <span className="flex items-center gap-2 font-normal text-stone-400">
                  {new Date(t.openedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  <button
                    className="px-1 text-[16px] leading-none text-stone-300"
                    aria-label="Aktionen für diesen Kauf"
                    onClick={(e) => {
                      stop(e);
                      onAction(t);
                    }}
                  >
                    ⋯
                  </button>
                  <span className="text-stone-400">›</span>
                </span>
              </div>
              {rows.map((x, i) => (
                <div key={i} className="grid grid-cols-[2.75rem_1fr_auto] items-baseline gap-x-1.5 whitespace-nowrap py-0.5 text-[12px] max-[370px]:grid-cols-[2.4rem_1fr_auto] max-[370px]:gap-x-1 max-[370px]:text-[11px]">
                  {/* „Teil“ nur im Zentraldepot (mehrere Teil-Orders); 2., 3. … Kauf ist eine einzige Order */}
                  <span className="text-sky-300">{rows.length > 1 ? `Teil ${entryNo.get(`${t.id}:${i}`) ?? i + 1}` : "Kauf"}</span>
                  <span>
                    {x.filledAt && x.qty > 0 ? eur(x.eur / x.qty) : money(x.price, cur)} · {qtyStr(x.qty)} {unit} · {eur(x.eur)}
                  </span>
                  <span className={x.filledAt ? "text-up" : "text-stone-400"}>{x.filledAt ? "✓" : "wartet"}</span>
                </div>
              ))}
              {(t.partials ?? []).map((p, i) => (
                <p key={`v${i}`} className="text-stone-300">
                  Verkauft {Math.round(p.fraction * 100)} % bei {money(p.price, cur)} ({new Date(p.at).toLocaleDateString("de-DE")})
                </p>
              ))}
              <LotLine t={t} price={priceNow} fx={fx} cur={cur} />
              {t.lastActionText && <p className="mt-1 text-sky-200">Letzte Meldung: {t.lastActionText}</p>}
            </div>
          );
        })}
      {showBuys && group.length > 0 && <p className="mt-1 text-right text-[12px] text-stone-500">Antippen: verkaufen, Stop, korrigieren</p>}
      {s.reserved > 0 && (
        <div className="num mt-2 flex justify-between rounded-xl bg-white/5 px-2.5 py-2 text-[14px] text-stone-300">
          <span>Wartende Order (reserviert)</span>
          <span>{eur(s.reserved)}</span>
        </div>
      )}
      {nachkauf}

      <div className="mt-3 grid grid-cols-3 gap-2" onClick={stop}>
        <button className="btn min-h-[44px] border-gold/50 text-gold-light" disabled={s.shares <= 0} onClick={() => (group.length > 1 ? setChoose("sell") : openFor("sell", group))}>
          Verkaufen
        </button>
        <button className="btn min-h-[44px] border-gold/50 text-gold-light" disabled={s.shares <= 0} onClick={() => (group.length > 1 ? setChoose("stop") : openFor("stop", group))}>
          Stop
        </button>
        <button className="btn min-h-[44px] border-gold/50 text-gold-light" disabled={s.reserved <= 0} onClick={() => (group.length > 1 ? setChoose("orders") : openFor("orders", group))}>
          Orders
        </button>
      </div>
      <button
        className="mt-2 flex min-h-[40px] w-full items-center justify-between border-t border-white/10 pt-2 text-[14px] text-stone-400"
        onClick={(e) => {
          stop(e);
          setShowBuys(!showBuys);
        }}
      >
        <span>{showBuys ? "Käufe ausblenden" : "Käufe anzeigen"}</span>
        <span>{showBuys ? "▲" : "▼"}</span>
      </button>

      <div onClick={stop}>
        <Sheet open={choose != null} onClose={() => setChoose(null)} title={choose === "sell" ? "Welchen Kauf verkaufen?" : choose === "stop" ? "Stop für welchen Kauf?" : "Orders von welchem Kauf?"}>
          <div className="space-y-2 text-[15px]">
            <p className="text-[14px] text-stone-400">Jeder Kauf ist bei flatex eine eigene Position.</p>
            {group.map((t, k) => {
              const ls = positionSummary([t], priceNow);
              const has = choose === "orders" ? ls.reserved > 0 : ls.shares > 0;
              return (
                <button key={t.id} disabled={!has} className="flex w-full items-center justify-between rounded-xl bg-white/5 p-3 text-left disabled:opacity-40" onClick={() => (setChoose(null), openFor(choose!, [t]))}>
                  <span>
                    <b>{lotName(t, k)}</b>
                      <span className="num block text-[13px] text-stone-400">
                      {choose === "orders" ? `wartend ${eur(ls.reserved)}` : `${qtyStr(heldShares(t))} ${unit} · Einstieg ${ls.avgEur != null ? eur(ls.avgEur) : "–"}`}
                    </span>
                  </span>
                  {ls.pct != null && choose !== "orders" && <span className={`num ${ls.pct >= 0 ? "text-up" : "text-down"}`}>{`${ls.pct >= 0 ? "+" : ""}${ls.pct.toFixed(1).replace(".", ",")} %`}</span>}
                </button>
              );
            })}
            <button className="flex w-full items-center justify-between rounded-xl bg-white/5 p-3 text-left" onClick={() => (setChoose(null), openFor(choose!, group))}>
              <span>
                <b>Alle Käufe</b>
                <span className="block text-[13px] text-stone-400">{choose === "sell" ? `${group.length} Verkäufe = ${group.length} × 7,90 € Gebühr` : choose === "stop" ? `${group.length} Stops – je Depot einer` : "alle wartenden Orders"}</span>
              </span>
            </button>
          </div>
        </Sheet>
        {sel && (
          <>
            <Sheet open={sheet === "sell"} onClose={() => setSheet(null)} title={<LotTitle lots={sel!} group={group} name={first.name} lotName={lotName} />}>
              {sheet === "sell" && <LotTabs lots={sel!} active="sell" onTab={setSheet} />}
              {sheet === "sell" && <SellForm group={sel!} priceEur={priceEur} avgEur={positionSummary(sel!, priceNow).avgEur} shares={positionSummary(sel!, priceNow).shares} reserved={positionSummary(sel!, priceNow).reserved} unit={unit} crypto={first.kind === "crypto"} onDone={() => setSheet(null)} />}
            </Sheet>
            <Sheet open={sheet === "stop"} onClose={() => setSheet(null)} title={<LotTitle lots={sel!} group={group} name={first.name} lotName={lotName} />}>
              {sheet === "stop" && <LotTabs lots={sel!} active="stop" onTab={setSheet} />}
              {sheet === "stop" && <StopForm group={sel!} priceEur={priceEur} current={Math.max(0, ...sel!.map((t) => t.stop || 0)) > 0 ? Math.max(0, ...sel!.map((t) => t.stop || 0)) * fx : null} invalidationEur={s.invalidation && s.invalidation > 0 ? s.invalidation * fx : null} onDone={() => setSheet(null)} />}
            </Sheet>
            <Sheet open={sheet === "orders"} onClose={() => setSheet(null)} title={<LotTitle lots={sel!} group={group} name={first.name} lotName={lotName} />}>
              {sheet === "orders" && <LotTabs lots={sel!} active="orders" onTab={setSheet} />}
              {sheet === "orders" && <OrdersForm group={sel!} unit={unit} onDone={() => setSheet(null)} />}
            </Sheet>
            <Sheet open={sheet === "fix"} onClose={() => setSheet(null)} title={<LotTitle lots={sel!} group={group} name={first.name} lotName={lotName} />}>
              {sheet === "fix" && <LotTabs lots={sel!} active="fix" onTab={setSheet} />}
              {sheet === "fix" && sel!.length === 1 && <FixForm t={sel![0]} unit={unit} />}
            </Sheet>
          </>
        )}
      </div>
    </article>
  );
}

/** Stand eines einzelnen Kaufs (eigener Einstieg) und sein Stop */
function LotLine({ t, price, fx, cur }: { t: Trade; price: number | null; fx: number; cur: string }) {
  const sh = sharesExact(t);
  if (sh <= 0) return null;
  const inv = investedOf(t) * (t.remaining ?? 1);
  const val = price != null ? sh * price * fx : null;
  const p = val != null ? val - inv : null;
  return (
    <p className={`mt-1 ${p == null ? "text-stone-400" : p >= 0 ? "text-emerald-300" : "text-red-300"}`}>
      {p != null ? `${p >= 0 ? "Gewinn" : "Verlust"} ${eur(p, true)} (${p >= 0 ? "+" : ""}${((p / inv) * 100).toFixed(1).replace(".", ",")} %)` : ""}
      {t.stop > 0 ? ` · Stop ${money(t.stop, cur)}` : ""}
    </p>
  );
}

function LotTitle({ lots, group, name, lotName }: { lots: Trade[]; group: Trade[]; name: string; lotName: (t: Trade, k: number) => string }) {
  if (lots.length !== 1) return <span>{name} · alle Käufe</span>;
  const t = lots[0];
  return (
    <span>
      {name} · {lotName(t, group.findIndex((x) => x.id === t.id))}
    </span>
  );
}

/** Reiter Verkaufen / Stop / Orders; bei einem Kauf auch das Depot (nachträglich zuordnen) */
type Tab = "sell" | "stop" | "orders" | "fix";
function LotTabs({ lots, active, onTab }: { lots: Trade[]; active: Tab; onTab: (x: Tab) => void }) {
  const t = lots.length === 1 ? lots[0] : null;
  return (
    <div className="mb-3 space-y-3">
      {t && (
        <p className="num text-[14px] text-stone-400">
          {qtyStr(heldShares(t))} {t.kind === "crypto" ? t.symbol.replace(/-USD$/, "") : "Stück"} · Einstieg {positionSummary([t]).avgEur != null ? eur(positionSummary([t]).avgEur!) : "–"} · gekauft {new Date(t.openedAt).toLocaleDateString("de-DE")}
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["sell", "Verkaufen"],
            ["stop", "Stop"],
            ["orders", "Orders"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`min-h-[40px] rounded-lg text-[14px] ${active === k ? "bg-gold font-semibold text-stone-950" : "bg-white/5 text-stone-300"}`} onClick={() => onTab(k)}>
            {l}
          </button>
        ))}
        {t && (
          <button className={`col-span-3 min-h-[40px] rounded-lg text-[14px] ${active === "fix" ? "bg-gold font-semibold text-stone-950" : "bg-white/5 text-stone-300"}`} onClick={() => onTab("fix")}>
            Kauf korrigieren
          </button>
        )}
      </div>
    </div>
  );
}

/** Kauf so eintragen, wie flatex ihn ausgeführt hat (der alte Stand wird aufgehoben) */
function FixForm({ t, unit }: { t: Trade; unit: string }) {
  const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
  const rows = trancheRows(t);
  const filled = rows.map((x, i) => ({ x, i })).filter((r) => r.x.filledAt);
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">Wie bei flatex ausgeführt eintragen. Der bisherige Stand wird gespeichert und bleibt nachvollziehbar.</p>
      {filled.map(({ x, i }) => (
        <FixRow key={i} t={t} index={i} priceEur={x.price * fx} qty={x.qty} unit={unit} />
      ))}
      {!filled.length && <p className="text-stone-400">Noch kein Teil gekauft – wartende Orders änderst du unter „Orders“.</p>}
      {!!t.corrections?.length && (
        <p className="text-[12px] text-stone-500">
          Korrigiert am {new Date(t.corrections[t.corrections.length - 1].at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · vorher Einstieg {money(t.corrections[t.corrections.length - 1].entry, tradeCurrency(t))}
        </p>
      )}
    </div>
  );
}

function FixRow({ t, index, priceEur, qty, unit }: { t: Trade; index: number; priceEur: number; qty: number; unit: string }) {
  const [p, setP] = useState(inputVal(priceEur));
  const [q, setQ] = useState(inputVal(qty, t.kind === "crypto" ? 4 : 0));
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-3">
      <div className="text-[14px] text-sky-300">{(t.tranches?.length ?? 0) > 1 ? `Teil ${index + 1} · ` : ""}gekauft</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[13px] text-stone-400">
          Kaufpreis (€ je Stück)
          <input className="input num mt-1 w-full text-right" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
        </label>
        <label className="text-[13px] text-stone-400">
          {unit}
          <input className="input num mt-1 w-full text-right" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="num text-[13px] text-stone-400">Betrag {eur(num(p) * num(q) || 0)}</div>
      <button className="btn-primary min-h-[44px] w-full" onClick={() => setMsg(correctFill(t, index, num(p), num(q)) ?? "Gespeichert.")}>
        Speichern
      </button>
      {msg && <p className="text-[13px] text-stone-300">{msg}</p>}
    </div>
  );
}

function SellForm({ group, priceEur, avgEur, shares, reserved, unit, crypto, onDone }: { group: Trade[]; priceEur: number | null; avgEur: number | null; shares: number; reserved: number; unit: string; crypto: boolean; onDone: () => void }) {
  const round = (q: number) => (crypto ? Math.floor(q * 1e4 + 1e-6) / 1e4 : Math.round(q));
  const [mode, setMode] = useState<"all" | "half" | "custom">("all");
  const [qty, setQty] = useState(inputVal(round(shares), crypto ? 4 : 0));
  const [px, setPx] = useState(priceEur != null ? inputVal(priceEur) : "");
  const [drop, setDrop] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const q = mode === "all" ? shares : num(qty);
  const p = num(px);
  const gain = avgEur != null && q > 0 && p > 0 ? q * (p - avgEur) : null;
  const kest = gain != null ? Math.max(0, gain) * KEST : null;
  const lotsSold = Math.max(1, group.filter((t) => sharesExact(t) > 0).length);
  const pick = (m: "all" | "half" | "custom") => {
    setMode(m);
    if (m === "all") setQty(inputVal(round(shares), crypto ? 4 : 0));
    if (m === "half") setQty(inputVal(round(shares / 2), crypto ? 4 : 0));
    setDrop(m === "all");
  };
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">
        Du hältst {qtyStr(round(shares))} {unit}
        {avgEur != null ? ` · Ø Einstieg ${eur(avgEur)}` : ""}
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["all", "Alles"],
            ["half", "Hälfte"],
            ["custom", "Stück wählen"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`min-h-[40px] rounded-lg text-[14px] ${mode === k ? "bg-gold font-semibold text-stone-950" : "bg-white/5 text-stone-300"}`} onClick={() => pick(k)}>
            {l}
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2">
        <span>Stück</span>
        <input className="input num w-32 text-right" inputMode="decimal" value={qty} disabled={mode === "all"} onChange={(e) => (setQty(e.target.value), setMode("custom"))} />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Verkauft zu (€ je Stück, von flatex)</span>
        <input className="input num w-32 text-right" inputMode="decimal" value={px} onChange={(e) => setPx(e.target.value)} />
      </label>
      {reserved > 0 && (
        <label className="flex items-center justify-between gap-2">
          <span>Wartende Kauf-Orders löschen ({eur(reserved)})</span>
          <input type="checkbox" className="h-6 w-6 accent-[#C9A24A]" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
        </label>
      )}
      {gain != null && (
        <div className="num space-y-0.5 rounded-xl bg-emerald-500/10 p-3 text-[14px] text-emerald-50">
          <div className="flex justify-between">
            <span>Erlös</span>
            <span>{eur(q * p)}</span>
          </div>
          <div className="flex justify-between">
            <span>Gewinn (zum {group.length > 1 ? "Ø " : ""}Einstieg)</span>
            <span>{eur(gain, true)}</span>
          </div>
          <div className="flex justify-between">
            <span>Gebühr{lotsSold > 1 ? ` (${lotsSold} Verkäufe)` : ""}</span>
            <span>{eur(-FEE * lotsSold)}</span>
          </div>
          <div className="flex justify-between">
            <span>KESt 27,5 %</span>
            <span>{eur(-(kest ?? 0))}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Netto</span>
            <span>{eur(gain - FEE * lotsSold - (kest ?? 0), true)}</span>
          </div>
          <p className="pt-1 text-[12px] text-stone-400">KESt geschätzt – Verluste im selben Jahr werden im Depot-Konto verrechnet.</p>
        </div>
      )}
      {msg && <p className="text-amber-300">{msg}</p>}
      <button
        className="btn-primary min-h-[48px] w-full"
        onClick={() => {
          // Jeder Kauf ist eine eigene flatex-Position: getrennt verkaufen (eigene Order und Gebühr)
          const total = group.reduce((a, t) => a + sharesExact(t), 0);
          const f = total > 0 ? Math.min(1, q / total) : 0;
          let r = "";
          for (const t of group) {
            const sh = sharesExact(t);
            r = sh > 0 || drop ? sellPosition([t], sh > 0 ? (f > 0.9999 ? sh : sh * f) : 0, p, drop) : r;
            if (sh > 0 && !/verkauft|Verkauft/.test(r)) break;
          }
          if (/verkauft|Verkauft|gelöscht/.test(r)) onDone();
          else setMsg(r);
        }}
      >
        Bei flatex verkauft – buchen
      </button>
    </div>
  );
}

function StopForm({ group, priceEur, current, invalidationEur, onDone }: { group: Trade[]; priceEur: number | null; current: number | null; invalidationEur: number | null; onDone: () => void }) {
  const [v, setV] = useState(current != null ? inputVal(current) : "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">{group.length > 1 ? `Bei flatex in jedem Depot ein Stop-Loss (${group.length} Stops).` : "Bei flatex ein Stop-Loss für diesen Kauf."}</p>
      <label className="flex items-center justify-between gap-2">
        <span>Stop-Kurs (€)</span>
        <input className="input num w-32 text-right" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <p className="text-[13px] text-stone-400">
        Muss mindestens 0,5 % unter dem Kurs liegen{priceEur != null ? ` (jetzt ${eur(priceEur)})` : ""}.{invalidationEur != null ? ` Blacktraders Ungültig-Grenze: ${eur(invalidationEur)}.` : ""}
      </p>
      {msg && <p className="text-amber-300">{msg}</p>}
      <button
        className="btn-primary min-h-[48px] w-full"
        onClick={() => {
          // je Kauf (eigenes Depot) ein eigener Stop
          let r: string | null = null;
          for (const t of group) if (!r && sharesExact(t) > 0) r = setPositionStop([t], num(v), priceEur);
          if (r) setMsg(r);
          else onDone();
        }}
      >
        Bei flatex gesetzt – speichern
      </button>
      {current != null && (
        <button
          className="btn min-h-[44px] w-full"
          onClick={() => {
            clearPositionStop(group);
            onDone();
          }}
        >
          Stop bei flatex gelöscht
        </button>
      )}
    </div>
  );
}

function OrdersForm({ group, unit, onDone }: { group: Trade[]; unit: string; onDone: () => void }) {
  const rows = group.flatMap((t) => {
    const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
    return trancheRows(t)
      .map((x, i) => ({ t, i, x, fx }))
      .filter((r) => !r.x.filledAt);
  });
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">Preis oder Stück ändern oder löschen – das reservierte Geld passt sich an. Erst bei flatex ändern, dann hier speichern.</p>
      {rows.map((r) => (
        <OrderRow key={`${r.t.id}:${r.i}`} t={r.t} index={r.i} priceEur={r.x.price * r.fx} qty={r.x.qty} unit={unit} onSaved={() => rows.length <= 1 && onDone()} />
      ))}
      {!rows.length && <p className="text-stone-400">Keine wartenden Orders.</p>}
    </div>
  );
}

function OrderRow({ t, index, priceEur, qty, unit, onSaved }: { t: Trade; index: number; priceEur: number; qty: number; unit: string; onSaved: () => void }) {
  const [p, setP] = useState(inputVal(priceEur));
  const [q, setQ] = useState(inputVal(qty, t.kind === "crypto" ? 4 : 0));
  const [msg, setMsg] = useState<string | null>(null);
  const save = (del = false) => {
    const r = updateWaitingOrder(t, index, num(p), del ? 0 : num(q));
    setMsg(r ?? (del ? "Gelöscht." : "Gespeichert."));
    if (!r) onSaved();
  };
  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-3">
      <div className="text-[14px] text-sky-300">
        {t.nachkauf ? "Nachkauf" : "Zentraldepot"}{(t.tranches?.length ?? 0) > 1 ? ` · Teil ${index + 1}` : ""}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[13px] text-stone-400">
          Limit (€)
          <input className="input num mt-1 w-full text-right" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
        </label>
        <label className="text-[13px] text-stone-400">
          {unit}
          <input className="input num mt-1 w-full text-right" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="num text-[13px] text-stone-400">= {eur(num(p) * num(q) || 0)} reserviert</div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary min-h-[44px]" onClick={() => save(false)}>
          Bei flatex geändert
        </button>
        <button className="btn min-h-[44px]" onClick={() => save(true)}>
          Bei flatex gelöscht
        </button>
      </div>
      {msg && <p className="text-[13px] text-stone-300">{msg}</p>}
    </div>
  );
}
