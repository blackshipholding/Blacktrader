"use client";
// Vorschlag von Blacktrader zu einer Langfrist-Position: Order-Zettel für flatex. Gebucht wird erst nach „Bei flatex erledigt“.
import { useState } from "react";
import { acceptProposal, declineProposal, proposalSteps } from "@/lib/client/longterm";
import { tradeCurrency } from "@/lib/client/eur";
import { eurPerUnit } from "@/lib/fx";
import type { Trade } from "@/lib/store/store";

export function ProposalBox({ t, price }: { t: Trade; price?: number }) {
  const p = t.proposal;
  const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
  const [val, setVal] = useState(() => ((price ?? p?.price ?? 0) * fx).toFixed(2).replace(".", ","));
  const [done, setDone] = useState<string | null>(null);
  if (done) return <p className="mt-2 rounded-xl bg-white/5 p-2.5 text-[14px] text-stone-200">{done}</p>;
  if (!p) return null;
  const steps = proposalSteps(t);
  const sells = p.kind !== "stop" && steps.some((s) => s.startsWith("Verkauf"));
  return (
    <div className="mt-2 rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-[14px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="badge-wait">Vorschlag – bei flatex umsetzen</span>
        <span className="text-[12px] text-stone-400">{new Date(p.at).toLocaleDateString("de-DE")}</span>
      </div>
      <p className="mt-1.5 text-amber-100">{p.reason}</p>
      <ol className="num mt-2 space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-stone-100">
            <span className="text-amber-300">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {sells && (
        <label className="mt-2 flex items-center justify-between gap-2 text-stone-300">
          <span>Verkauft zu (€ je Stück)</span>
          <input className="input num w-28 text-right" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
        </label>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          className="btn-primary min-h-[44px]"
          onClick={() => {
            const n = Number(val.replace(/\./g, "").replace(",", "."));
            setDone(acceptProposal(t, sells && n > 0 ? n : undefined) ?? "Gebucht.");
          }}
        >
          Bei flatex erledigt
        </button>
        <button
          className="btn min-h-[44px]"
          onClick={() => {
            declineProposal(t);
            setDone("Abgelehnt – die Position bleibt, wie sie ist.");
          }}
        >
          Ablehnen
        </button>
      </div>
    </div>
  );
}
