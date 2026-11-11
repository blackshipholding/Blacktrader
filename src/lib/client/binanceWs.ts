"use client";
// Gemeinsame Binance-WebSocket-Verbindung (direkt aus dem Browser, ohne Key).
// Abonniert Streams dynamisch, verbindet bei Abbruch mit Backoff neu.

type Handler = (msg: Record<string, unknown>) => void;

const URLS = ["wss://stream.binance.com:9443/ws", "wss://data-stream.binance.vision/ws"];

class BinanceStream {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private connected = false;
  private retry = 0;
  private urlIdx = 0;
  private reqId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  isConnected() {
    return this.connected;
  }

  onStatus(fn: (connected: boolean) => void) {
    this.statusListeners.add(fn);
    fn(this.connected);
    return () => this.statusListeners.delete(fn);
  }

  subscribe(stream: string, fn: Handler): () => void {
    const s = stream.toLowerCase();
    let set = this.handlers.get(s);
    if (!set) {
      set = new Set();
      this.handlers.set(s, set);
      this.send("SUBSCRIBE", [s]);
    }
    set.add(fn);
    this.ensure();
    return () => {
      const cur = this.handlers.get(s);
      if (!cur) return;
      cur.delete(fn);
      if (cur.size === 0) {
        this.handlers.delete(s);
        this.send("UNSUBSCRIBE", [s]);
      }
    };
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    this.statusListeners.forEach((l) => l(v));
  }

  private send(method: string, params: string[]) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method, params, id: this.reqId++ }));
  }

  private ensure() {
    if (typeof window === "undefined" || this.ws || this.timer) return;
    try {
      this.ws = new WebSocket(URLS[this.urlIdx % URLS.length]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      const streams = [...this.handlers.keys()];
      if (streams.length) this.send("SUBSCRIBE", streams);
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (!msg || typeof msg !== "object" || !("e" in msg)) return;
        const sym = String(msg.s ?? "").toLowerCase();
        const key = msg.e === "24hrMiniTicker" ? `${sym}@miniticker` : msg.e === "kline" ? `${sym}@kline_${msg.k?.i}` : `${sym}@${msg.e}`;
        this.handlers.get(key)?.forEach((h) => h(msg));
      } catch {
        /* ignorieren */
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      this.setConnected(false);
      this.urlIdx++;
      if (this.handlers.size) this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ensure();
    }, delay);
  }
}

export const binanceStream = typeof window !== "undefined" ? new BinanceStream() : (null as unknown as BinanceStream);
