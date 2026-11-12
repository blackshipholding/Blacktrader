"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconChart, IconChevron, IconDownload, IconGear, IconShield, IconSpark } from "@/components/Icons";
import { actions, listBackups, readBackup, useAppData } from "@/lib/store/store";
import { downloadBackup, lastAutoBackup } from "@/lib/client/autoBackup";
import { disableShare, enableShare, renewCode, shareCode, shareLastAt, shareOn, syncNow } from "@/lib/client/dividendShare";

function Row({ href, icon, title, text }: { href: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="flex min-h-[64px] items-center gap-3 px-4 py-3 active:bg-white/5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-stone-100">{title}</span>
        <span className="block text-[14px] text-stone-400">{text}</span>
      </span>
      <IconChevron className="h-5 w-5 text-stone-500" />
    </Link>
  );
}

export default function MehrPage() {
  const [backups, setBackups] = useState<{ key: string; date: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<number | null>(null);
  const auto = useAppData((d) => d.settings.autoBackupFile);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setBackups(listBackups());
    setLastFile(lastAutoBackup());
  }, []);

  const download = (key: string) => {
    const raw = readBackup(key);
    if (!raw) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    a.download = `black-ship-backup-${key.split(":").pop()?.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] text-gold">Mehr</h1>
      <div className="card divide-y divide-white/5 overflow-hidden">
        <Row href="/echochart" icon={<IconChart className="h-6 w-6" />} title="EchoChart" text="Wie gut wäre Blacktrader früher gewesen?" />
        <Row href="/trainer" icon={<IconSpark className="h-6 w-6" />} title="Trainer" text="Trefferquote, Lernschritte, Versionen" />
        <Row href="/kurstest" icon={<IconShield className="h-6 w-6" />} title="Kurs-Test" text="Welche deutsche Börse für die Euro-Kurse? (gilt für die ganze App)" />
        <Row href="/regelwerk" icon={<IconShield className="h-6 w-6" />} title="Regelwerk" text="Wann Blacktrader etwas ändern darf – und was nie" />
        <Row href="/einstellungen" icon={<IconGear className="h-6 w-6" />} title="Einstellungen" text="Gewichtung, Alarme, Schlüssel, Export" />
      </div>

      <ShareCard />

      <section className="card space-y-3 p-4">
        <div className="flex items-center gap-2">
          <IconDownload className="h-5 w-5 text-gold" />
          <h2 className="text-[17px] text-gold-light">Backups</h2>
        </div>
        <p className="text-[15px] text-stone-300">Deine Daten liegen nur auf diesem Gerät. Damit nichts verloren geht, wenn der Browser-Speicher gelöscht wird, speichert die App bei jedem neuen, geschlossenen oder geänderten Trade und bei Buy & Hold automatisch eine Sicherungsdatei in deinen Ordner „Downloads“.</p>
        <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-white/5 px-3 text-[15px] text-stone-200">
          <span>
            Automatisch als Datei sichern
            <span className="block text-[13px] text-stone-400">Letzte Datei: {lastFile ? new Date(lastFile).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch keine"}</span>
          </span>
          <input type="checkbox" className="h-6 w-6 accent-[#C9A24A]" checked={auto} onChange={(e) => actions.setSettings({ autoBackupFile: e.target.checked })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              downloadBackup();
              setLastFile(lastAutoBackup());
              setMsg("Sicherungsdatei gespeichert (Ordner „Downloads“).");
            }}
          >
            Jetzt sichern
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Aus Datei wiederherstellen
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (!window.confirm("Sicherung wiederherstellen? Der aktuelle Stand wird durch die Datei ersetzt.")) return;
            try {
              actions.importJson(await f.text());
              setMsg("Sicherung wiederhergestellt.");
            } catch (err) {
              setMsg(`Wiederherstellen fehlgeschlagen: ${(err as Error).message}`);
            }
          }}
        />
        {backups.length === 0 ? null : (
          <ul className="space-y-2">
            {backups.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 p-3">
                <span className="text-[15px] text-stone-200">Vor dem Update · {new Date(b.date).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="flex gap-2">
                  <button className="btn" onClick={() => download(b.key)}>
                    Herunterladen
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (window.confirm("Backup wiederherstellen? Der aktuelle Stand wird ersetzt.")) {
                        actions.restoreBackup(b.key);
                        setMsg("Backup wiederhergestellt.");
                      }
                    }}
                  >
                    Wiederherstellen
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="text-[14px] text-emerald-300">{msg}</p>}
      </section>

      <section className="card space-y-2 p-4 text-[15px] text-stone-300">
        <div className="flex items-center gap-2">
          <IconShield className="h-5 w-5 text-gold" />
          <h2 className="text-[17px] text-gold-light">Daten</h2>
        </div>
        <p className="text-stone-400">Alle Daten bleiben auf diesem Gerät. Kurse: Binance (Krypto, live), Yahoo Finance (Aktien/Rohstoffe, bis zu 15 Min. verzögert), Nasdaq, CoinGecko, OpenFIGI, Google News.</p>
      </section>

      <section className="card space-y-2 p-4 text-[15px] text-stone-300">
        <h2 className="text-[17px] text-gold-light">Als App installieren</h2>
        <p>
          <b>Android (Chrome/Brave):</b> Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
        </p>
        <p>
          <b>iPhone (Safari):</b> Teilen-Symbol → „Zum Home-Bildschirm“.
        </p>
      </section>
    </div>
  );
}

/** Buy-&-Hold-Dividenden automatisch an Blacktime weitergeben (Kopplungs-Code) */
function ShareCard() {
  const [on, setOn] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setOn(shareOn());
    setCode(shareCode());
    setAt(shareLastAt());
  }, []);
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-[17px] text-gold-light">Dividenden an Blacktimer senden</h2>
      <p className="text-[15px] text-stone-300">Bei jeder Änderung deiner Buy-&-Hold-Dividenden (Datum, Aktie, Stück, Betrag brutto/netto) geht die Liste (mit Stückzahl) automatisch an Blacktimer. Sonst wird nichts gesendet.</p>
      <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-white/5 px-3 text-[15px] text-stone-200">
        <span>
          Automatisch senden
          <span className="block text-[13px] text-stone-400">Zuletzt: {at ? new Date(at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie"}</span>
        </span>
        <input
          type="checkbox"
          className="h-6 w-6 accent-[#C9A24A]"
          checked={on}
          onChange={(e) => {
            if (e.target.checked) {
              setCode(enableShare());
              setOn(true);
            } else {
              disableShare();
              setOn(false);
            }
          }}
        />
      </label>
      {on && code && (
        <>
          <div className="rounded-xl bg-white/5 px-3 py-2 text-[14px] text-stone-300">
            Dein Kopplungs-Code für Blacktimer (nur du kennst ihn):
            <div className="num mt-1 break-all text-[16px] font-semibold text-stone-50 select-all">{code}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn-primary"
              onClick={async () => {
                const ok = await syncNow();
                setAt(shareLastAt());
                setMsg(ok ? "Gesendet." : "Senden hat nicht geklappt – später noch einmal versuchen.");
              }}
            >
              Jetzt senden
            </button>
            <button
              className="btn"
              onClick={() => {
                if (!window.confirm("Neuen Code erzeugen? Blacktimer braucht dann den neuen Code.")) return;
                setCode(renewCode());
                setMsg("Neuer Code erzeugt.");
              }}
            >
              Neuer Code
            </button>
          </div>
        </>
      )}
      {msg && <p className="text-[14px] text-stone-300">{msg}</p>}
    </section>
  );
}
