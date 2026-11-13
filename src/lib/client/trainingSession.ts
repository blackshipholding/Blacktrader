"use client";
// Steuerung der Trainingssitzung im Browser: Web Worker, Speichern des Fortschritts, Bildschirm-Sperre verhindern,
// Ergebnisse an den Server (der nur speichert, wenn es auf unbekannten Daten besser ist).
import { useSyncExternalStore } from "react";
import { SCAN_PRESETS } from "./presets";
import { cellSummary, refreshTrainerParams, saveLocalCell, trainerParamSet } from "./trainerParams";
import { applyProposal, emptyRecord, summarize, type CellSummary } from "../trainer/cells";
import type { LearnableParams } from "../analysis/params";
import type { WFResult } from "../trainer/walkforward";
import type { Metrics } from "../trainer/engine";
import { getData } from "../store/store";
import type { CellOutcome, SessionState } from "../trainer/session";
import { ACTIVE_CELL_KEYS, type CellKey } from "../trainer/universe";
import type { TournamentReport } from "../trainer/tournament";
import type { StopParams } from "../analysis/longterm";
import { getStopParams, saveStopParams } from "./stopParams";
import { addProposal, dueForRetest, getProposals, passDays, recordCheck, REQUIRED_DAYS, setStatus, todayKey } from "./proposals";
import { notify } from "./alerts";

const KEY = "bsh-training-session";
const MSG_KEY = "bsh-training-messages";
const REPORTS_KEY = "bt-tournament-reports";
export const TOKEN_KEY = "bsh-trainer-token";

interface View {
  session: SessionState | null;
  /** Bestätigungen je Sitzung ("Gespeichert: …") */
  messages: Record<string, string[]>;
  running: boolean;
  wakeLock: boolean;
  /** Turnier-Auswertungen, neueste zuerst */
  reports: TournamentReport[];
  /** Nachprüfung der Vorschläge läuft (Nutzer 13.11.2026) */
  retest: { running: boolean; text: string };
}
let view: View = { session: null, messages: {}, running: false, wakeLock: false, reports: [], retest: { running: false, text: "" } };
const subs = new Set<() => void>();
const emit = (patch: Partial<View>) => {
  view = { ...view, ...patch };
  subs.forEach((f) => f());
};

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* Speicher voll – Fortschritt nur im Arbeitsspeicher */
  }
}

let worker: Worker | null = null;
let lock: { release: () => Promise<void> } | null = null;

async function acquireWakeLock() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wl || lock) return;
    lock = await wl.request("screen");
    emit({ wakeLock: true });
  } catch {
    emit({ wakeLock: false });
  }
}
function releaseWakeLock() {
  lock?.release().catch(() => {});
  lock = null;
  emit({ wakeLock: false });
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && view.running) {
      lock = null;
      void acquireWakeLock();
    }
  });
}

/**
 * Besseren Stand SOFORT speichern: zuerst beim Server (prüft alles erneut, atomar je Zelle), dann lokal.
 * Ist der Server nicht erreichbar, wird nach denselben Regeln nur lokal gespeichert.
 * Lehnt der Server ab (z. B. Ausgangsstand geändert), wird nichts gespeichert.
 */
async function saveImprovement(cell: CellKey, r: WFResult, baseParams: LearnableParams): Promise<{ ok: boolean; message: string }> {
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    /* ohne Speicher */
  }
  try {
    const res = await fetch("/api/trainer/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-trainer-token": token } : {}) },
      body: JSON.stringify({ cell, baseParams, base: r.base, cand: r.cand, deployed: r.deployed }),
    });
    const j = (await res.json().catch(() => ({}))) as { saved?: boolean; note?: string; record?: CellSummary };
    if (res.ok && j.saved && j.record) {
      saveLocalCell(j.record);
      void refreshTrainerParams(true);
      return { ok: true, message: j.note ?? "Gespeichert" };
    }
    if (res.status < 500) return { ok: false, message: res.status === 401 ? "Zugangscode fehlt – nicht gespeichert" : "" };
  } catch {
    /* Server nicht erreichbar → lokal */
  }
  // Nur lokal, mit denselben Regeln
  const cur = cellSummary(cell);
  const rec = { ...emptyRecord(cell), ...(cur ?? {}), versions: [{ id: cur?.version ?? 1, savedAt: cur?.updatedAt ?? "", params: cur?.params ?? {}, standing: cur?.current ?? null, reason: "" }] };
  const out = applyProposal(rec, { baseParams, base: r.base, cand: r.cand, deployed: r.deployed, source: "Browser-Training (lokal)" });
  if (!out.saved) return { ok: false, message: "" };
  saveLocalCell(summarize(out.record));
  return { ok: true, message: `${out.message} (auf diesem Gerät)` };
}

/** Erste Messung einer Zelle merken (ändert keine gelernten Werte; vorhandene Stände bleiben unberührt). */
async function saveMeasurement(cell: CellKey, base: Metrics, baseParams: LearnableParams) {
  if (cellSummary(cell)?.current) return;
  try {
    const res = await fetch("/api/trainer/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tokenHeader() },
      body: JSON.stringify({ cell, baseParams, base, cand: base, deployed: baseParams }),
    });
    const j = (await res.json().catch(() => ({}))) as { record?: CellSummary };
    if (res.ok && j.record?.current) {
      saveLocalCell(j.record);
      return;
    }
    if (res.status < 500) return;
  } catch {
    /* lokal */
  }
  const cur = cellSummary(cell);
  if (cur?.current) return;
  saveLocalCell({ cell, params: cur?.params ?? {}, current: base, previous: null, updatedAt: new Date().toISOString(), version: cur?.version ?? 1 });
}

function tokenHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { "x-trainer-token": t } : {};
  } catch {
    return {};
  }
}

function spawn(state: SessionState) {
  worker?.terminate();
  worker = new Worker(new URL("../trainer/session.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = async (e: MessageEvent) => {
    const m = e.data as
      | { type: "progress"; state: SessionState }
      | { type: "cell"; id: string; outcome: CellOutcome; state: SessionState }
      | { type: "improve"; id: string; cell: CellKey; result: WFResult; baseParams: LearnableParams; state: SessionState }
      | { type: "measured"; cell: CellKey; base: Metrics; baseParams: LearnableParams; state?: undefined }
      | { type: "protocol"; cell: CellKey; entries: unknown[]; state?: undefined }
      | { type: "report"; report: TournamentReport; state?: undefined }
      | { type: "stop"; params: StopParams; state?: undefined };
    if (m.type === "report") {
      saveReport(m.report);
      return;
    }
    if (m.type === "stop") {
      saveStopParams(m.params); // gelernter Stop (nur B8-bestanden, enger Rahmen)
      return;
    }
    if (m.type === "measured") {
      void saveMeasurement(m.cell, m.base, m.baseParams);
      return;
    }
    if (m.type === "protocol") {
      // Messprotokoll beim Server ablegen (zum Auslesen/Export); Fehler sind hier nicht kritisch
      void fetch("/api/trainer/protocol", { method: "POST", headers: { "Content-Type": "application/json", ...tokenHeader() }, body: JSON.stringify({ cell: m.cell, entries: m.entries }) }).catch(() => {});
      return;
    }
    write(KEY, m.state);
    if (m.type === "improve") {
      // Nutzer 13.11.2026: NICHT sofort einbauen – als Vorschlag merken, an mehreren Tagen nachprüfen, du entscheidest
      const prop = addProposal(m.cell, { baseParams: m.baseParams, deployed: m.result.deployed, base: m.result.base, cand: m.result.cand, changes: m.result.changes });
      const r = { ok: true, message: prop ? `Bessere Einstellung gefunden (${m.result.changes}) – noch NICHT eingebaut: wird an ${REQUIRED_DAYS} verschiedenen Tagen nachgeprüft, dann fragt die App dich.` : "" };
      if (r.message) {
        const list = [...(view.messages[m.state.cfg.id] ?? []), r.message];
        const messages = { ...view.messages, [m.state.cfg.id]: list };
        write(MSG_KEY, messages);
        emit({ messages });
      }
      worker?.postMessage({ type: "saved", id: m.id, ok: r.ok });
    } else if (m.type === "cell") {
      worker?.postMessage({ type: "saved", id: m.id, ok: true });
    }
    const running = m.state.status === "running";
    emit({ session: m.state, running });
    if (!running) {
      releaseWakeLock();
      worker?.terminate();
      worker = null;
    }
  };
  worker.onerror = () => {
    emit({ running: false });
    releaseWakeLock();
  };
  worker.postMessage({ type: "start", state });
  emit({ session: state, running: true });
  void acquireWakeLock();
}

/** Auswertung auf dem Gerät und (falls möglich) beim Server speichern. */
function saveReport(r: TournamentReport) {
  const reports = [r, ...view.reports.filter((x) => x.at !== r.at)].slice(0, 20);
  write(REPORTS_KEY, reports);
  emit({ reports });
  void fetch("/api/trainer/report", { method: "POST", headers: { "Content-Type": "application/json", ...tokenHeader() }, body: JSON.stringify(r) }).catch(() => {});
}

/** Gespeicherte Auswertungen laden (Gerät + Server, zusammengeführt). */
export async function loadReports() {
  const local = read<TournamentReport[]>(REPORTS_KEY) ?? [];
  let server: TournamentReport[] = [];
  try {
    const r = await fetch("/api/trainer/report", { cache: "no-store" });
    if (r.ok) server = ((await r.json()) as { reports?: TournamentReport[] }).reports ?? [];
  } catch {
    /* nur Gerät */
  }
  const map = new Map<string, TournamentReport>();
  // Nur Berichte im aktuellen Format (5-Jahres-Versuche); ältere (500 Trades) werden nicht mehr angezeigt
  for (const x of [...local, ...server]) if (x && x.v === 2 && x.at && Array.isArray(x.ranking)) map.set(x.at, x);
  const reports = [...map.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  emit({ reports });
}

/** Neue Sitzung starten (alle Bereiche: Aktien, Krypto, Rohstoffe). Dauer 0 = nur Turnier ohne Training. */
export async function startTraining(durationMs: number, cells: CellKey[] = [...ACTIVE_CELL_KEYS]) {
  if (view.running) return;
  await refreshTrainerParams(true);
  const { version, params } = trainerParamSet();
  const d = getData();
  const extra = [...SCAN_PRESETS, ...d.watchlist].map((a) => ({ symbol: a.symbol, kind: a.kind, yahooSymbol: a.yahooSymbol }));
  const { newSession } = await import("../trainer/session");
  const { resolveParams } = await import("../analysis/params");
  const baseParams = Object.fromEntries(cells.map((c) => {
    const [k, h] = c.split(":") as [never, never];
    return [c, resolveParams(params, k, h)];
  }));
  // Live-Bilanz für die Live-Prüfung beim Lernen (erst ab 500 abgeschlossenen Ergebnissen aktiv)
  const log = getData().chanceLog;
  const live = log.length ? { start: Math.min(...log.map((x) => x.from)), done: log.filter((x) => x.result === "ziel" || x.result === "stop").length } : undefined;
  // Turnier-Gegner: jeder startet mit seinem Champion aus dem letzten Turnier
  const lastWith = view.reports.find((r) => r.opponents?.length);
  const champions = lastWith ? Object.fromEntries(lastWith.opponents!.map((o) => [o.id, o.params])) : undefined;
  const st = newSession({ id: String(Date.now()), durationMs, cells, baseVersion: version, paramSet: params, extra, baseParams, live, champions, stop: getStopParams() });
  write(KEY, st);
  spawn(st);
}

let rworker: Worker | null = null;

/**
 * Vorschläge nachprüfen, die heute noch nicht geprüft wurden (jeder Tag zählt einmal, jedes Mal anderer Ausschnitt der Werte).
 * Besteht ein Vorschlag an REQUIRED_DAYS Tagen, meldet die App sich; durchgefallen = verworfen.
 */
export async function retestProposals(): Promise<void> {
  if (view.running || view.retest.running || rworker) return;
  const day = todayKey();
  const due = dueForRetest(day);
  if (!due.length) return;
  await refreshTrainerParams(true);
  const { params } = trainerParamSet();
  const { resolveParams } = await import("../analysis/params");
  const d = getData();
  const extra = [...SCAN_PRESETS, ...d.watchlist].map((a) => ({ symbol: a.symbol, kind: a.kind, yahooSymbol: a.yahooSymbol }));
  const lastWith = view.reports.find((r) => r.opponents?.length);
  const champions = lastWith ? Object.fromEntries(lastWith.opponents!.map((o) => [o.id, o.params])) : undefined;
  const proposals = due.map((p) => {
    const [k, h] = p.cell.split(":") as [never, never];
    return { id: p.id, cell: p.cell, baseNow: resolveParams(params, k, h), deployed: p.deployed, last: passDays(p) + 1 >= REQUIRED_DAYS };
  });
  const w = new Worker(new URL("../trainer/session.worker.ts", import.meta.url), { type: "module" });
  rworker = w;
  const end = () => {
    w.terminate();
    if (rworker === w) rworker = null;
    emit({ retest: { running: false, text: "" } });
  };
  w.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; text?: string; id?: string; day?: string; pass?: boolean; skipped?: boolean; note?: string };
    if (m.type === "retestProgress") emit({ retest: { running: true, text: m.text ?? "" } });
    else if (m.type === "retestResult" && m.id && m.day && !m.skipped) {
      const p = recordCheck(m.id, { day: m.day, pass: !!m.pass, note: m.note ?? "" });
      if (p?.status === "ready") {
        const text = `Der Trainer hat eine bessere Einstellung gefunden und sie an ${REQUIRED_DAYS} verschiedenen Tagen bestätigt (${p.changes}). Im Trainer kannst du sie einbauen oder verwerfen.`;
        void notify("Trainer: bessere Variante bereit", text, { sound: d.settings.sound, notifications: d.settings.notifications, kind: "info" });
      }
    } else if (m.type === "retestDone") end();
  };
  w.onerror = end;
  emit({ retest: { running: true, text: "Vorschläge nachprüfen …" } });
  w.postMessage({ type: "retest", day, paramSet: params, extra, champions, proposals });
}

/** Vorschlag einbauen (nur auf deinen Knopfdruck, nur wenn alle Tage bestanden). Gibt eine Meldung für die Anzeige zurück. */
export async function adoptProposal(id: string): Promise<string> {
  const p = getProposals().find((x) => x.id === id);
  if (!p || p.status !== "ready") return "Dieser Vorschlag ist nicht mehr bereit.";
  await refreshTrainerParams(true);
  const { params } = trainerParamSet();
  const { resolveParams } = await import("../analysis/params");
  const [k, h] = p.cell.split(":") as [never, never];
  const r: WFResult = { base: p.base, cand: p.cand, decision: { accept: true, reasons: [] }, deployed: p.deployed, changes: p.changes, improved: true };
  const out = await saveImprovement(p.cell, r, resolveParams(params, k, h));
  if (out.ok) {
    setStatus(id, "adopted", out.message);
    return out.message || "Eingebaut.";
  }
  return `Konnte nicht eingebaut werden${out.message ? `: ${out.message}` : " (die Regeln – z. B. kleine Schritte – lassen es nicht zu)"}. Der Vorschlag bleibt bereit.`;
}

export const discardProposal = (id: string) => setStatus(id, "discarded", "von dir verworfen");

export function stopTraining() {
  rworker?.postMessage({ type: "stop" });
  worker?.postMessage({ type: "stop" });
}

/** Nach dem Neuladen: laufende Sitzung fortsetzen. */
let resumed = false;
export function resumeTraining() {
  if (resumed || typeof window === "undefined") return;
  resumed = true;
  const st = read<SessionState>(KEY);
  const raw = read<Record<string, unknown>>(MSG_KEY) ?? {};
  const messages = Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v))) as Record<string, string[]>;
  emit({ session: st, messages });
  if (st && st.status === "running") spawn(st);
}

export function useTraining(): View {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => view,
    () => view,
  );
}
