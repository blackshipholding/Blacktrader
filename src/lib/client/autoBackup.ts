"use client";
// Daten liegen nur auf dem Gerät (im Browser). Damit nichts verloren geht, wenn der Browser-Speicher gelöscht wird:
// 1) dauerhaften Speicher anfragen (der Browser räumt ihn dann nicht von selbst auf),
// 2) bei jeder Änderung an Trades, Konto oder Buy & Hold automatisch eine Sicherungsdatei speichern (Ordner „Downloads“).
// Wiederherstellen: Mehr → Backups → „Aus Datei wiederherstellen“.
import { actions, getData, subscribeData, type AppData } from "../store/store";

const SIG_KEY = "bt-autobackup-sig";
const LOG_KEY = "bt-autobackup-log"; // Anzahl fertiger Ergebnisse der Live-Bilanz beim letzten Sichern
const LOG_AT_KEY = "bt-autobackup-log-at";
/** Live-Bilanz: Anzahl fertiger Ergebnisse (Ziel, Stop, verpasst) – neue Ergebnisse höchstens einmal am Tag sichern */
const logDone = (d: Pick<AppData, "chanceLog">) => d.chanceLog.filter((x) => x.result).length;
const AT_KEY = "bt-autobackup-at";

/** Kennung der wichtigen Daten (Kursaktualisierungen lösen keine neue Datei aus) */
export function backupSignature(d: Pick<AppData, "trades" | "holdings" | "accountResets">): string {
  return JSON.stringify([
    // Depot (Trades, Konto, Buy & Hold) – jede Änderung sofort sichern
    d.trades.map((t) => [t.id, t.status, t.returnPct ?? null, t.closedAt ?? null, (t.tranches ?? []).filter((x) => x.filledAt).length, (t.partials ?? []).length]),
    d.holdings.map((h) => [h.id, h.txs.map((x) => x.id)]),
    d.accountResets,
  ]);
}

export function downloadBackup(): void {
  const blob = new Blob([actions.exportJson(false)], { type: "application/json" });
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  a.href = URL.createObjectURL(blob);
  a.download = `blacktrader-sicherung-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  try {
    localStorage.setItem(AT_KEY, String(Date.now()));
    localStorage.setItem(SIG_KEY, backupSignature(getData()));
    localStorage.setItem(LOG_KEY, String(logDone(getData())));
  } catch {
    /* ohne Speicher */
  }
}

export const lastAutoBackup = (): number | null => {
  try {
    const v = Number(localStorage.getItem(AT_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};

let started = false;
export function startAutoBackup() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* nicht unterstützt */
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    const d = getData();
    if (!d.settings.autoBackupFile) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(SIG_KEY);
    } catch {
      return;
    }
    const sig = backupSignature(d);
    if (last == null) {
      // Erster Start: Stand merken, erst bei der nächsten echten Änderung speichern
      try {
        localStorage.setItem(SIG_KEY, sig);
      } catch {
        /* ohne Speicher */
      }
      return;
    }
    if (sig === last) {
      // Nur die Live-Bilanz hat neue Ergebnisse: höchstens einmal pro Tag eine Sicherungsdatei
      try {
        const n = logDone(d);
        const lastN = Number(localStorage.getItem(LOG_KEY) ?? "0");
        const lastAt = Number(localStorage.getItem(LOG_AT_KEY) ?? "0");
        if (n > lastN && Date.now() - lastAt > 24 * 3600e3) {
          localStorage.setItem(LOG_KEY, String(n));
          localStorage.setItem(LOG_AT_KEY, String(Date.now()));
          downloadBackup();
        }
      } catch {
        /* ohne Speicher */
      }
      return;
    }
    if (timer) clearTimeout(timer);
    // kurz warten, damit mehrere Änderungen (z. B. „Alle übernehmen“) in einer Datei landen
    timer = setTimeout(() => {
      timer = null;
      if (backupSignature(getData()) !== last) downloadBackup();
    }, 8000);
  };
  subscribeData(check);
  check();
}
