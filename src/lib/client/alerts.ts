"use client";
import { getData } from "../store/store";
// Browser-Benachrichtigung + Signalton (Web Audio, keine Audiodatei nötig).

let ctx: AudioContext | null = null;

export function playTone(kind: "buy" | "sell" | "info" = "info") {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const notes = kind === "buy" ? [660, 880] : kind === "sell" ? [660, 440] : [740];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx!.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.17);
    });
  } catch {
    /* Audio nicht verfügbar */
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

/** Haptisches Feedback (Android; iPhone-Safari unterstützt keine Vibration). */
export function haptic(pattern: number | number[] = 30) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* nicht verfügbar */
  }
}

export async function notify(title: string, body: string, opts: { sound: boolean; notifications: boolean; kind?: "buy" | "sell" | "info"; haptics?: boolean }) {
  if (opts.sound) playTone(opts.kind);
  if (opts.haptics ?? getData().settings.haptics) haptic([40, 60, 40]);
  if (!opts.notifications || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: title });
    else new Notification(title, { body, icon: "/icon-192.png" });
  } catch {
    try {
      new Notification(title, { body });
    } catch {
      /* ignorieren */
    }
  }
}
