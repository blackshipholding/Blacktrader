"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { clampWeights } from "@/lib/analysis/params";
import { learnedWeightCells, refreshTrainerParams, useTrainerVersion } from "@/lib/client/trainerParams";
import { disablePush, enablePush, pushEnabled, testPush } from "@/lib/client/push";
import { playTone, requestNotificationPermission } from "@/lib/client/alerts";
import { DEFAULT_WEIGHTS } from "@/lib/analysis/score";
import { actions, DEFAULT_SETTINGS, useAppData } from "@/lib/store/store";
import { HORIZON_INTERVALS, HORIZON_LABEL, KIND_LABEL, type AssetKind, type Horizon, type Interval } from "@/lib/types";

const cellName = (c: string) => {
  const [k, h] = c.split(":") as [AssetKind, Horizon];
  return `${KIND_LABEL[k]} · ${HORIZON_LABEL[h]}`;
};

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="panel space-y-3 p-4">
      <div>
        <h2 className="panel-title">{title}</h2>
        {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function PushSettings() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setOn(pushEnabled()), []);
  const toggle = async () => {
    setBusy(true);
    setNote(null);
    if (on) {
      await disablePush();
      setOn(false);
      setNote("Push-Nachrichten ausgeschaltet.");
    } else {
      const r = await enablePush();
      setOn(r.ok);
      setNote(r.note);
    }
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button className={`btn flex-1 ${on ? "btn-primary" : ""}`} disabled={busy} onClick={toggle}>
          {busy ? "…" : on ? "Eingeschaltet – ausschalten" : "Push-Nachrichten einschalten"}
        </button>
        {on && (
          <button className="btn" disabled={busy} onClick={async () => setNote(await testPush())}>
            Test
          </button>
        )}
      </div>
      {note && <p className="text-[14px] text-stone-200">{note}</p>}
      <p className="text-[13px] text-stone-500">
        iPhone: App zuerst über „Zum Home-Bildschirm“ hinzufügen und von dort öffnen. Der Server prüft einmal täglich; öfter mit einem kostenlosen Zeitplan-Dienst (siehe Anleitung).
      </p>
    </div>
  );
}

function KeyInput({ label, value, onChange, href, placeholder }: { label: string; value: string; onChange: (v: string) => void; href?: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-xs text-stone-400">
      <span className="flex justify-between">
        {label}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-gold/80 hover:underline">
            kostenlosen Key holen
          </a>
        )}
      </span>
      <div className="mt-1 flex gap-2">
        <input className="input" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder ?? "optional"} autoComplete="off" spellCheck={false} />
        <button type="button" className="btn px-2 text-xs" onClick={() => setShow(!show)}>
          {show ? "verbergen" : "zeigen"}
        </button>
      </div>
    </label>
  );
}

export default function SettingsPage() {
  const s = useAppData((d) => d.settings);
  const counts = useAppData((d) => ({ w: d.watchlist.length, t: d.trades.length }));
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [withKeys, setWithKeys] = useState(false);
  const trainerV = useTrainerVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const learned = useMemo(() => learnedWeightCells(), [trainerV]);
  useEffect(() => void refreshTrainerParams(), []);

  const exportFile = () => {
    const blob = new Blob([actions.exportJson(withKeys)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `black-ship-trading-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (f: File) => {
    try {
      actions.importJson(await f.text());
      setMsg("Import erfolgreich.");
    } catch (e) {
      setMsg(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] text-gold">Einstellungen</h1>

      <Section title="Ansicht" hint="Einfache Ansicht: kurze, verständliche Sätze ohne Fachbegriffe. Expertenansicht: zusätzlich Wellenzählung, Fibonacci-Linien, Volumen-/RSI-Details.">
        <label className="flex items-center gap-2 text-sm text-stone-200">
          <input type="checkbox" className="accent-[#C9A24A]" checked={s.expertMode} onChange={(e) => actions.setSettings({ expertMode: e.target.checked })} />
          Expertenansicht anzeigen
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-[15px] text-stone-200">
          <input type="checkbox" className="h-5 w-5 accent-[#C9A24A]" checked={s.haptics} onChange={(e) => actions.setSettings({ haptics: e.target.checked })} />
          Vibration bei Alarm und Trade-Übernahme (Android)
        </label>
      </Section>

      <Section title="Gewichtung des Gesamtscores" hint="Gesamtscore = Elliott × w₁ + Fundamental/News × w₂ + Volumen/RSI × w₃. Feste Grenzen: Elliott-Wellen mindestens 60 %, die anderen mindestens 10 %, zusammen immer 100 %.">
        <div className="flex gap-2">
          {(["trainer", "manual"] as const).map((m) => (
            <button key={m} className={`btn flex-1 ${s.weightsMode === m ? "btn-primary" : ""}`} onClick={() => actions.setSettings({ weightsMode: m })}>
              {m === "trainer" ? "Automatisch (Trainer)" : "Manuell"}
            </button>
          ))}
        </div>
        {(["elliott", "fundamental", "volume"] as const).map((k) => (
          <label key={k} className={`block text-sm ${s.weightsMode === "trainer" ? "opacity-60" : ""}`}>
            <div className="flex justify-between text-stone-300">
              <span>
                {k === "elliott" ? "Elliott-Wellen" : k === "fundamental" ? "Fundamental & News" : "Volumen & RSI"} <span className="text-stone-500">(min. {k === "elliott" ? 60 : 10} %)</span>
              </span>
              <span className="num text-gold-light">{Math.round(s.weights[k])} %</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={s.weightsMode === "trainer"}
              value={s.weights[k]}
              onChange={(e) => actions.setSettings({ weights: clampWeights({ ...s.weights, [k]: Number(e.target.value) }, k) })}
              className="w-full accent-[#C9A24A]"
            />
          </label>
        ))}
        <div className="rounded-xl bg-white/5 p-3 text-[14px] text-stone-300">
          <b className="text-stone-100">Zuletzt vom Trainer gelernt:</b>{" "}
          {learned.length === 0 ? (
            <span>überall 60 / 20 / 20 (noch keine Änderung übernommen)</span>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {learned.map((l) => (
                <li key={l.cell} className="num">
                  {cellName(l.cell)}: {l.weights.elliott} / {l.weights.fundamental} / {l.weights.volume}
                </li>
              ))}
              <li className="text-stone-500">alle anderen: 60 / 20 / 20</li>
            </ul>
          )}
        </div>
        <button className="btn text-xs" onClick={() => actions.setSettings({ weights: DEFAULT_WEIGHTS })}>
          Regler auf 60 / 20 / 20 zurücksetzen
        </button>
      </Section>

      <Section title="Zeithorizonte & Kerzen" hint="Fest wie im Turnier getestet: mittelfristig Tageskerzen, langfristig Wochenkerzen (Rohstoffe kurzfristig: Stundenkerzen). Andere Kerzengrößen sind nicht geprüft und daher abgeschaltet.">
        <p className="text-sm text-stone-300">Mittelfristig: 1d · Langfristig: 1w · Kurzfristig (nur Rohstoffe): 1h</p>
      </Section>

      <Section title="Echtzeit & Alarme">
        <label className="block text-sm">
          <div className="flex justify-between text-stone-300">
            <span>Polling-Intervall Aktien</span>
            <span className="num text-gold-light">{s.pollSeconds} s</span>
          </div>
          <input type="range" min={15} max={60} step={5} value={s.pollSeconds} onChange={(e) => actions.setSettings({ pollSeconds: Number(e.target.value) })} className="w-full accent-[#C9A24A]" />
        </label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-[#C9A24A]"
              checked={s.notifications}
              onChange={async (e) => {
                if (e.target.checked) {
                  const p = await requestNotificationPermission();
                  if (p !== "granted") {
                    setMsg(p === "unsupported" ? "Dieser Browser unterstützt keine Benachrichtigungen." : "Benachrichtigungen wurden im Browser abgelehnt.");
                    return;
                  }
                }
                actions.setSettings({ notifications: e.target.checked });
              }}
            />
            Benachrichtigungen bei neuen Signalen, Zielen und Stops
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-[#C9A24A]" checked={s.sound} onChange={(e) => actions.setSettings({ sound: e.target.checked })} />
            Signalton
          </label>
          <button className="btn text-xs" onClick={() => playTone("buy")}>
            Ton testen
          </button>
        </div>
        <label className="block text-sm text-stone-300">
          Trades automatisch schließen bei
          <select className="input mt-1 w-auto" value={s.closeAtTarget} onChange={(e) => actions.setSettings({ closeAtTarget: e.target.value as "first" | "last" })}>
            <option value="first">erstem Kursziel</option>
            <option value="last">letztem Kursziel</option>
          </select>
        </label>
        <p className="text-xs text-stone-500">Alarme und Trade-Verfolgung laufen, solange die App in einem Tab geöffnet ist.</p>
      </Section>

      <Section title="Push-Nachrichten" hint="Nachrichten auch bei geschlossener App: Einstieg erreicht, Stop/Ziel, Teil gekauft, geänderte Wellenzählung (Teilausstieg, Stop, Ausstieg) und neue langfristige Einstiegsbereiche deiner Watchlist.">
        <PushSettings />
      </Section>

      <Section title="Optionale API-Keys" hint="Alles funktioniert ohne Keys. Keys werden ausschließlich lokal in deinem Browser gespeichert und nur an den jeweiligen Anbieter durchgereicht.">
        <div className="grid gap-3 sm:grid-cols-2">
          <KeyInput label="Finnhub (Fundamentaldaten, Company-News, US)" value={s.keys.finnhub} onChange={(v) => actions.setKeys({ finnhub: v })} href="https://finnhub.io/register" />
          <KeyInput label="Alpha Vantage (Fundamentaldaten, US)" value={s.keys.alphavantage} onChange={(v) => actions.setKeys({ alphavantage: v })} href="https://www.alphavantage.co/support/#api-key" />
          <KeyInput label="OpenFIGI (höheres Limit für ISIN-Auflösung)" value={s.keys.openfigi} onChange={(v) => actions.setKeys({ openfigi: v })} href="https://www.openfigi.com/api" />
        </div>
        <div className="grid gap-3 border-t border-gold/10 pt-3 sm:grid-cols-3">
          <label className="text-xs text-stone-400">
            LLM-Anbieter (optional)
            <select className="input mt-1" value={s.keys.llmProvider} onChange={(e) => actions.setKeys({ llmProvider: e.target.value as "anthropic" | "openai" })}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <KeyInput label="LLM-API-Key" value={s.keys.llm} onChange={(v) => actions.setKeys({ llm: v })} />
          <label className="text-xs text-stone-400">
            Modell (leer = Standard)
            <input className="input mt-1" value={s.keys.llmModel} onChange={(e) => actions.setKeys({ llmModel: e.target.value.trim() })} placeholder={s.keys.llmProvider === "anthropic" ? "claude-sonnet-5-5" : "gpt-4o-mini"} />
          </label>
        </div>
        <p className="text-xs text-stone-500">Mit LLM-Key erscheint auf der Analyse-Seite „Mit LLM ausformulieren“. Ohne Key werden die Texte regelbasiert erzeugt.</p>
      </Section>

      <Section title="Daten: Export / Import" hint={`Lokal gespeichert: ${counts.w} Werte in der Watchlist, ${counts.t} Trades.`}>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={exportFile}>
            Als JSON exportieren
          </button>
          <label className="flex items-center gap-1 text-xs text-stone-400">
            <input type="checkbox" className="accent-[#C9A24A]" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} />
            inkl. API-Keys
          </label>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            JSON importieren
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button
            className="btn-danger"
            onClick={() => {
              if (window.confirm("Alle lokalen Daten (Watchlist, Trades, Einstellungen) löschen?")) actions.reset();
            }}
          >
            Alles zurücksetzen
          </button>
        </div>
        {msg && <p className="text-sm text-gold-light">{msg}</p>}
      </Section>
      <p className="text-center text-[13px] text-stone-600">Standardwerte: Polling {DEFAULT_SETTINGS.pollSeconds} s · Gewichtung 60/20/20</p>
    </div>
  );
}
