"use client";
// Buy-&-Hold-Dividenden automatisch an Blacktime weitergeben: bei jeder Änderung (neuer Kauf, Dividende von Hand, neue
// automatische Dividende) geht die Liste (Datum, Aktie, Stückzahl, brutto, netto) an den Server-Speicher. Blacktime holt sie mit dem
// Kopplungs-Code ab. Sonst wird nichts gesendet; an der Analyse und am Handel ändert das nichts.
import { netOfTax } from "../analysis/dividends";
import { getData, subscribeData } from "../store/store";
import { creditsOfHolding, loadDividends, loadForPositions, subscribeBook } from "./dividendBook";

export interface ShareRow { name: string; symbol: string; date: string; /** Stückzahl, für die die Dividende gilt */ shares: number; gross: number; net: number; source: "hand" | "auto" }

/** Stückzahl am Stichtag aus Käufen/Verkäufen (für von Hand eingetragene Dividenden) */
function qtyAt(h: { txs: { type: string; date: string; qty: number }[] }, date: string): number {
  let q = 0;
  for (const t of h.txs) if (t.date <= date) q += t.type === "buy" ? t.qty : t.type === "sell" ? -t.qty : 0;
  return Math.max(0, Math.round(q * 1e4) / 1e4);
}

const CODE = "bt-share-code";
const ON = "bt-share-on";
const SIG = "bt-share-sig";
const AT = "bt-share-at";
const COUNT = "bt-share-count";
const r2 = (x: number) => Math.round(x * 100) / 100;

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ohne Speicher */ } },
};

export const shareOn = () => ls.get(ON) === "1" && !!ls.get(CODE);
export const shareCode = () => ls.get(CODE);
export const shareLastAt = () => Number(ls.get(AT)) || null;
export const shareLastCount = () => { const v = ls.get(COUNT); return v == null ? null : Number(v); };

export interface ShareResult { ok: boolean; count: number; storage?: "kv" | "memory"; note?: string }

function newCode(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
}

export function enableShare(): string {
  const c = shareCode() ?? newCode();
  ls.set(CODE, c);
  ls.set(ON, "1");
  ls.del(SIG);
  loadForPositions([], getData().holdings);
  void syncNow(true);
  return c;
}
export function disableShare(): void {
  ls.set(ON, "0");
}
/** Neuen Code erzeugen (der alte Code verliert damit seinen Zugang zu neuen Daten) */
export function renewCode(): string {
  ls.del(CODE);
  return enableShare();
}

/** Alle Dividenden der Buy-&-Hold-Positionen: von Hand eingetragene + automatisch berechnete */
export function buildShareRows(now = Date.now()): ShareRow[] {
  const out: ShareRow[] = [];
  for (const h of getData().holdings) {
    for (const t of h.txs) if (t.type === "div" && t.price > 0) out.push({ name: h.name, symbol: h.symbol, date: t.date, shares: qtyAt(h, t.date), gross: r2(t.price), net: r2(netOfTax(t.price)), source: "hand" });
    for (const c of creditsOfHolding(h, now)) out.push({ name: h.name, symbol: h.symbol, date: c.date, shares: Math.round(c.shares * 1e4) / 1e4, gross: r2(c.grossEur), net: r2(netOfTax(c.grossEur)), source: "auto" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

let busy = false;
/** Liste senden. `force`: auch senden, wenn sich nichts geändert hat („Jetzt senden“). */
export async function syncNow(force = false): Promise<ShareResult> {
  const code = shareCode();
  if (!shareOn() || !code) return { ok: false, count: 0, note: "Senden ist ausgeschaltet." };
  if (busy) return { ok: false, count: 0, note: "Es läuft schon ein Senden." };
  // Dividenden-Daten der Buy-&-Hold-Aktien sicher geladen haben – sonst fehlen die automatischen Dividenden in der Liste
  if (force)
    await Promise.all(
      getData().holdings.filter((h) => h.kind === "stock").map((h) => {
        const first = h.txs.map((x) => Date.parse(`${x.date}T00:00:00Z`)).filter(Number.isFinite).sort((a, b) => a - b)[0];
        return first ? loadDividends(h, first).catch(() => undefined) : undefined;
      }),
    );
  const rows = buildShareRows();
  const sig = JSON.stringify(rows);
  if (!force && sig === ls.get(SIG)) return { ok: true, count: rows.length };
  busy = true;
  try {
    const res = await fetch("/api/share-dividends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, rows }) });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; count?: number; storage?: "kv" | "memory"; note?: string } | null;
    if (!res.ok || !j?.ok) return { ok: false, count: rows.length, note: j?.note ?? `Fehler ${res.status}` };
    ls.set(SIG, sig);
    ls.set(AT, String(Date.now()));
    ls.set(COUNT, String(rows.length));
    return { ok: true, count: j.count ?? rows.length, storage: j.storage };
  } catch {
    return { ok: false, count: rows.length, note: "Keine Verbindung." };
  } finally {
    busy = false;
  }
}

let started = false;
export function startShare() {
  if (started || typeof window === "undefined") return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (!shareOn()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 6000);
  };
  subscribeData(later);
  subscribeBook(later);
  if (shareOn()) {
    loadForPositions([], getData().holdings);
    later();
  }
}
