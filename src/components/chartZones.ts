// Zeichnet Einstiegszonen wie bei HKCM in den Kerzenchart (lightweight-charts „Series Primitive“):
// Kasten für die Zone (blau = langfristig, grün = Trade, rot = Short, grau = alter Einstieg), darin Stop (rot) und Ziel (grün)
// als beschriftete Linien, dazu der erwartete Weg: erst in die Zone (rot), dann Richtung Ziel (grün).
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { AutoscaleInfo, IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

export interface ChartEntry {
  color: "blau" | "gruen" | "rot" | "grau";
  /** Beginn der Zone (Unix-Sekunden) */
  from: number;
  /** Ende (nur bei alten Einstiegen); sonst bis zum rechten Rand */
  to?: number;
  top: number;
  bottom: number;
  stop?: number;
  target?: number;
  /** Blau: Ungültig unter */
  invalidation?: number;
  label: string;
}

const COLORS = {
  blau: { fill: "rgba(56,189,248,0.22)", line: "rgba(56,189,248,0.9)", text: "#7dd3fc" },
  gruen: { fill: "rgba(52,211,153,0.22)", line: "rgba(52,211,153,0.9)", text: "#6ee7b7" },
  rot: { fill: "rgba(248,113,113,0.22)", line: "rgba(248,113,113,0.9)", text: "#fca5a5" },
  grau: { fill: "rgba(168,162,158,0.14)", line: "rgba(168,162,158,0.55)", text: "#a8a29e" },
};
const RED = "#f87171";
const GREEN = "#34d399";

export class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private request: (() => void) | null = null;
  private entries: ChartEntry[] = [];
  /** Zeitpunkte aller Datenpunkte (Kerzen + leerer Platz rechts) – Index = logische Position */
  private times: number[] = [];
  private lastReal = 0;
  private lastClose = 0;
  private fmt: (n: number) => string = (n) => n.toFixed(2);

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.request = null;
  }

  set(entries: ChartEntry[], times: number[], lastReal: number, lastClose: number, fmt: (n: number) => string) {
    this.entries = entries;
    this.times = times;
    this.lastReal = lastReal;
    this.lastClose = lastClose;
    this.fmt = fmt;
    this.request?.();
  }

  /** Nur der aktuelle Einstieg bestimmt den sichtbaren Preisbereich mit (alte, graue nicht). */
  autoscaleInfo(): AutoscaleInfo | null {
    const cur = this.entries.filter((e) => e.color !== "grau");
    if (!cur.length) return null;
    const v: number[] = [];
    for (const e of cur) {
      v.push(e.top, e.bottom);
      if (e.stop != null) v.push(e.stop);
      if (e.target != null) v.push(e.target);
      if (e.invalidation != null && e.invalidation > e.bottom * 0.65) v.push(e.invalidation);
    }
    return { priceRange: { minValue: Math.min(...v), maxValue: Math.max(...v) } };
  }

  private index(t: number): number {
    const a = this.times;
    if (!a.length) return 0;
    if (t <= a[0]) return 0;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (a[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const self = this;
    const renderer: IPrimitivePaneRenderer = {
      draw(target: CanvasRenderingTarget2D) {
        const chart = self.chart;
        const series = self.series;
        if (!chart || !series || !self.times.length) return;
        const ts = chart.timeScale();
        const X = (t: number) => ts.logicalToCoordinate(self.index(t) as Logical);
        const XI = (i: number) => ts.logicalToCoordinate(i as Logical);
        const Y = (p: number) => series.priceToCoordinate(p);
        const right = XI(self.times.length - 1);
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
          const label = (text: string, x: number, y: number, color: string, align: CanvasTextAlign = "left") => {
            ctx.font = `${Math.round(11 * vr)}px Inter, sans-serif`;
            ctx.textAlign = align;
            ctx.textBaseline = "bottom";
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
          };
          const hline = (price: number, x1: number, x2: number, color: string, width: number, dash: number[], text?: string) => {
            const y = Y(price);
            if (y == null) return;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = width * vr;
            ctx.setLineDash(dash.map((d) => d * hr));
            ctx.beginPath();
            ctx.moveTo(x1 * hr, y * vr);
            ctx.lineTo(x2 * hr, y * vr);
            ctx.stroke();
            ctx.restore();
            if (text) label(text, x2 * hr - 4 * hr, y * vr - 2 * vr, color, "right");
          };
          // Alte Einstiege zuerst (liegen hinten)
          const order = [...self.entries].sort((a, b) => (a.color === "grau" ? 0 : 1) - (b.color === "grau" ? 0 : 1));
          for (const e of order) {
            const c = COLORS[e.color];
            const x1 = X(e.from);
            const x2 = e.to != null ? X(e.to) : right;
            const yt = Y(e.top);
            const yb = Y(e.bottom);
            if (x1 == null || x2 == null || yt == null || yb == null) continue;
            const w = Math.max(3, x2 - x1);
            ctx.fillStyle = c.fill;
            ctx.fillRect(x1 * hr, yt * vr, w * hr, (yb - yt) * vr);
            ctx.strokeStyle = c.line;
            ctx.lineWidth = 1.2 * vr;
            ctx.strokeRect(x1 * hr, yt * vr, w * hr, (yb - yt) * vr);
            label(e.label, (x1 + 4) * hr, (yt - 3) * vr, c.text);
            if (e.color === "grau") continue;
            // Stop, Ziel, Ungültig – vom Beginn der Zone bis zum rechten Rand, mit Preis
            if (e.stop != null) hline(e.stop, x1, x2, RED, 1.6, [], `Stop ${self.fmt(e.stop)}`);
            if (e.invalidation != null) hline(e.invalidation, x1, x2, RED, 1.2, [5, 4], `Ungültig unter ${self.fmt(e.invalidation)}`);
            if (e.target != null) hline(e.target, x1, x2, GREEN, 1.6, [], `Ziel ${self.fmt(e.target)}`);
            // Erwarteter Weg: vom letzten Kurs in die Zone, dann Richtung Ziel
            // Kauf: erst fallen (rot) in die Zone, dann steigen (grün). Short: erst steigen (grün) in die Zone, dann fallen (rot).
            const short = e.color === "rot";
            const away = short ? GREEN : RED;
            const toward = short ? RED : GREEN;
            const xl = XI(self.lastReal);
            const yl = Y(self.lastClose);
            const mid = Y((e.top + e.bottom) / 2);
            const yT = e.target != null ? Y(e.target) : null;
            if (xl == null || yl == null || mid == null || yT == null) continue;
            const xm = xl + (x2 - xl) * 0.4;
            const xe = x2 - 6;
            const outside = short ? self.lastClose < e.bottom : self.lastClose > e.top;
            ctx.lineWidth = 2 * vr;
            ctx.setLineDash([]);
            if (outside) {
              ctx.strokeStyle = away;
              ctx.beginPath();
              ctx.moveTo(xl * hr, yl * vr);
              ctx.lineTo(xm * hr, mid * vr);
              ctx.stroke();
            }
            const sx = outside ? xm : xl;
            const sy = outside ? mid : yl;
            ctx.strokeStyle = toward;
            ctx.beginPath();
            ctx.moveTo(sx * hr, sy * vr);
            ctx.lineTo(xe * hr, yT * vr);
            ctx.stroke();
            // Pfeilspitze
            const ang = Math.atan2((yT - sy) * vr, (xe - sx) * hr);
            const L = 9 * hr;
            ctx.fillStyle = toward;
            ctx.beginPath();
            ctx.moveTo(xe * hr, yT * vr);
            ctx.lineTo(xe * hr - L * Math.cos(ang - 0.45), yT * vr - L * Math.sin(ang - 0.45));
            ctx.lineTo(xe * hr - L * Math.cos(ang + 0.45), yT * vr - L * Math.sin(ang + 0.45));
            ctx.closePath();
            ctx.fill();
          }
        });
      },
    };
    return [{ zOrder: () => "bottom", renderer: () => renderer }];
  }
}
