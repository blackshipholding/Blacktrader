"use client";
// Lerndaten sichern und herunterladen: alles, was Blacktrader/Trainer gelernt und gemessen hat und nur im Browser liegt
// (Trainer-Stand und -Nachrichten, Turnier-/Härtetest-Auswertungen, gelernte Werte je Zelle, gelernter Stop, Lernzeit).
// Zusammen mit Live-Bilanz, Einstiegs-Verlauf und Gewichtung aus dem normalen Datenspeicher ergibt das die „Lerndatei“.
// Nur Speichern/Laden – keine Regeln.
import type { AppData } from "../store/store";
import { allHistories } from "./entries";

/** Schlüssel, die NICHT in die Datei kommen (Zugangsdaten, Hinweise, Sicherungs-Zähler) */
const SKIP = new Set(["bsh-trainer-token", "bsh-push-enabled", "bsh-install-hint-dismissed", "bt-seen-versions", "bt-autobackup-at", "bt-autobackup-log", "bt-autobackup-log-at", "bt-autobackup-sig"]);
const isLearnKey = (k: string) => (k.startsWith("bsh-") || k.startsWith("bt-")) && !SKIP.has(k);

/** Alle lokal gespeicherten Lern-Schlüssel (Wert als JSON, sonst Text) */
export function collectLearnData(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isLearnKey(k)) continue;
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try {
        out[k] = JSON.parse(raw);
      } catch {
        out[k] = raw;
      }
    }
  } catch {
    /* ohne Speicher */
  }
  return out;
}

/** Eingespielte Lern-Schlüssel zurückschreiben (nur bekannte Präfixe, nie Zugangsdaten) */
export function restoreLearnData(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!isLearnKey(k)) continue;
    try {
      localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      n++;
    } catch {
      /* Speicher voll */
    }
  }
  return n;
}

/** Die ganze Lerndatei (zum Auswerten): Trainer-Daten + gelernte Gewichtung + Live-Bilanz + Einstiegs-Verlauf */
export function learnFile(d: Pick<AppData, "settings" | "chanceLog">) {
  return {
    app: "blacktrader-lerndaten",
    exportedAt: new Date().toISOString(),
    learn: collectLearnData(),
    weights: d.settings.weights,
    weightsMode: d.settings.weightsMode,
    chanceLog: d.chanceLog,
    entryHistory: allHistories(),
  };
}

export function downloadLearnFile(d: Pick<AppData, "settings" | "chanceLog">): void {
  const blob = new Blob([JSON.stringify(learnFile(d), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  a.href = URL.createObjectURL(blob);
  a.download = `blacktrader-lerndaten-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
