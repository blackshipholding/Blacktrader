import "server-only";
// Push-Nachrichten: Schlüssel (VAPID), Abos speichern, regelmäßig prüfen und senden.
import { createHash } from "node:crypto";
import webpush from "web-push";
import { binanceCandles } from "../data/binance";
import { yahooCandles } from "../data/yahoo";
import { acquireLock, delKey, getJson, releaseLock, setAdd, setJson, setMembers, setRemove, storageKind } from "../trainer/storage";
import type { Candle, Interval } from "../types";
import { evaluatePush, type PushMessage } from "./evaluate";
import type { PushRecord, PushTrade, PushWatch } from "./types";

const SUBS = "push:subs";
const VAPID_KEY = "push:vapid";
const MAX_SENT = 400;

export async function getVapid(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const stored = await getJson<{ publicKey: string; privateKey: string }>(VAPID_KEY);
  if (stored) return stored;
  if (storageKind() !== "kv") return null; // ohne dauerhaften Speicher würden die Schlüssel bei jedem Neustart wechseln
  const keys = webpush.generateVAPIDKeys();
  await setJson(VAPID_KEY, keys);
  return keys;
}

export const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 24);

export async function saveSubscription(rec: Omit<PushRecord, "sent" | "updatedAt">): Promise<void> {
  const id = subId(rec.sub.endpoint);
  const old = await getJson<PushRecord>(`push:sub:${id}`);
  await setJson(`push:sub:${id}`, { ...rec, sent: old?.sent ?? [], updatedAt: new Date().toISOString() } satisfies PushRecord);
  await setAdd(SUBS, id);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const id = subId(endpoint);
  await delKey(`push:sub:${id}`);
  await setRemove(SUBS, id);
}

async function send(rec: PushRecord, m: Pick<PushMessage, "title" | "body" | "url"> & { tag?: string }): Promise<"ok" | "gone" | "error"> {
  const v = await getVapid();
  if (!v) return "error";
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:push@blackship.invalid", v.publicKey, v.privateKey);
  try {
    await webpush.sendNotification(rec.sub, JSON.stringify(m), { TTL: 24 * 3600 });
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return code === 404 || code === 410 ? "gone" : "error";
  }
}

export async function sendTest(endpoint: string): Promise<string> {
  const rec = await getJson<PushRecord>(`push:sub:${subId(endpoint)}`);
  if (!rec) return "Kein Abo gefunden – bitte Push neu einschalten.";
  const r = await send(rec, { title: "Blacktrader", body: "Push-Nachrichten sind aktiv.", url: "/" });
  return r === "ok" ? "Test-Nachricht gesendet." : r === "gone" ? "Abo ist abgelaufen – bitte Push neu einschalten." : "Senden fehlgeschlagen.";
}

const candleCache = new Map<string, Promise<Candle[]>>();
function loadCandles(a: PushWatch | PushTrade, iv: Interval): Promise<Candle[]> {
  const k = `${a.symbol}:${iv}`;
  if (!candleCache.has(k)) {
    const p = (async () => {
      if (a.binanceSymbol) {
        try {
          return await binanceCandles(a.binanceSymbol, iv);
        } catch {
          /* Yahoo als Ersatz */
        }
      }
      return yahooCandles(a.yahooSymbol ?? a.symbol, iv);
    })();
    candleCache.set(k, p);
    p.catch(() => candleCache.delete(k));
  }
  return candleCache.get(k)!;
}

/** Alle Abos prüfen und fällige Nachrichten senden (Zeitbudget). */
export async function runPushCheck(budgetMs = 45_000): Promise<{ subs: number; sent: number; note: string }> {
  if (!(await acquireLock("push:lock", Math.ceil(budgetMs / 1000) + 15))) return { subs: 0, sent: 0, note: "Prüfung läuft bereits" };
  const deadline = Date.now() + budgetMs;
  candleCache.clear();
  let sentCount = 0;
  const ids = await setMembers(SUBS);
  try {
    for (const id of ids) {
      if (Date.now() > deadline) break;
      const rec = await getJson<PushRecord>(`push:sub:${id}`);
      if (!rec) {
        await setRemove(SUBS, id);
        continue;
      }
      const { messages, silent } = await evaluatePush(rec, loadCandles, deadline);
      const done: string[] = [...silent];
      let gone = false;
      for (const m of messages.slice(0, 8)) {
        const r = await send(rec, { title: m.title, body: m.body, url: m.url, tag: m.key });
        if (r === "gone") {
          gone = true;
          break;
        }
        if (r === "ok") (sentCount++, done.push(m.key));
      }
      if (gone) {
        await removeSubscription(rec.sub.endpoint);
        continue;
      }
      // Erneut lesen, damit eine zwischenzeitliche Aktualisierung aus der App nicht verloren geht
      const fresh = (await getJson<PushRecord>(`push:sub:${id}`)) ?? rec;
      await setJson(`push:sub:${id}`, { ...fresh, sent: [...new Set([...fresh.sent, ...done])].slice(-MAX_SENT) });
    }
  } finally {
    await releaseLock("push:lock");
  }
  return { subs: ids.length, sent: sentCount, note: `${ids.length} Abos geprüft, ${sentCount} Nachrichten gesendet` };
}
