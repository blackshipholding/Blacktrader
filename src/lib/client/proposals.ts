"use client";
// Trainer-Vorschläge (Nutzer 13.11.2026): Findet der Trainer eine bessere Einstellung, wird sie NICHT sofort eingebaut.
// Sie wird als Vorschlag gemerkt und an mehreren verschiedenen Tagen nachgeprüft (jedes Mal anderer Ausschnitt der Werte,
// gleiche harte Regeln, am letzten Tag zusätzlich Turnier/Härtetest). Besteht sie alle Tage, meldet sich die App –
// eingebaut wird erst, wenn DU „Einbauen“ drückst. Fällt sie an einem Tag durch, wird sie verworfen.
import { useSyncExternalStore } from "react";
import type { LearnableParams } from "../analysis/params";
import type { Metrics } from "../trainer/engine";
import type { CellKey } from "../trainer/universe";
import { keyOf } from "../trainer/walkforward";

/** So viele verschiedene Tage muss ein Vorschlag NACH dem Fund bestehen */
export const REQUIRED_DAYS = 3;
const KEY = "bt-trainer-proposals";

export type ProposalStatus = "testing" | "ready" | "rejected" | "adopted" | "discarded";
export interface ProposalCheck {
  day: string;
  pass: boolean;
  note: string;
}
export interface Proposal {
  id: string;
  cell: CellKey;
  baseParams: LearnableParams;
  deployed: LearnableParams;
  base: Metrics;
  cand: Metrics;
  changes: string;
  foundAt: string;
  checks: ProposalCheck[];
  status: ProposalStatus;
  note?: string;
}

let cache: Proposal[] | null = null;
const subs = new Set<() => void>();

function load(): Proposal[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(raw) ? raw.filter((p) => p && p.id && p.cell && p.deployed) : [];
  } catch {
    cache = [];
  }
  return cache!;
}
function save(list: Proposal[]) {
  // Abgeschlossene (verworfen/eingebaut/abgelehnt) nur begrenzt aufheben
  const active = list.filter((p) => p.status === "testing" || p.status === "ready");
  const done = list.filter((p) => !(p.status === "testing" || p.status === "ready")).slice(-12);
  cache = [...done, ...active];
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* Speicher voll – nur im Arbeitsspeicher */
  }
  subs.forEach((f) => f());
}

export const getProposals = (): Proposal[] => load();
export const useProposals = (): Proposal[] =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => load(),
    () => [],
  );

export const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);
export const isActive = (p: Proposal) => p.status === "testing" || p.status === "ready";
export const passDays = (p: Proposal) => new Set(p.checks.filter((c) => c.pass).map((c) => c.day)).size;

/** Neuen Vorschlag merken (ersetzt einen noch aktiven Vorschlag derselben Zelle) */
export function addProposal(cell: CellKey, p: { baseParams: LearnableParams; deployed: LearnableParams; base: Metrics; cand: Metrics; changes: string }, now = new Date()): Proposal | null {
  const list = load();
  const k = keyOf(p.deployed);
  const same = list.find((x) => x.cell === cell && isActive(x) && keyOf(x.deployed) === k);
  if (same) return null;
  const rest = list.map((x) => (x.cell === cell && isActive(x) ? { ...x, status: "discarded" as const, note: "durch neueren Vorschlag ersetzt" } : x));
  const fresh: Proposal = { id: `${now.getTime()}-${cell}`, cell, ...p, foundAt: now.toISOString(), checks: [], status: "testing" };
  save([...rest, fresh]);
  return fresh;
}

/** Vorschläge, die heute noch nicht nachgeprüft wurden (und an einem späteren Tag als dem Fund) */
export function dueForRetest(day = todayKey(), list = load()): Proposal[] {
  return list.filter((p) => p.status === "testing" && p.foundAt.slice(0, 10) !== day && !p.checks.some((c) => c.day === day));
}

/** Ergebnis einer Nachprüfung eintragen. Durchgefallen = verworfen; REQUIRED_DAYS verschiedene Tage bestanden = bereit zur Entscheidung. */
export function recordCheck(id: string, check: ProposalCheck): Proposal | null {
  const list = load();
  const p = list.find((x) => x.id === id);
  if (!p || p.status !== "testing" || p.checks.some((c) => c.day === check.day)) return null;
  const next: Proposal = { ...p, checks: [...p.checks, check] };
  if (!check.pass) {
    next.status = "rejected";
    next.note = check.note;
  } else if (passDays(next) >= REQUIRED_DAYS) next.status = "ready";
  save(list.map((x) => (x.id === id ? next : x)));
  return next;
}

export function setStatus(id: string, status: ProposalStatus, note?: string) {
  save(load().map((x) => (x.id === id ? { ...x, status, note: note ?? x.note } : x)));
}
