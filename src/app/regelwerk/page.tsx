"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { liveCheck } from "@/lib/client/liveCheck";
import { refreshTrainerParams, useTrainerCells } from "@/lib/client/trainerParams";
import { cellVersions, initVersionsSeen, markVersionsSeen, newVersions, rollbackCandidates, rollbackToPrevious } from "@/lib/client/versionNotice";
import { useAppData } from "@/lib/store/store";
import { RULES_A, RULES_B, RULES_C, RULES_OPPONENTS, type Rule } from "@/lib/trainer/rulebook";
import type { CellKey } from "@/lib/trainer/universe";
import { HORIZON_LABEL, KIND_LABEL, type AssetKind, type Horizon } from "@/lib/types";

const cellLabel = (c: CellKey) => {
  const [k, h] = c.split(":") as [AssetKind, Horizon];
  return `${KIND_LABEL[k]} · ${HORIZON_LABEL[h]}`;
};
const date = (s: string) => new Date(s).toLocaleDateString("de-DE");

function Section({ title, intro, rules }: { title: string; intro: string; rules: Rule[] }) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="text-[17px] text-gold-light">{title}</h2>
      <p className="text-[14px] text-stone-400">{intro}</p>
      <ul className="space-y-2">
        {rules.map((r) => (
          <li key={r.id} className="flex gap-3">
            <span className="num w-8 shrink-0 pt-0.5 text-[14px] font-semibold text-gold">{r.id}</span>
            <span className="min-w-0">
              <span className="block text-[15px] text-stone-100">{r.title}</span>
              <span className="block text-[14px] text-stone-400">{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function RegelwerkPage() {
  useTrainerCells();
  const log = useAppData((d) => d.chanceLog);
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void refreshTrainerParams(true).then(() => {
      initVersionsSeen();
      setTick((t) => t + 1);
    });
  }, []);
  const versions = cellVersions();
  const fresh = newVersions();
  const chk = liveCheck(log);
  const liveStart = log.length ? Math.min(...log.map((x) => x.from)) : null;
  const back = chk.warn ? rollbackCandidates(liveStart) : [];

  const rollback = async (cell: CellKey) => {
    if (!confirm(`${cellLabel(cell)} auf die vorige Version zurücksetzen?`)) return;
    const r = await rollbackToPrevious(cell);
    setMsg(r.ok ? `${cellLabel(cell)}: ${r.note}` : `${cellLabel(cell)}: ${r.note}${/Zugangscode/.test(r.note) ? " – Zugangscode im Trainer eingeben." : ""}`);
    await refreshTrainerParams(true);
    setTick((t) => t + 1);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] text-gold">Regelwerk</h1>
      <p className="text-[15px] text-stone-300">Wann Blacktrader in seiner Entscheidung etwas ändern darf – und was nie.</p>

      {fresh.length > 0 && (
        <section className="card space-y-2 border border-sky-400/40 p-4">
          <h2 className="text-[16px] text-sky-200">Neue Versionen</h2>
          {fresh.map((v) => (
            <p key={v.cell} className="text-[14px] text-stone-200">
              {cellLabel(v.cell)}: Version {v.version} (gespeichert am {date(v.updatedAt)})
            </p>
          ))}
          <button className="btn min-h-[44px] w-full" onClick={() => (markVersionsSeen(), setTick((t) => t + 1))}>
            Gesehen
          </button>
        </section>
      )}

      {chk.warn && (
        <section className="card edge-short space-y-2 p-4">
          <h2 className="text-[16px] text-red-200">Vorschlag: Rückweg (C3)</h2>
          <p className="text-[14px] text-stone-300">Live schlechter als im Test. {back.length ? "Diese Bereiche wurden seit Beginn der Live-Bilanz neu gelernt – zurücksetzen?" : "Seit Beginn der Live-Bilanz wurde nichts neu gelernt – es gibt keinen Stand zum Zurücknehmen. Regeln prüfen."}</p>
          {back.map((v) => (
            <button key={v.cell} className="btn btn-danger min-h-[44px] w-full" onClick={() => rollback(v.cell)}>
              {cellLabel(v.cell)}: Version {v.version} zurücknehmen
            </button>
          ))}
        </section>
      )}
      {msg && <p className="text-[14px] text-amber-300">{msg}</p>}

      <Section title="A · Ändert Blacktrader nie selbst" intro="Nur du kannst diese Regeln ändern – erst nach ausgiebigem Test und deiner Zustimmung." rules={RULES_A} />
      <Section title="B · Bedingungen für einen neuen Stand" intro="Beim Lernen wird ein neuer Stand nur gespeichert, wenn ALLE Bedingungen erfüllt sind." rules={RULES_B} />
      <Section title="C · Wie geändert wird" intro="Auch ein besserer Stand kommt nur in kleinen, nachvollziehbaren Schritten." rules={RULES_C} />
      <Section title="Gegner im Turnier" intro="Damit Blacktrader immer eine echte Herausforderung hat – fair für alle." rules={RULES_OPPONENTS} />

      <section className="card space-y-2 p-4">
        <h2 className="text-[17px] text-gold-light">Versionen je Bereich</h2>
        {versions.length ? (
          versions.map((v) => (
            <div key={v.cell} className="flex items-center justify-between gap-2 text-[14px]">
              <span className="text-stone-200">{cellLabel(v.cell)}</span>
              <span className="num text-stone-400">
                Version {v.version} · {date(v.updatedAt)}
              </span>
            </div>
          ))
        ) : (
          <p className="text-[14px] text-stone-400">Noch keine gelernten Versionen – alle Bereiche nutzen die Standardwerte.</p>
        )}
        <Link href="/trainer" className="block pt-1 text-[14px] text-gold underline-offset-4 active:underline">
          Zum Trainer
        </Link>
      </section>
    </div>
  );
}
