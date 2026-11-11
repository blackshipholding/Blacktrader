"use client";
// Push-Nachrichten im Browser: einschalten/ausschalten, Abo mit offenen Trades + Watchlist beim Server aktuell halten.
import { getData } from "../store/store";
import { pushTradeFrom } from "../push/types";

const KEY = "bsh-push-enabled";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export const pushEnabled = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  return navigator.serviceWorker.ready.then(() => reg);
}

function payload(sub: PushSubscription) {
  const d = getData();
  return {
    sub: sub.toJSON(),
    trades: d.trades.filter((t) => t.status !== "closed").map(pushTradeFrom),
    watch: d.watchlist.map((w) => ({ symbol: w.symbol, name: w.name, kind: w.kind, yahooSymbol: w.yahooSymbol, binanceSymbol: w.binanceSymbol })),
    ltInterval: d.settings.intervals.long,
  };
}

/** Push einschalten. Gibt eine verständliche Meldung zurück. */
export async function enablePush(): Promise<{ ok: boolean; note: string }> {
  if (!pushSupported()) return { ok: false, note: "Dieses Gerät/dieser Browser unterstützt keine Push-Nachrichten. Auf dem iPhone: App zuerst zum Home-Bildschirm hinzufügen (ab iOS 16.4) und von dort öffnen." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, note: "Benachrichtigungen wurden nicht erlaubt (Browser-Einstellungen)." };
  const k = await fetch("/api/push/key").then((r) => r.json()).catch(() => null);
  if (!k?.ok) return { ok: false, note: k?.note ?? "Server nicht erreichbar." };
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.publicKey) });
  const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(sub)) });
  if (!r.ok) return { ok: false, note: "Abo konnte nicht gespeichert werden." };
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* egal */
  }
  return { ok: true, note: "Push-Nachrichten sind eingeschaltet." };
}

export async function disablePush(): Promise<void> {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
  if (!pushSupported()) return;
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function testPush(): Promise<string> {
  const sub = pushSupported() ? await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() : null;
  if (!sub) return "Push ist nicht eingeschaltet.";
  const r = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).then((x) => x.json()).catch(() => null);
  return r?.note ?? "Server nicht erreichbar.";
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastBody = "";
/** Nach Änderungen an Trades/Watchlist das Abo beim Server aktualisieren (gebündelt). */
export function syncPush() {
  if (!pushEnabled() || !pushSupported()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (!sub) return;
      const body = JSON.stringify(payload(sub));
      if (body === lastBody) return;
      lastBody = body;
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    } catch {
      /* nächster Versuch */
    }
  }, 3000);
}
